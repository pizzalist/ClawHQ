import { v4 as uuid } from 'uuid';
import type { Task, TaskStatus, AppEvent, AgentRole, DeliverableType } from '@ai-office/shared';
import { MAX_CONCURRENT_TASKS, CHAIN_STEP_LABELS, REPORT_ONLY_TYPES } from '@ai-office/shared';
import { detectDeliverableType, detectDeliverableTypeForRole } from '@ai-office/shared';
import { stmts } from './db.js';
import { listAgents, getAgent, transitionAgent, resetAgent } from './agent-manager.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, killAgentRun, type AgentRun } from './openclaw-adapter.js';
import { createDeliverablesFromResult, validateWebDeliverable } from './deliverables.js';
import { shouldAutoChain, advanceChainPlan, hasPendingChainPlan, getChainPlanForTask, markChainRunning, markChainCompleted } from './chain-plan.js';

type Listener = (event: AppEvent) => void;
const listeners: Listener[] = [];

export function onTaskEvent(fn: Listener) {
  listeners.push(fn);
}

function emitTaskEvent(type: AppEvent['type'], agentId: string | null, taskId: string | null, message: string) {
  const event: AppEvent = {
    id: uuid(),
    type,
    agentId,
    taskId,
    message,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
  stmts.insertEvent.run(event.id, event.type, event.agentId, event.taskId, event.message, '{}');
  for (const fn of listeners) fn(event);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    assigneeId: (row.assignee_id as string) ?? null,
    status: row.status as TaskStatus,
    result: (row.result as string) ?? null,
    parentTaskId: (row.parent_task_id as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    isTest: !!(row.is_test as number),
    expectedDeliverables: row.expected_deliverables ? JSON.parse(row.expected_deliverables as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listTasks(includeTest = false): Task[] {
  const rows = includeTest ? stmts.listTasksIncludeTest.all() : stmts.listTasks.all();
  return (rows as Record<string, unknown>[]).map(rowToTask);
}

function shouldForceTestTask(title: string, description: string): boolean {
  // Only check the title for test-task classification.
  // Description often contains injected previous task results which may
  // contain words like "테스트" in normal context, causing false positives.
  const text = title.toLowerCase();
  return /(\bqc\b|\bqa\b|자동\s*검증|auto\s*validation|내부\s*핫픽스|internal\s*hotfix|test\s*flow)/i.test(text);
}

export function createTask(
  title: string,
  description: string,
  assigneeId?: string | null,
  parentTaskId?: string | null,
  expectedDeliverables?: string[],
  opts?: { isTest?: boolean; batchId?: string }
): Task {
  // Auto-detect deliverable type if not explicitly provided
  if (!expectedDeliverables || expectedDeliverables.length === 0) {
    // If assigneeId is provided, use role-aware detection
    if (assigneeId) {
      const assignee = getAgent(assigneeId);
      if (assignee) {
        const detected = detectDeliverableTypeForRole(`${title} ${description}`, assignee.role);
        expectedDeliverables = [detected];
      } else {
        expectedDeliverables = [detectDeliverableType(`${title} ${description}`)];
      }
    } else {
      const detected = detectDeliverableType(`${title} ${description}`);
      expectedDeliverables = [detected];
    }
  }
  const id = uuid();
  const isTest = opts?.isTest === true || shouldForceTestTask(title, description);
  const batchId = opts?.batchId || null;
  stmts.insertTask.run(
    id,
    title,
    description,
    parentTaskId || null,
    expectedDeliverables ? JSON.stringify(expectedDeliverables) : null,
    isTest ? 1 : 0,
  );
  // Set batch_id if provided
  if (batchId) {
    try { stmts.setBatchId.run(batchId, id); } catch { /* ignore if column missing */ }
  }

  // Default owner policy: root tasks go to PM first (unless explicitly assigned)
  let resolvedAssigneeId = assigneeId || null;
  if (!resolvedAssigneeId && !parentTaskId) {
    const pm = listAgents().find((a) => a.role === 'pm' && a.state === 'idle')
      || listAgents().find((a) => a.role === 'pm');
    if (pm) resolvedAssigneeId = pm.id;
  }

  if (resolvedAssigneeId) {
    stmts.updateTask.run(resolvedAssigneeId, 'pending', null, id);
  }
  emitTaskEvent('task_created', resolvedAssigneeId, id, `Task created: ${title}`);
  // Schedule queue processing async so the response returns immediately
  setTimeout(() => processQueue(), 100);
  return rowToTask(stmts.getTask.get(id) as Record<string, unknown>);
}

export function stopAgentTask(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.state !== 'working') throw new Error(`Agent is not working (state: ${agent.state})`);

  // Kill the running session
  if (agent.sessionId) {
    killAgentRun(agent.sessionId);
    cleanupRun(agent.sessionId);
  }

  // Cancel the task
  if (agent.currentTaskId) {
    stmts.updateTask.run(agentId, 'cancelled', 'Stopped by user', agent.currentTaskId);
    emitTaskEvent('task_failed', agentId, agent.currentTaskId, `Task stopped by user`);
  }

  // Reset agent to idle
  resetAgent(agentId);
}

let isProcessingQueue = false;

/**
 * Process the task queue: assign pending tasks to idle agents.
 * For real mode, spawns OpenClaw agent sessions.
 * For demo mode, uses simulated timers.
 */
export function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const activeCount = (stmts.activeTasks.get() as { count: number }).count;
    if (activeCount >= MAX_CONCURRENT_TASKS) return;

    const pending = (stmts.pendingTasks.all() as Record<string, unknown>[]).map(rowToTask);
    if (pending.length === 0) return;

    const idleAgents = listAgents().filter(a => a.state === 'idle');
    if (idleAgents.length === 0) return;

    let slotsLeft = MAX_CONCURRENT_TASKS - activeCount;
    const usedAgents = new Set<string>();

    for (const task of pending) {
      if (slotsLeft <= 0) break;
      // If task has a preferred assignee, try them first
      let agent;
      if (task.assigneeId) {
        agent = idleAgents.find(a => a.id === task.assigneeId && !usedAgents.has(a.id));
        if (!agent) continue; // preferred agent not idle, skip for now
      } else {
        agent = idleAgents.find(a => !usedAgents.has(a.id));
        if (!agent) break;
      }
      usedAgents.add(agent.id);
      assignTask(agent.id, task);
      slotsLeft--;
    }
  } finally {
    isProcessingQueue = false;
  }
}

function assignTask(agentId: string, task: Task) {
  const agent = getAgent(agentId);
  if (!agent) return;

  const sessionId = `ai-office-${agent.name.toLowerCase()}-${task.id.slice(0, 8)}-${Date.now()}`;

  // Mark task in-progress and agent working
  stmts.updateTask.run(agent.id, 'in-progress', null, task.id);
  transitionAgent(agent.id, 'working', task.id, sessionId);
  emitTaskEvent('task_assigned', agent.id, task.id, `Task "${task.title}" assigned to ${agent.name}`);

  const prompt = buildPrompt(agent.name, agent.role, task);

  spawnAgentSession({
    sessionId,
    agentName: agent.name,
    role: agent.role,
    model: agent.model,
    prompt,
    onComplete: (run) => handleRunComplete(agent.id, task.id, task.title, run),
  });
}

const ROLE_INSTRUCTIONS: Record<string, string> = {
  pm: `You are a Project Manager. Your job is to create REPORTS, PLANS, and ANALYSIS only.

CRITICAL RULES — VIOLATION = FAILURE:
- NEVER write code. No HTML, no JavaScript, no CSS, no programming code of ANY kind.
- NEVER use code blocks (\`\`\`html, \`\`\`js, etc.) — only markdown text.
- Your output is ALWAYS a structured markdown document with headers (# ## ###), bullet points, and tables.
- If the task says "만들어줘" or "build", produce a PLAN/SPECIFICATION for how to build it. DO NOT build it.
- If the task says "분석" or "리포트" or "report", produce a concise markdown report.
- Keep reports focused and actionable. Use Korean if the task is in Korean.
- Structure: 1) 개요 2) 핵심 내용 3) 결론/권장사항`,
  developer: `You are a Developer. Implement the task by writing working code.

CRITICAL RULES for web deliverables (HTML):
- ALWAYS produce a COMPLETE, SELF-CONTAINED HTML file with <!DOCTYPE html>, <html>, <head>, <body>
- ALL JavaScript must be inside the HTML file (inline <script> tags)
- ALL CSS must be inside the HTML file (inline <style> tags)
- The page MUST render something visible immediately — never show a blank screen
- For games: include game loop, input handling, and visible canvas/elements
- For apps: include working UI with event handlers
- Test mentally: would this HTML file work if opened directly in a browser? If not, fix it.
- Use Korean for UI text if the task is in Korean.`,
  designer: 'You are a Designer. Create design specifications, mockups, or UI implementations.',
  reviewer: 'You are a Code Reviewer. Review the work and produce a structured report with findings and recommendations.',
  devops: 'You are a DevOps Engineer. Create infrastructure code, deployment configs, or operational documents.',
  qa: 'You are a QA Engineer. Test and validate the work, then produce a structured test report.',
};

function buildPrompt(name: string, role: string, task: Task): string {
  const roleInstruction = ROLE_INSTRUCTIONS[role] || `Complete this task concisely and report what you did.`;
  const parts = [
    `You are ${name}, a ${role} in the AI Office.`,
    roleInstruction,
    ``,
    `## Task: ${task.title}`,
    task.description ? `\n${task.description}` : '',
  ];

  if (task.expectedDeliverables && task.expectedDeliverables.length > 0) {
    const formatHints: Record<string, string> = {
      web: 'a complete HTML page (use ```html code block)',
      report: 'a structured markdown report with headers and sections',
      code: 'code in appropriate language (use ```language code blocks)',
      data: 'structured data (use ```json or ```csv code blocks)',
      document: 'a well-formatted text document',
      api: 'API specification or implementation',
      design: 'design specifications or mockup descriptions',
    };
    const hints = task.expectedDeliverables.map(t => formatHints[t] || t).join('; ');
    parts.push(``, `## Expected Output Format`, `Produce: ${hints}`);
  }

  parts.push(``, `Respond with a clear summary of what you accomplished.`);
  return parts.join('\n');
}

/** Walk up parentTaskId chain to find the root task */
function findRootTask(taskId: string): Task {
  let current = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
  while (current.parentTaskId) {
    const parent = stmts.getTask.get(current.parentTaskId) as Record<string, unknown> | undefined;
    if (!parent) break;
    current = rowToTask(parent);
  }
  return current;
}

function isReportOnlyDeliverable(types: DeliverableType[] | undefined): boolean {
  return !!types && types.length > 0 && types.every(t => REPORT_ONLY_TYPES.includes(t as any));
}

function needsReviewByIntent(task: Pick<Task, 'title' | 'description'>): boolean {
  const text = `${task.title}\n${task.description}`.toLowerCase();
  return /(리뷰|검토|review|qa|test|테스트|품질|검증|qc)/i.test(text);
}

function needsDevFollowupAfterReview(task: Pick<Task, 'title' | 'description'>): boolean {
  const text = `${task.title}\n${task.description}`.toLowerCase();
  // Only trigger QA→Dev flow when QA/testing is explicitly requested (not just "리뷰")
  const qaIntent = /(qc|qa|테스트|품질검증|품질\s*검사|unit\s*test|e2e|integration\s*test)/i.test(text);
  const devFixIntent = /(수정|재수정|fix|bugfix|핫픽스|hotfix|패치)/i.test(text);
  return qaIntent && devFixIntent;
}

function estimateTaskComplexity(task: Pick<Task, 'title' | 'description' | 'expectedDeliverables'>): 'low' | 'medium' | 'high' {
  const text = `${task.title}\n${task.description}`.toLowerCase();
  let score = 0;
  if ((task.expectedDeliverables || []).some(t => t === 'web' || t === 'code' || t === 'api')) score += 2;
  if (/복잡|대규모|멀티|통합|아키텍처|배포|인프라|migration|refactor/i.test(text)) score += 2;
  if (text.length > 180) score += 1;
  if (/(긴급|hotfix|quick|빠르게|간단)/i.test(text)) score -= 1;
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

function isAdministrativeTask(task: Pick<Task, 'title' | 'description' | 'expectedDeliverables'>): boolean {
  const text = `${task.title}\n${task.description}`.toLowerCase();
  const managementIntent = /(취소|cancel|상태\s*조회|status\s*check|진행\s*상태|대기열|queue\s*status|reset|중지|stop\s+task|재시작|restart)/i.test(text);
  const reportOnly = isReportOnlyDeliverable(task.expectedDeliverables as DeliverableType[] | undefined);
  return managementIntent && reportOnly;
}

export function decideNextRoleByIntent(task: Pick<Task, 'title' | 'description' | 'expectedDeliverables'>, currentRole: AgentRole): AgentRole | undefined {
  if (isAdministrativeTask(task)) return undefined;

  const reportOnly = isReportOnlyDeliverable(task.expectedDeliverables as DeliverableType[] | undefined);
  const reviewRequested = needsReviewByIntent(task);
  const qaToDevRequested = needsDevFollowupAfterReview(task);
  const complexity = estimateTaskComplexity(task);

  if (currentRole === 'pm') {
    // Dynamic recommendation: QA->Dev is one option, not globally forced.
    if (qaToDevRequested) {
      // Complex/high-risk tasks: PM leads implementation first, then QA/Reviewer later.
      if (complexity === 'high') return 'developer';
      // Medium/low or bugfix validation: QA first then Dev correction.
      return 'qa';
    }

    // report/document: PM -> Reviewer only when explicitly asked
    if (reportOnly) return reviewRequested ? 'reviewer' : undefined;

    // implementation/web/code/api/design/data: PM -> Developer
    return 'developer';
  }

  if (currentRole === 'reviewer') {
    // Reviewer finds issues → Developer must fix (this is standard code review flow)
    return 'developer';
  }

  if (currentRole === 'qa') {
    // QA finds bugs → Developer must fix
    return qaToDevRequested ? 'developer' : undefined;
  }

  if (currentRole === 'developer') {
    // Developer -> Reviewer for code review (standard flow)
    if (reviewRequested) return 'reviewer';
    // If QA was requested, go to QA after development
    if (qaToDevRequested) return 'qa';
    return undefined;
  }

  return undefined;
}

function resolveNextRoleForTask(taskId: string, currentRole: AgentRole): AgentRole | undefined {
  const rootTask = findRootTask(taskId);
  return decideNextRoleByIntent(rootTask, currentRole);
}

function getPlannedStepCount(rootTask: Task): number {
  const rootAgent = rootTask.assigneeId ? getAgent(rootTask.assigneeId) : null;
  const startRole = rootAgent?.role;
  if (!startRole) return 1;

  let count = 1;
  const next1 = resolveNextRoleForTask(rootTask.id, startRole);
  if (next1) count += 1;
  const next2 = next1 ? resolveNextRoleForTask(rootTask.id, next1) : undefined;
  if (next2) count += 1;
  return count;
}

/** Get all chain children of a task (direct + nested) in order */
function getChainChildren(rootTaskId: string): Task[] {
  const all = (stmts.listTasks.all() as Record<string, unknown>[]).map(rowToTask);
  const children: Task[] = [];
  const findChildren = (parentId: string) => {
    const kids = all.filter(t => t.parentTaskId === parentId);
    for (const kid of kids) {
      children.push(kid);
      findChildren(kid.id);
    }
  };
  findChildren(rootTaskId);
  return children;
}

/** When a chain step completes, update root task with progress or final result */
function updateRootTaskFromChain(taskId: string, result: string) {
  const currentTask = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
  const rootTask = findRootTask(taskId);
  if (rootTask.id === taskId) return; // This IS the root task

  const agent = currentTask.assigneeId ? getAgent(currentTask.assigneeId) : null;
  const nextRole = agent ? resolveNextRoleForTask(taskId, agent.role) : undefined;

  if (!nextRole) {
    // TERMINAL step. Aggregate and complete root task.
    const children = getChainChildren(rootTask.id);
    const allSteps = [rootTask, ...children];

    // Prefer concrete implementation output when present.
    const devStep = allSteps.find(t => {
      const a = t.assigneeId ? getAgent(t.assigneeId) : null;
      return a?.role === 'developer';
    });
    const pmStep = allSteps.find(t => {
      const a = t.assigneeId ? getAgent(t.assigneeId) : null;
      return a?.role === 'pm';
    });

    // Priority: developer result > PM/root result > current result
    const finalResult = devStep?.result || pmStep?.result || rootTask.result || result;
    const mainRole = devStep ? 'developer' : (pmStep ? 'pm' : 'reviewer');

    // If terminal step was reviewer and reviewer text differs, append as assessment note.
    const reviewerNote = (agent?.role === 'reviewer' && result !== finalResult)
      ? `\n\n---\n## 리뷰어 평가\n${result.slice(0, 1000)}`
      : '';

    stmts.updateTask.run(rootTask.assigneeId, 'completed', finalResult + reviewerNote, rootTask.id);

    try { createDeliverablesFromResult(rootTask.id, finalResult, mainRole); } catch (e) { console.error('[deliverables] root copy error:', e); }

    emitTaskEvent('task_completed', rootTask.assigneeId, rootTask.id, `Task "${rootTask.title}" completed (pipeline finished)`);
  } else {
    // Intermediate step — update root with progress
    const children = getChainChildren(rootTask.id);
    const completedSteps = 1 + children.filter(c => c.status === 'completed').length;
    const totalSteps = getPlannedStepCount(rootTask);
    const stepLabel = CHAIN_STEP_LABELS[nextRole] || nextRole;
    stmts.updateTask.run(rootTask.assigneeId, 'in-progress', `⏳ Step ${completedSteps}/${totalSteps}: ${stepLabel} starting...`, rootTask.id);
  }
}

function handleRunComplete(agentId: string, taskId: string, title: string, run: AgentRun) {
  try {
    const success = run.exitCode === 0;
    const result = success
      ? parseAgentOutput(run.stdout)
      : `Error (exit ${run.exitCode}): ${run.stderr.slice(0, 2000) || run.stdout.slice(0, 2000) || 'Unknown error'}`;

    if (success) {
      // working → reviewing → done → idle
      try { transitionAgent(agentId, 'reviewing', taskId); } catch { /* skip if invalid */ }
      emitTaskEvent('message', agentId, taskId, `${getAgent(agentId)?.name ?? 'Agent'} is reviewing results...`);

      setTimeout(() => {
        try {
          transitionAgent(agentId, 'done', taskId);
          stmts.updateTask.run(agentId, 'completed', result, taskId);
          // Auto-create deliverables from result (pass agent role for type enforcement)
          const agentRole = getAgent(agentId)?.role;
          try { createDeliverablesFromResult(taskId, result, agentRole); } catch (e) { console.error('[deliverables] parse error:', e); }

          // Chain plan aware: check if auto-chain should proceed
          const currentTask = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
          const isRootTask = !currentTask.parentTaskId;
          const rootTaskId = isRootTask ? taskId : findRootTask(taskId).id;

          // 서버 단일 소스 정합성: 마지막 step 완료 시 즉시 completed로 확정
          const completedPlan = getChainPlanForTask(rootTaskId);
          if (completedPlan
            && completedPlan.status !== 'completed'
            && completedPlan.status !== 'cancelled'
            && completedPlan.currentStep >= completedPlan.steps.length - 1) {
            markChainCompleted(completedPlan.id);
          }

          const autoChain = shouldAutoChain(rootTaskId);

          let chainSpawned = false;
          if (autoChain) {
            // Auto-execute is ON and there's a next step — proceed
            const { nextStep } = advanceChainPlan(autoChain.planId);
            if (nextStep) {
              const chain = spawnChainFollowUp(agentId, taskId, title, result);
              chainSpawned = chain.spawned;
            }
          } else if (hasPendingChainPlan(rootTaskId)) {
            // Plan exists but auto-execute is OFF — notify user to confirm next step
            const plan = getChainPlanForTask(rootTaskId);
            if (plan) {
              const nextIdx = plan.currentStep + 1;
              const nextStep = plan.steps[nextIdx];
              emitTaskEvent('message', agentId, taskId,
                `⏸️ 다음 단계 대기 중: ${nextStep.label} (${nextStep.reason}). 계속하려면 승인해주세요.`);
            }
          } else {
            const plan = getChainPlanForTask(rootTaskId);
            if (plan) {
              // 강제 재계산: websocket/동기화 지연으로 running 상태가 남지 않도록 terminal 상태 확정
              const noRemainingStep = (plan.currentStep + 1) >= plan.steps.length;
              if (noRemainingStep && plan.status !== 'completed' && plan.status !== 'cancelled') {
                markChainCompleted(plan.id);
              }
            } else {
              // No chain plan exists — legacy behavior: try auto-chain for backward compat
              const chain = spawnChainFollowUp(agentId, taskId, title, result);
              chainSpawned = chain.spawned;
            }
          }

          // Only emit task_completed for root when no follow-up chain was spawned.
          if (!(isRootTask && chainSpawned)) {
            emitTaskEvent('task_completed', agentId, taskId, `Task "${title}" completed`);
          }

          // Update root task with chain progress/completion
          updateRootTaskFromChain(taskId, result);

          if (isRootTask && chainSpawned) {
            const rootTask = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
            const plan = getChainPlanForTask(taskId);
            const totalSteps = plan ? plan.steps.length : getPlannedStepCount(rootTask);
            const currentStep = plan ? plan.currentStep : 0;
            const stepLabel = plan ? plan.steps[currentStep]?.label : 'next';
            stmts.updateTask.run(agentId, 'in-progress', `⏳ Step ${currentStep + 1}/${totalSteps}: ${stepLabel} starting...`, taskId);
          }

          // Return to idle after brief pause
          setTimeout(() => {
            try {
              transitionAgent(agentId, 'idle', null, null);
              cleanupRun(run.sessionId);
              processQueue(); // pick up next task
            } catch { /* already transitioned */ }
          }, 2000);
        } catch { /* already transitioned */ }
      }, 1500);
    } else {
      transitionAgent(agentId, 'error', taskId);
      stmts.updateTask.run(agentId, 'failed', result, taskId);
      emitTaskEvent('task_failed', agentId, taskId, `Task "${title}" failed: ${result.slice(0, 200)}`);

      // Recover to idle after delay
      setTimeout(() => {
        try {
          transitionAgent(agentId, 'idle', null, null);
          cleanupRun(run.sessionId);
          processQueue();
        } catch { /* already transitioned */ }
      }, 5000);
    }
  } catch (err) {
    console.error(`[task-queue] Error handling completion for task ${taskId}:`, err);
  }
}

function spawnChainFollowUp(agentId: string, taskId: string, title: string, result: string): { spawned: boolean; nextRole?: AgentRole } {
  try {
    const agent = getAgent(agentId);
    if (!agent) return { spawned: false };

    const nextRole = resolveNextRoleForTask(taskId, agent.role);
    if (!nextRole) return { spawned: false }; // Conditional chain says stop here

    // Find an agent with the next role
    const nextAgentRow = stmts.findAgentByRole.get(nextRole) as Record<string, unknown> | undefined;
    if (!nextAgentRow) return { spawned: false }; // No agent with that role exists

    const nextAgentId = nextAgentRow.id as string;
    const nextAgentName = nextAgentRow.name as string;
    const stepLabel = CHAIN_STEP_LABELS[nextRole] || nextRole;
    const prevStepLabel = CHAIN_STEP_LABELS[agent.role] || agent.role;

    const chainTitle = `[${stepLabel}] ${title}`;
    const chainDesc = `## 이전 단계: ${agent.name} (${prevStepLabel})\n\n아래 이전 단계의 결과를 기반으로 ${stepLabel} 작업을 수행하세요.\n\n---\n\n${result.slice(0, 4000)}`;

    // Carry original expected deliverable from root task and clamp to next role.
    const rootTask = findRootTask(taskId);
    const originalExpected = rootTask.expectedDeliverables;
    let chainedDeliverables: string[] | undefined;
    if (originalExpected && originalExpected.length > 0) {
      const nextAgent = getAgent(nextAgentId);
      if (nextAgent) {
        chainedDeliverables = [detectDeliverableTypeForRole(originalExpected[0], nextAgent.role)];
      }
    }

    const sourceTask = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
    const newTask = createTask(chainTitle, chainDesc, nextAgentId, taskId, chainedDeliverables, { isTest: sourceTask.isTest });
    emitTaskEvent('chain_spawned', nextAgentId, newTask.id,
      `🔗 Chain: ${agent.name} (${prevStepLabel}) → ${nextAgentName} (${stepLabel})`);

    return { spawned: true, nextRole };
  } catch (err) {
    console.error('[task-queue] Chain follow-up error:', err);
    return { spawned: false };
  }
}

export { getChainChildren, findRootTask, spawnChainFollowUp };

/** Get all tasks in a batch */
export function getTasksByBatchId(batchId: string): Task[] {
  return (stmts.getTasksByBatchId.all(batchId) as Record<string, unknown>[]).map(rowToTask);
}

/** Check if all tasks in a batch are completed */
export function isBatchComplete(batchId: string): boolean {
  const tasks = getTasksByBatchId(batchId);
  return tasks.length > 0 && tasks.every(t => t.status === 'completed' || t.status === 'cancelled');
}

/** Get combined results of all tasks in a batch */
export function getBatchResults(batchId: string): { tasks: Task[]; combinedResult: string } {
  const tasks = getTasksByBatchId(batchId).filter(t => t.status === 'completed');
  const combinedResult = tasks.map((t, i) => {
    return `## ${t.title} (${i + 1}/${tasks.length})\n\n${t.result || '(결과 없음)'}`;
  }).join('\n\n---\n\n');
  return { tasks, combinedResult };
}

export function listEvents(): AppEvent[] {
  return (stmts.listEvents.all() as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    type: row.type as AppEvent['type'],
    agentId: (row.agent_id as string) ?? null,
    taskId: (row.task_id as string) ?? null,
    message: row.message as string,
    metadata: JSON.parse((row.metadata as string) || '{}'),
    createdAt: row.created_at as string,
  }));
}
