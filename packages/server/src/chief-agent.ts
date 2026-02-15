import { v4 as uuid } from 'uuid';
import type { AgentRole, AgentModel, ChiefChatMessage, ChiefAction, ChiefResponse, ChiefCheckIn, ChiefCheckInOption, ChiefNotification, Meeting, TeamPlanSuggestion, AppEvent, Task } from '@ai-office/shared';
import { listAgents, createAgent, getAgent } from './agent-manager.js';
import { listTasks, createTask } from './task-queue.js';
import { listMeetings, startPlanningMeeting, getMeeting } from './meetings.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, type AgentRun } from './openclaw-adapter.js';

const MAX_HISTORY = 50;
const MAX_COUNT_PER_ROLE = 5;
const MAX_TOTAL_ADDITIONAL = 10;

const DEFAULT_MODEL_BY_ROLE: Record<AgentRole, AgentModel> = {
  pm: 'claude-opus-4-6',
  developer: 'openai-codex/gpt-5.3-codex',
  reviewer: 'claude-opus-4-6',
  designer: 'claude-sonnet-4',
  devops: 'openai-codex/o3',
  qa: 'claude-sonnet-4',
};

const sessionMessages = new Map<string, ChiefChatMessage[]>();

// Pending proposals awaiting user approval, keyed by messageId
const pendingProposals = new Map<string, ChiefAction[]>();
const pendingProposalBySession = new Map<string, string>();

function compactText(input: string, limit = 500): string {
  const normalized = (input || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...\n\n(더 보기는 '결과 보기'를 눌러주세요)`;
}

function summarizeTaskResult(result: string | null | undefined): string {
  if (!result) return '(결과 없음)';
  const cleaned = result
    .replace(/```[\s\S]*?```/g, '[코드 블록 생략]')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return compactText(cleaned, 500);
}

function formatActionList(actions: ChiefAction[]): string {
  if (actions.length === 0) return '';
  const lines = actions.map((a, i) => {
    const kv = Object.entries(a.params).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `${i + 1}. ${a.type}${kv ? ` (${kv})` : ''}`;
  });
  return `\n\n실행 후보 액션:\n${lines.join('\n')}\n\n원하는 번호(예: 1번)를 말해 주세요. '응/승인'이면 1번부터 순서대로 진행합니다.`;
}

function parseApprovalSelection(userMessage: string, total: number): number[] | null {
  if (total <= 0) return null;
  const msg = userMessage.trim().toLowerCase();
  const numMatch = msg.match(/(\d+)\s*번?/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < total) return [idx];
    return null;
  }
  if (/^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok)/i.test(msg)) return [0];
  return null;
}

// Callbacks for async chief responses (set by index.ts)
type ChiefResponseCallback = (sessionId: string, response: ChiefResponse) => void;
let responseCallback: ChiefResponseCallback | null = null;
export function onChiefResponse(cb: ChiefResponseCallback) { responseCallback = cb; }

// Callbacks for proactive check-ins
type ChiefCheckInCallback = (checkIn: ChiefCheckIn) => void;
let checkInCallback: ChiefCheckInCallback | null = null;
export function onChiefCheckIn(cb: ChiefCheckInCallback) { checkInCallback = cb; }

// Callbacks for chief notifications (task/meeting results with inline actions)
type ChiefNotificationCallback = (notification: ChiefNotification) => void;
let notificationCallback: ChiefNotificationCallback | null = null;
export function onChiefNotification(cb: ChiefNotificationCallback) { notificationCallback = cb; }

/**
 * Push a notification into Chief chat with inline action buttons.
 * This is the core function that makes Chief the central hub.
 */
export function notifyChief(notification: ChiefNotification) {
  const msg: ChiefChatMessage = {
    id: notification.id,
    role: 'chief',
    content: notification.summary,
    notification,
    createdAt: notification.createdAt,
  };
  pushMessage('chief-default', msg);
  if (notificationCallback) notificationCallback(notification);
}

/**
 * Handle an inline action button click from the Chief console.
 */
export function handleChiefAction(notificationId: string, actionId: string, params?: Record<string, string>): { reply: string } {
  const action = actionId;
  let reply = '처리되었습니다.';

  if (action === 'approve' || actionId.startsWith('approve')) {
    reply = '✅ 확정되었습니다. 다음 단계로 진행합니다.';
  } else if (action === 'request_revision') {
    reply = '수정 요청을 접수했습니다. 어떤 부분을 수정해야 할까요?';
  } else if (action === 'view_result') {
    reply = '결과를 확인합니다.';
  } else if (action === 'select_proposal') {
    const proposalAgent = params?.agentName || '선택된 안';
    reply = `${proposalAgent}의 제안을 선택했습니다. 이대로 진행할까요?`;
  }

  const replyMsg: ChiefChatMessage = {
    id: `chief-action-reply-${Date.now()}`,
    role: 'chief',
    content: reply,
    createdAt: new Date().toISOString(),
  };
  pushMessage('chief-default', replyMsg);
  return { reply };
}

function emitCheckIn(checkIn: ChiefCheckIn) {
  // Also add to default session messages so it appears in chat history
  pushMessage('chief-default', {
    id: checkIn.id,
    role: 'chief',
    content: checkIn.message,
    createdAt: checkIn.createdAt,
  });
  if (checkInCallback) checkInCallback(checkIn);
}

// Track which tasks/meetings we've already reported on to avoid duplicates
const reportedTaskCompletions = new Set<string>();
const reportedTaskFailures = new Set<string>();
const reportedMeetingCompletions = new Set<string>();

/**
 * Called by index.ts when a task event fires.
 * Chief monitors progress and proactively communicates with the user.
 */
export function chiefHandleTaskEvent(event: AppEvent) {
  if (event.type === 'task_completed' && event.taskId) {
    if (reportedTaskCompletions.has(event.taskId)) return;
    reportedTaskCompletions.add(event.taskId);

    const tasks = listTasks();
    const task = tasks.find(t => t.id === event.taskId);
    if (!task) return;

    // Skip sub-tasks (chain children) — only report root tasks
    if (task.parentTaskId) return;

    const assignee = task.assigneeId ? getAgent(task.assigneeId) : null;
    const resultPreview = summarizeTaskResult(task.result);
    const elapsedMs = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
    const elapsedSec = Math.round(elapsedMs / 1000);

    // Emit notification with inline actions
    notifyChief({
      id: `notif-task-${event.taskId}-${Date.now()}`,
      type: 'task_complete',
      title: task.title,
      summary: `✅ [태스크 완료] "${task.title}"\n담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'}) | 소요: ${elapsedSec}초`,
      actions: [
        { id: `view-${event.taskId}`, label: '📄 결과 보기', action: 'view_result', params: { taskId: event.taskId } },
        { id: `approve-${event.taskId}`, label: '✅ 확정', action: 'approve', params: { taskId: event.taskId } },
        { id: `revise-${event.taskId}`, label: '🔄 수정 요청', action: 'request_revision', params: { taskId: event.taskId } },
      ],
      taskId: event.taskId,
      createdAt: new Date().toISOString(),
    });

    // Check how many tasks remain
    const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;

    if (pendingCount === 0 && completedCount > 0) {
      // All tasks done → completion stage check-in
      emitCheckIn({
        id: `checkin-completion-${Date.now()}`,
        stage: 'completion',
        message: `모든 작업이 완료되었습니다! 🎉\n\n` +
          `완료된 작업 ${completedCount}건의 최종 결과를 확인해주세요.\n\n` +
          `마지막 완료: "${task.title}" (${assignee?.name || '미배정'})\n` +
          `결과 미리보기:\n${resultPreview}\n\n` +
          `최종 결과를 확정할까요? 추가 수정이 필요하면 말씀해주세요.`,
        options: [
          { id: 'confirm', label: '✅ 확정', description: '현재 결과로 확정합니다' },
          { id: 'revise', label: '🔄 수정 요청', description: '수정사항을 지시합니다' },
          { id: 'add-task', label: '➕ 추가 작업', description: '후속 작업을 만듭니다' },
        ],
        taskId: task.id,
        resultSummary: resultPreview,
        createdAt: new Date().toISOString(),
      });
    } else {
      // Mid-progress check-in
      emitCheckIn({
        id: `checkin-progress-${Date.now()}`,
        stage: 'progress',
        message: `작업 완료 보고: "${task.title}" ✅\n\n` +
          `담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'})\n` +
          `결과 미리보기:\n${resultPreview}\n\n` +
          `남은 작업 ${pendingCount}건이 있습니다. 이 결과 괜찮으세요? 수정이 필요하면 알려주세요.`,
        options: [
          { id: 'ok', label: '👍 괜찮아요', description: '계속 진행합니다' },
          { id: 'revise', label: '🔄 수정해줘', description: '이 작업을 재작업합니다' },
          { id: 'pause', label: '⏸️ 잠깐 멈춰', description: '전체 진행을 잠시 멈춥니다' },
        ],
        taskId: task.id,
        resultSummary: resultPreview,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (event.type === 'task_failed' && event.taskId) {
    if (reportedTaskFailures.has(event.taskId)) return;
    reportedTaskFailures.add(event.taskId);

    const tasks = listTasks();
    const task = tasks.find(t => t.id === event.taskId);
    if (!task || task.parentTaskId) return;

    const assignee = task.assigneeId ? getAgent(task.assigneeId) : null;

    // Emit notification
    notifyChief({
      id: `notif-taskfail-${event.taskId}-${Date.now()}`,
      type: 'task_failed',
      title: task.title,
      summary: `❌ [태스크 실패] "${task.title}"\n담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'})\n오류: ${(task.result || event.message || '알 수 없는 오류').slice(0, 200)}`,
      actions: [
        { id: `view-${event.taskId}`, label: '📄 상세 보기', action: 'view_result', params: { taskId: event.taskId } },
        { id: `retry-${event.taskId}`, label: '🔄 재시도', action: 'custom', params: { taskId: event.taskId, command: 'retry' } },
      ],
      taskId: event.taskId,
      createdAt: new Date().toISOString(),
    });

    emitCheckIn({
      id: `checkin-failure-${Date.now()}`,
      stage: 'decision',
      message: `⚠️ 작업 실패: "${task.title}"\n\n` +
        `담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'})\n` +
        `오류: ${task.result || event.message || '알 수 없는 오류'}\n\n` +
        `어떻게 처리할까요?`,
      options: [
        { id: 'retry', label: '🔄 재시도', description: '같은 에이전트로 재시도합니다' },
        { id: 'reassign', label: '👤 다른 에이전트', description: '다른 에이전트에게 배정합니다' },
        { id: 'skip', label: '⏭️ 건너뛰기', description: '이 작업을 건너뜁니다' },
        { id: 'modify', label: '✏️ 수정 후 재시도', description: '작업 내용을 수정합니다' },
      ],
      taskId: task.id,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Called by index.ts when a meeting changes state.
 * Chief reports meeting progress and asks for decisions.
 */
export function chiefHandleMeetingChange() {
  const meetings = listMeetings();
  for (const meeting of meetings) {
    if (meeting.status === 'completed' && !reportedMeetingCompletions.has(meeting.id)) {
      reportedMeetingCompletions.add(meeting.id);

      const contributionCount = meeting.proposals?.length || 0;
      if (contributionCount === 0) continue;

      // Collaborative model: show consolidated report, no winner selection
      const participantSummary = meeting.proposals
        .map(p => `• ${p.agentName}: ${p.content.slice(0, 100).replace(/\n/g, ' ')}${p.content.length > 100 ? '...' : ''}`)
        .join('\n');

      const reportPreview = meeting.report
        ? compactText(meeting.report, 500)
        : compactText(participantSummary, 500);

      notifyChief({
        id: `notif-meeting-${meeting.id}-${Date.now()}`,
        type: 'meeting_complete',
        title: meeting.title,
        summary: `🏛️ [회의 완료] "${meeting.title}"\n\n${contributionCount}명의 전문가가 논의를 완료했습니다.\n\n${reportPreview}\n\n결과를 확인하고 다음 단계를 결정해주세요.`,
        actions: [
          { id: `view-meeting-${meeting.id}`, label: '📄 회의 결과 보기', action: 'view_result', params: { meetingId: meeting.id } },
          { id: `approve-meeting-${meeting.id}`, label: '✅ 확정', action: 'approve', params: { meetingId: meeting.id } },
          { id: `revise-meeting-${meeting.id}`, label: '🔄 수정 요청', action: 'request_revision', params: { meetingId: meeting.id } },
        ],
        meetingId: meeting.id,
        createdAt: new Date().toISOString(),
      });

      emitCheckIn({
        id: `checkin-meeting-${meeting.id}-${Date.now()}`,
        stage: 'decision',
        message: `회의 완료: "${meeting.title}" 🏛️\n${contributionCount}명의 전문가가 각자 관점에서 분석을 완료했습니다. 결과를 확인해주세요.`,
        options: [
          { id: 'approve', label: '✅ 확정', description: '회의 결과를 확정합니다' },
          { id: 'revise', label: '🔄 수정 요청', description: '추가 논의가 필요합니다' },
        ],
        meetingId: meeting.id,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Handle user's response to a check-in option.
 * Returns a chief message with follow-up or action.
 */
export function respondToCheckIn(checkInId: string, optionId: string, userComment?: string): { reply: string; actions?: ChiefAction[] } {
  // We generate contextual responses based on the option chosen
  const now = new Date().toISOString();
  const msgId = `chief-checkin-reply-${Date.now()}`;

  let reply: string;
  let actions: ChiefAction[] | undefined;

  // Parse the check-in context from the ID
  if (checkInId.includes('completion')) {
    switch (optionId) {
      case 'confirm':
        reply = '좋습니다! 모든 결과가 확정되었습니다. 추가 작업이 필요하면 언제든 말씀해주세요. ✅';
        break;
      case 'revise':
        reply = '어떤 부분을 수정해야 할까요? 구체적으로 말씀해주시면 수정 작업을 만들겠습니다.';
        break;
      case 'add-task':
        reply = '어떤 후속 작업이 필요한가요? 설명해주시면 작업을 생성하고 적절한 에이전트에게 배정하겠습니다.';
        break;
      default:
        reply = userComment || '알겠습니다. 어떻게 진행할까요?';
    }
  } else if (checkInId.includes('progress')) {
    switch (optionId) {
      case 'ok':
        reply = '👍 좋습니다! 나머지 작업을 계속 진행합니다.';
        break;
      case 'revise':
        reply = '어떤 부분이 마음에 안 드시나요? 수정 방향을 알려주시면 재작업 지시하겠습니다.';
        break;
      case 'pause':
        reply = '⏸️ 진행을 멈췄습니다. 재개하려면 말씀해주세요.';
        break;
      default:
        reply = userComment || '알겠습니다.';
    }
  } else if (checkInId.includes('failure')) {
    switch (optionId) {
      case 'retry':
        reply = '같은 에이전트로 재시도합니다. 잠시 기다려주세요.';
        break;
      case 'reassign':
        reply = '다른 에이전트에게 배정할게요. 가용한 에이전트를 확인 중입니다...';
        break;
      case 'skip':
        reply = '이 작업을 건너뜁니다. 다른 작업은 계속 진행합니다.';
        break;
      case 'modify':
        reply = '작업 내용을 어떻게 수정할까요? 구체적으로 알려주세요.';
        break;
      default:
        reply = userComment || '알겠습니다.';
    }
  } else if (checkInId.includes('meeting')) {
    reply = `선택하신 안으로 진행하겠습니다. ${userComment ? `추가 의견: ${userComment}` : '결정이 반영됩니다.'}`;
  } else {
    reply = userComment || '알겠습니다. 계속 진행합니다.';
  }

  pushMessage('chief-default', { id: msgId, role: 'chief', content: reply, createdAt: now });
  return { reply, actions };
}

function getSessionMessages(sessionId: string): ChiefChatMessage[] {
  const existing = sessionMessages.get(sessionId);
  if (existing) return existing;
  const seeded: ChiefChatMessage[] = [{
    id: `chief-welcome-${Date.now()}`,
    role: 'chief',
    content: '안녕하세요, 총괄자입니다. 현재 오피스 상태를 보고 팀 편성과 실행 플랜을 제안해드릴게요. 어떤 일을 시작할까요?',
    createdAt: new Date().toISOString(),
  }];
  sessionMessages.set(sessionId, seeded);
  return seeded;
}

function pushMessage(sessionId: string, message: ChiefChatMessage) {
  const list = getSessionMessages(sessionId);
  list.push(message);
  if (list.length > MAX_HISTORY) {
    list.splice(0, list.length - MAX_HISTORY);
  }
}

export function summarizeOfficeState(): string {
  const agents = listAgents();
  const tasks = listTasks();
  const meetings = listMeetings();

  const idle = agents.filter((a) => a.state === 'idle').length;
  const working = agents.filter((a) => a.state === 'working' || a.state === 'reviewing').length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const activeTasks = tasks.filter((t) => t.status === 'in-progress').length;
  const activeMeetings = meetings.filter((m: Meeting) => m.status !== 'completed').length;

  const agentDetails = agents.map(a => `  - ${a.name} (${a.role}, ${a.model}, 상태: ${a.state})`).join('\n');
  const recentTasks = tasks.slice(-5).map(t => `  - [${t.status}] ${t.title}`).join('\n');
  const meetingList = meetings.slice(-3).map(m => `  - [${m.status}] ${m.title}`).join('\n');

  return [
    `## 현재 오피스 현황`,
    `인력 ${agents.length}명 (가용 ${idle}, 작업중 ${working})`,
    `작업 ${tasks.length}건 (대기 ${pendingTasks}, 진행 ${activeTasks})`,
    `미팅 ${meetings.length}건 (활성 ${activeMeetings})`,
    ``,
    `### 에이전트 목록`,
    agentDetails || '  (없음)',
    ``,
    `### 최근 작업`,
    recentTasks || '  (없음)',
    ``,
    `### 최근 미팅`,
    meetingList || '  (없음)',
  ].join('\n');
}

function buildChiefSystemPrompt(): string {
  const state = summarizeOfficeState();
  return `당신은 AI 오피스의 총괄자(Chief)입니다. 반드시 한국어로 응답하세요.

${state}

## 제안 형식
사용자의 요청을 분석하고, 실행할 액션을 **제안**하세요.
제안은 아래 형식의 ACTION 블록으로 포함합니다. 이 액션은 자동 실행되지 않으며, 사용자가 승인해야 실행됩니다.

[ACTION:create_task title="작업 제목" description="작업 설명" assignRole="developer"]
[ACTION:create_agent name="에이전트 이름" role="pm" model="claude-opus-4-6"]
[ACTION:start_meeting title="미팅 제목" participants="pm,developer,reviewer" character="planning"]
[ACTION:assign_task taskId="태스크ID" agentId="에이전트ID"]

사용 가능한 role: pm, developer, reviewer, designer, devops, qa
사용 가능한 model: claude-opus-4-6, claude-sonnet-4, openai-codex/o3, openai-codex/gpt-5.3-codex
사용 가능한 character: brainstorm, planning, review, retrospective

## 핵심 지침
- **항상 실행 전에 사용자 확인을 받으세요** — 절대 자동 실행하지 마세요
- 옵션을 번호나 리스트로 명확하게 제시하세요
- 결과를 간결하게 요약하세요
- **적극적으로 다음 단계를 제안**하세요 ("이어서 ~할까요?")
- 이미 있는 에이전트를 활용할 수 있으면 새로 만들지 마세요
- 불확실한 경우 사용자에게 질문하세요
- ACTION 블록은 반드시 응답에 포함하세요 — 사용자가 확인 후 승인합니다
- 친근하고 자연스러운 대화체를 사용하세요

## 승인 표현 인식
사용자가 "ㅇ", "응", "확인", "승인", "ㅇㅇ", "네", "좋아", "진행해" 등으로 응답하면 이전 제안을 승인한 것으로 해석하세요.`;
}

/** Parse [ACTION:type key="value" ...] blocks from LLM output */
function parseActions(text: string): { actions: ChiefAction[]; cleanText: string } {
  const actionRegex = /\[ACTION:(\w+)((?:\s+\w+="[^"]*")*)\]/g;
  const actions: ChiefAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(text)) !== null) {
    const type = match[1] as ChiefAction['type'];
    const paramsStr = match[2];
    const params: Record<string, string> = {};
    const paramRegex = /(\w+)="([^"]*)"/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramRegex.exec(paramsStr)) !== null) {
      params[pm[1]] = pm[2];
    }
    actions.push({ type, params });
  }

  const cleanText = text.replace(actionRegex, '').replace(/\n{3,}/g, '\n\n').trim();
  return { actions, cleanText };
}

/** Execute a single parsed action. Called only after user approval. */
function executeAction(action: ChiefAction): ChiefAction {
  try {
    switch (action.type) {
      case 'create_task': {
        const { title, description, assignRole } = action.params;
        let assigneeId: string | null = null;
        if (assignRole) {
          const agents = listAgents();
          const candidate = agents.find(a => a.role === assignRole && a.state === 'idle');
          if (candidate) assigneeId = candidate.id;
        }
        const task = createTask(title || 'Untitled', description || '', assigneeId);
        return { ...action, result: { ok: true, message: `작업 "${task.title}" 생성됨`, id: task.id } };
      }
      case 'create_agent': {
        const { name, role, model } = action.params;
        const agentRole = (role || 'developer') as AgentRole;
        const agentModel = (model || DEFAULT_MODEL_BY_ROLE[agentRole]) as AgentModel;
        const agent = createAgent(name || `${agentRole.toUpperCase()}-${Date.now()}`, agentRole, agentModel);
        return { ...action, result: { ok: true, message: `에이전트 "${agent.name}" 생성됨`, id: agent.id } };
      }
      case 'start_meeting': {
        const { title, participants, character } = action.params;
        const roles = (participants || 'pm,developer').split(',').map(r => r.trim());
        const agents = listAgents();
        const participantIds = roles
          .map(role => agents.find(a => a.role === role && a.state === 'idle'))
          .filter(Boolean)
          .map(a => a!.id);
        if (participantIds.length < 2) {
          return { ...action, result: { ok: false, message: '미팅 참여자가 부족합니다 (최소 2명 필요)' } };
        }
        const meeting = startPlanningMeeting(
          title || '총괄자 미팅',
          `총괄자가 시작한 미팅`,
          participantIds,
          (character as any) || 'planning',
        );
        return { ...action, result: { ok: true, message: `미팅 "${meeting.title}" 시작됨`, id: meeting.id } };
      }
      case 'assign_task': {
        const { taskId, agentId } = action.params;
        if (!taskId || !agentId) {
          return { ...action, result: { ok: false, message: 'taskId와 agentId가 필요합니다' } };
        }
        return { ...action, result: { ok: false, message: 'assign_task는 아직 구현 중입니다' } };
      }
      default:
        return { ...action, result: { ok: false, message: `알 수 없는 액션: ${action.type}` } };
    }
  } catch (err: unknown) {
    return { ...action, result: { ok: false, message: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Approve and execute a pending proposal by messageId.
 * `selectedIndices` allows partial approval (execute only some actions).
 * If null/undefined, all actions are executed.
 */
export function approveProposal(messageId: string, selectedIndices?: number[]): { executedActions: ChiefAction[]; state: { agents: any[]; tasks: any[]; meetings: any[] } } {
  const actions = pendingProposals.get(messageId);
  if (!actions || actions.length === 0) {
    throw new Error(`No pending proposal found for messageId: ${messageId}`);
  }

  const toExecute = selectedIndices
    ? selectedIndices.filter(i => i >= 0 && i < actions.length).map(i => actions[i])
    : actions;

  const executedActions = toExecute.map(a => executeAction(a));

  pendingProposals.delete(messageId);
  for (const [sid, mid] of pendingProposalBySession.entries()) {
    if (mid === messageId) pendingProposalBySession.delete(sid);
  }

  return {
    executedActions,
    state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
  };
}

/** Reject / discard a pending proposal */
export function rejectProposal(messageId: string): void {
  pendingProposals.delete(messageId);
  for (const [sid, mid] of pendingProposalBySession.entries()) {
    if (mid === messageId) pendingProposalBySession.delete(sid);
  }
}

/** Get pending proposal actions for a messageId */
export function getPendingProposal(messageId: string): ChiefAction[] | undefined {
  return pendingProposals.get(messageId);
}

// ---- Legacy keyword-based fallback (for demo mode) ----

const ROLE_ALIASES: Record<string, AgentRole> = {
  pm: 'pm', 'project manager': 'pm', '피엠': 'pm', '기획': 'pm', '기획자': 'pm', '매니저': 'pm',
  dev: 'developer', developer: 'developer', '개발': 'developer', '개발자': 'developer', '프론트': 'developer', '백엔드': 'developer',
  '리뷰어': 'reviewer', '코드리뷰': 'reviewer', reviewer: 'reviewer', review: 'reviewer', '리뷰': 'reviewer', '검토': 'reviewer',
  designer: 'designer', design: 'designer', '디자이너': 'designer', '디자인': 'designer',
  devops: 'devops', '데브옵스': 'devops', '인프라': 'devops', '운영': 'devops',
  qa: 'qa', '큐에이': 'qa', '테스터': 'qa', '테스트': 'qa', '품질': 'qa',
};

function clampSuggestions(raw: TeamPlanSuggestion[]): TeamPlanSuggestion[] {
  let total = 0;
  const next: TeamPlanSuggestion[] = [];
  for (const item of raw) {
    const safeCount = Math.max(0, Math.min(MAX_COUNT_PER_ROLE, Math.floor(item.count)));
    if (safeCount <= 0) continue;
    const remaining = MAX_TOTAL_ADDITIONAL - total;
    if (remaining <= 0) break;
    const finalCount = Math.min(safeCount, remaining);
    total += finalCount;
    next.push({ role: item.role, count: finalCount });
  }
  return next;
}

function parseExplicitRoleCounts(text: string): Record<AgentRole, number> | null {
  const result: Partial<Record<AgentRole, number>> = {};
  let found = false;
  const sortedAliases = Object.entries(ROLE_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, role] of sortedAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s*(\\d+)\\s*명?`, 'i'),
      new RegExp(`(\\d+)\\s*명?\\s*의?\\s*${escaped}`, 'i'),
    ];
    if (result[role] !== undefined) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const count = parseInt(match[1], 10);
        if (count > 0) { result[role] = count; found = true; break; }
      }
    }
  }
  if (!found) return null;
  const plan: Record<AgentRole, number> = { pm: 0, developer: 0, reviewer: 0, designer: 0, devops: 0, qa: 0 };
  for (const [role, count] of Object.entries(result)) {
    plan[role as AgentRole] = Math.max(plan[role as AgentRole], count);
  }
  return plan;
}

export function generatePlanFromPrompt(userText: string): TeamPlanSuggestion[] {
  const text = userText.toLowerCase();
  const explicit = parseExplicitRoleCounts(text);
  if (explicit) {
    return clampSuggestions(
      (Object.keys(explicit) as AgentRole[]).filter(role => explicit[role] > 0).map(role => ({ role, count: explicit[role] }))
    );
  }
  const plan: Record<AgentRole, number> = { pm: 1, developer: 2, reviewer: 1, designer: 0, devops: 0, qa: 0 };
  if (/(긴급|빠르|즉시|asap|hotfix|급함)/i.test(text)) { plan.pm += 1; plan.developer += 1; }
  if (/(디자인|ui|ux|브랜딩|랜딩)/i.test(text)) { plan.designer += 1; }
  if (/(배포|인프라|운영|devops|서버|클라우드)/i.test(text)) { plan.devops += 1; }
  if (/(qa|테스트|품질|검증|안정성)/i.test(text)) { plan.qa += 1; plan.reviewer += 1; }
  if (/(간단|작은|소규모|빠른 확인|프로토타입)/i.test(text)) { plan.developer = Math.max(1, plan.developer - 1); plan.pm = Math.max(1, plan.pm - 1); }
  return clampSuggestions((Object.keys(plan) as AgentRole[]).map((role) => ({ role, count: plan[role] })));
}

function keywordChat(sessionId: string, userMessage: string) {
  const stateSummary = `현재 인력 ${listAgents().length}명, 작업 ${listTasks().length}건, 미팅 ${listMeetings().length}건`;
  const suggestions = generatePlanFromPrompt(userMessage);
  const suggestionText = suggestions.length > 0
    ? suggestions.map((s) => `${s.role} ${s.count}명`).join(', ')
    : '현재 추가 편성 없이 진행 가능';
  const isExplicitRequest = parseExplicitRoleCounts(userMessage) !== null;
  const reply = isExplicitRequest
    ? `상황 보고: ${stateSummary}\n\n요청 편성: ${suggestionText}\n\n요청하신 구성으로 팀을 생성할까요? 승인하시면 바로 적용합니다.`
    : `상황 보고: ${stateSummary}\n\n제안 편성: ${suggestionText}\n\n이 구성으로 팀을 생성할까요?`;
  return { reply, suggestions };
}

// ---- Public API ----

export function getChiefMessages(sessionId: string): ChiefChatMessage[] {
  return [...getSessionMessages(sessionId)];
}

/**
 * Chat with Chief. In LLM mode, returns messageId for async processing.
 * In demo/keyword mode, returns synchronous result.
 */
export function chatWithChief(sessionId: string, userMessage: string): { messageId: string; async: boolean; reply?: string; suggestions?: TeamPlanSuggestion[]; messages?: ChiefChatMessage[] } {
  const now = new Date().toISOString();
  pushMessage(sessionId, { id: `user-${Date.now()}`, role: 'user', content: userMessage, createdAt: now });

  const messageId = `chief-${Date.now()}-${uuid().slice(0, 8)}`;

  // If there is a pending proposal for this session, treat short approval text as execution intent.
  const pendingMessageId = pendingProposalBySession.get(sessionId);
  if (pendingMessageId) {
    const pending = pendingProposals.get(pendingMessageId) || [];
    const selected = parseApprovalSelection(userMessage, pending.length);
    if (selected && selected.length > 0) {
      const selectedAction = pending[selected[0]];
      const executed = executeAction(selectedAction);
      pending.splice(selected[0], 1);
      if (pending.length === 0) {
        pendingProposals.delete(pendingMessageId);
        pendingProposalBySession.delete(sessionId);
      } else {
        pendingProposals.set(pendingMessageId, pending);
      }

      const summary = executed.result?.message || '실행 완료';
      const reply = pending.length > 0
        ? `선택한 액션을 실행했습니다.\n- 결과: ${summary}\n\n남은 액션 ${pending.length}건:\n${pending.map((a, i) => `${i + 1}. ${a.type}`).join('\n')}\n\n다음으로 어떤 액션을 실행할까요?`
        : `선택한 액션을 실행했습니다.\n- 결과: ${summary}\n\n추가로 진행할 작업이 있나요?`;

      pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });
      return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
    }
  }

  // LLM mode
  if (!isDemoMode()) {
    const systemPrompt = buildChiefSystemPrompt();
    const recentMessages = getSessionMessages(sessionId).slice(-10);
    const conversationContext = recentMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Chief'}: ${m.content}`)
      .join('\n\n');

    const fullPrompt = `${systemPrompt}\n\n## 대화 이력\n${conversationContext}\n\nUser: ${userMessage}\n\nChief:`;

    spawnAgentSession({
      sessionId: `chief-llm-${messageId}`,
      agentName: 'Chief',
      role: 'chief',
      model: 'claude-sonnet-4',
      prompt: fullPrompt,
      onComplete: (run: AgentRun) => {
        const rawOutput = parseAgentOutput(run.stdout);
        const { actions: proposedActions, cleanText } = parseActions(rawOutput);

        const baseReply = cleanText || '처리가 완료되었습니다.';
        const reply = `${baseReply}${formatActionList(proposedActions)}`;
        pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });

        // Store proposed actions for approval — do NOT execute yet
        if (proposedActions.length > 0) {
          pendingProposals.set(messageId, proposedActions);
          pendingProposalBySession.set(sessionId, messageId);
        }

        const response: ChiefResponse = {
          messageId,
          reply,
          actions: proposedActions,  // proposed, not executed
          state: {
            agents: listAgents(),
            tasks: listTasks(),
            meetings: listMeetings(),
          },
        };

        if (responseCallback) {
          responseCallback(sessionId, response);
        }
      },
    });

    return { messageId, async: true };
  }

  // Demo/keyword fallback
  const { reply, suggestions } = keywordChat(sessionId, userMessage);
  pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });

  return {
    messageId,
    async: false,
    reply,
    suggestions,
    messages: getChiefMessages(sessionId),
  };
}

// Keep applyChiefPlan for backward compat (keyword mode)
export function applyChiefPlan(inputSuggestions: TeamPlanSuggestion[]) {
  const suggestions = clampSuggestions(inputSuggestions || []);
  const existing = listAgents();
  const roleCounts: Record<AgentRole, number> = {
    pm: existing.filter((a) => a.role === 'pm').length,
    developer: existing.filter((a) => a.role === 'developer').length,
    reviewer: existing.filter((a) => a.role === 'reviewer').length,
    designer: existing.filter((a) => a.role === 'designer').length,
    devops: existing.filter((a) => a.role === 'devops').length,
    qa: existing.filter((a) => a.role === 'qa').length,
  };

  const created = [];
  for (const suggestion of suggestions) {
    for (let i = 0; i < suggestion.count; i++) {
      roleCounts[suggestion.role] += 1;
      const name = `${suggestion.role.toUpperCase()}-${String(roleCounts[suggestion.role]).padStart(2, '0')}`;
      created.push(createAgent(name, suggestion.role, DEFAULT_MODEL_BY_ROLE[suggestion.role]));
    }
  }

  const all = listAgents();
  const meetingCandidates = all
    .filter((a) => a.role === 'pm' || a.role === 'developer' || a.role === 'reviewer')
    .slice(0, 4)
    .map((a) => a.id);

  return {
    created,
    suggestions,
    meetingDraft: meetingCandidates.length >= 2
      ? {
          title: 'Chief 킥오프 미팅',
          description: '총괄자 제안 편성 적용 후 초기 실행 정렬 미팅',
          participantIds: meetingCandidates,
          character: 'planning' as const,
        }
      : null,
  };
}
