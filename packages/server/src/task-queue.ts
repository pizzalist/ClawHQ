import { v4 as uuid } from 'uuid';
import type { Task, TaskStatus, AppEvent } from '@ai-office/shared';
import { MAX_CONCURRENT_TASKS, CHAIN_NEXT_ROLE, CHAIN_STEP_LABELS } from '@ai-office/shared';
import { detectDeliverableType, detectDeliverableTypeForRole } from '@ai-office/shared';
import { stmts } from './db.js';
import { listAgents, getAgent, transitionAgent, resetAgent } from './agent-manager.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, killAgentRun, type AgentRun } from './openclaw-adapter.js';
import { createDeliverablesFromResult } from './deliverables.js';

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
    expectedDeliverables: row.expected_deliverables ? JSON.parse(row.expected_deliverables as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listTasks(): Task[] {
  return (stmts.listTasks.all() as Record<string, unknown>[]).map(rowToTask);
}

export function createTask(title: string, description: string, assigneeId?: string | null, parentTaskId?: string | null, expectedDeliverables?: string[]): Task {
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
  stmts.insertTask.run(id, title, description, parentTaskId || null, expectedDeliverables ? JSON.stringify(expectedDeliverables) : null);
  // If specific assignee requested, set it on the task
  if (assigneeId) {
    stmts.updateTask.run(assigneeId, 'pending', null, id);
  }
  emitTaskEvent('task_created', assigneeId || null, id, `Task created: ${title}`);
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

/**
 * Process the task queue: assign pending tasks to idle agents.
 * For real mode, spawns OpenClaw agent sessions.
 * For demo mode, uses simulated timers.
 */
export function processQueue() {
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
  pm: `You are a Project Manager. Your job is to create PROJECT PLANS and SPECIFICATIONS only.

IMPORTANT RULES:
- DO NOT write any code (no HTML, no JavaScript, no CSS, no programming code of any kind)
- DO NOT produce code blocks with programming languages
- Instead, create a detailed project plan in markdown with:
  1. Project Overview & Goals
  2. Requirements (functional and non-functional)
  3. User Stories
  4. Technical Approach (describe, don't implement)
  5. Task Breakdown for developers
  6. Timeline / Priority
- Your output should ALWAYS be a structured markdown document/report
- If asked to "make" or "build" something, plan HOW it should be built, not build it yourself`,
  developer: 'You are a Developer. Implement the task by writing working code. Produce complete, runnable code.',
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
          emitTaskEvent('task_completed', agentId, taskId, `Task "${title}" completed`);

          // Auto-chain: spawn next step based on agent role
          spawnChainFollowUp(agentId, taskId, title, result);

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

function spawnChainFollowUp(agentId: string, taskId: string, title: string, result: string) {
  try {
    const agent = getAgent(agentId);
    if (!agent) return;

    const nextRole = CHAIN_NEXT_ROLE[agent.role];
    if (!nextRole) return; // No next step (e.g. reviewer is terminal)

    // Find an agent with the next role
    const nextAgentRow = stmts.findAgentByRole.get(nextRole) as Record<string, unknown> | undefined;
    if (!nextAgentRow) return; // No agent with that role exists

    const nextAgentId = nextAgentRow.id as string;
    const nextAgentName = nextAgentRow.name as string;
    const stepLabel = CHAIN_STEP_LABELS[nextRole] || nextRole;
    const prevStepLabel = CHAIN_STEP_LABELS[agent.role] || agent.role;

    const chainTitle = `[${stepLabel}] ${title}`;
    const chainDesc = `Auto-chained from ${agent.name}'s ${prevStepLabel} step.\n\nPrevious result:\n${result.slice(0, 1000)}`;

    // Carry the original expected deliverable from the parent task to the chained task.
    // E.g. user asked for 'web' → PM produces 'report' → Developer should inherit 'web'.
    // Walk up to the root task to find the original expected deliverable.
    const currentTask = rowToTask(stmts.getTask.get(taskId) as Record<string, unknown>);
    let rootTask = currentTask;
    while (rootTask.parentTaskId) {
      const parent = stmts.getTask.get(rootTask.parentTaskId) as Record<string, unknown> | undefined;
      if (!parent) break;
      rootTask = rowToTask(parent);
    }
    const originalExpected = rootTask.expectedDeliverables;
    // Use original type if the next agent's role allows it; otherwise role-aware detect
    let chainedDeliverables: string[] | undefined;
    if (originalExpected && originalExpected.length > 0) {
      const nextAgent = getAgent(nextAgentId);
      if (nextAgent) {
        chainedDeliverables = [detectDeliverableTypeForRole(originalExpected[0], nextAgent.role)];
      }
    }

    const newTask = createTask(chainTitle, chainDesc, nextAgentId, taskId, chainedDeliverables);
    emitTaskEvent('chain_spawned', nextAgentId, newTask.id,
      `🔗 Chain: ${agent.name} (${prevStepLabel}) → ${nextAgentName} (${stepLabel})`);
  } catch (err) {
    console.error('[task-queue] Chain follow-up error:', err);
  }
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
