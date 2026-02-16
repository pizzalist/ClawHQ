import { v4 as uuid } from 'uuid';
import type { AgentRole, AgentModel, ChiefChatMessage, ChiefAction, ChiefResponse, ChiefCheckIn, ChiefCheckInOption, ChiefNotification, Meeting, TeamPlanSuggestion, AppEvent, Task } from '@ai-office/shared';
import { listAgents, createAgent, getAgent, suggestFriendlyAgentName } from './agent-manager.js';
import { listTasks, createTask, processQueue } from './task-queue.js';
import { listMeetings, startPlanningMeeting, getMeeting } from './meetings.js';
import { listDeliverablesByTask, validateWebDeliverable } from './deliverables.js';
import { suggestChainPlan } from './chain-plan.js';
import { stmts } from './db.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, type AgentRun } from './openclaw-adapter.js';

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
  // Only match "N번" or standalone number — exclude "N명" (count expressions)
  const numMatch = msg.match(/(\d+)\s*번/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < total) return [idx];
    return null;
  }
  // Standalone number only (entire message is just a number)
  if (/^\d+$/.test(msg)) {
    const idx = parseInt(msg, 10) - 1;
    if (idx >= 0 && idx < total) return [idx];
    return null;
  }
  // Short approval words — only if message is very short (< 10 chars) to avoid false matches
  if (msg.length < 10 && /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok)$/i.test(msg)) return [0];
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
  let reply: string;

  if (action === 'approve' || actionId.startsWith('approve')) {
    reply = '✅ 확정되었습니다. 다음 단계로 진행합니다.';
  } else if (action === 'request_revision') {
    reply = '수정 요청을 접수했습니다. 어떤 부분을 수정해야 할까요?';
  } else if (action === 'view_result') {
    reply = '결과를 확인합니다.';
  } else if (action === 'select_proposal') {
    const proposalAgent = params?.agentName || '선택된 안';
    reply = `${proposalAgent}의 제안을 선택했습니다. 이대로 진행할까요?`;
  } else {
    throw new Error(`Unsupported actionId: ${actionId}`);
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
  if (event.type === 'chain_spawned' && event.taskId) {
    emitCheckIn({
      id: `checkin-chain-${event.taskId}-${Date.now()}`,
      stage: 'progress',
      message: `🔗 승인된 체인을 계속 진행합니다.\n현재 단계가 완료되어 다음 단계를 자동 시작했습니다.\n\n${event.message}`,
      options: [
        { id: 'ok', label: '👍 계속 진행', description: '자동 체인 진행을 유지합니다' },
        { id: 'pause', label: '⏸️ 멈춤', description: '현재 체인을 일시중지합니다' },
      ],
      taskId: event.taskId,
      createdAt: new Date().toISOString(),
    });
    return;
  }

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

    // Check web deliverables for validation issues
    const deliverables = listDeliverablesByTask(event.taskId);
    const webDeliverables = deliverables.filter(d => d.type === 'web');
    let validationWarning = '';
    for (const wd of webDeliverables) {
      const validation = wd.metadata?.validation || validateWebDeliverable(wd.content);
      if (!validation.valid) {
        validationWarning = `\n\n⚠️ **실행 검증 경고**: ${validation.issues.join('; ')}\n브라우저에서 빈 화면이 될 수 있습니다. 수정 요청을 권장합니다.`;
        break;
      }
    }

    // Emit notification with inline actions
    notifyChief({
      id: `notif-task-${event.taskId}-${Date.now()}`,
      type: webDeliverables.length > 0 && validationWarning ? 'task_failed' : 'task_complete',
      title: task.title,
      summary: `✅ [태스크 완료] "${task.title}"\n담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'}) | 소요: ${elapsedSec}초${validationWarning}`,
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

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const activeTasks = tasks.filter((t) => t.status === 'in-progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const activeMeetings = meetings.filter((m: Meeting) => m.status !== 'completed');
  const completedMeetings = meetings.filter((m: Meeting) => m.status === 'completed');

  const agentLines = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}, ${a.state}) id=${a.id}`).join('\n')
    : '없음';

  const pendingLines = pendingTasks.length > 0
    ? pendingTasks.map(t => `- "${t.title}" (pending) id=${t.id}`).join('\n')
    : '없음';

  const activeLines = activeTasks.length > 0
    ? activeTasks.map(t => {
        const assignee = t.assigneeId ? agents.find(a => a.id === t.assigneeId) : null;
        return `- "${t.title}" (in-progress, 담당: ${assignee?.name || '미배정'}) id=${t.id}`;
      }).join('\n')
    : '없음';

  const recentCompleted = completedTasks.slice(0, 5);
  const completedLines = recentCompleted.length > 0
    ? recentCompleted.map(t => {
        const ago = Math.round((Date.now() - new Date(t.updatedAt).getTime()) / 60000);
        return `- "${t.title}" (completed, ${ago}분 전) id=${t.id}`;
      }).join('\n')
    : '없음';

  const activeMeetingLines = activeMeetings.length > 0
    ? activeMeetings.map(m => `- "${m.title}" (${m.status}) id=${m.id}`).join('\n')
    : '없음';

  return [
    `## 현재 에이전트 (${agents.length}명)`,
    agentLines,
    ``,
    `## 대기 중 작업 (${pendingTasks.length}건)`,
    pendingLines,
    ``,
    `## 진행 중 작업 (${activeTasks.length}건)`,
    activeLines,
    ``,
    `## 최근 완료 (${recentCompleted.length}건)`,
    completedLines,
    ``,
    `## 활성 미팅 (${activeMeetings.length}건)`,
    activeMeetingLines,
  ].join('\n');
}

function buildChiefSystemPrompt(): string {
  const state = summarizeOfficeState();
  return `당신은 AI Office의 총괄자(Chief)입니다.

규칙:
1. 간결하게 답하세요. 기본은 1~2문장, 필요해도 3문장을 넘기지 마세요.
2. 상태 조회, 삭제, 취소 같은 단순 작업은 바로 실행 제안하세요. 미팅을 제안하지 마세요.
3. 복잡한 작업(새 프로젝트 시작, 팀 구성 등)에만 옵션을 제시하세요.
4. 옵션을 제시할 때는 최대 2개까지만.
5. 한국어로 대화하세요.
6. 실행 전에 반드시 사용자 승인을 받으세요.
7. 아래 오피스 상태를 참고해 taskId, agentId 등을 직접 사용하세요.
8. 단순/정의형 질문(예: "원칙 설명", "기준 요약", "체크리스트 n개")은 설명 모드로 짧게 직답하고, 불필요한 실행 제안/추가 액션 요청을 붙이지 마세요.
9. add/create/reset/cancel 계열 요청은 1~2문장으로 답하고, 필요한 최소 액션만 제시하세요.

응답 길이:
- 상태 조회 → 1~2문장(가능하면 한 줄)
- 단순 액션(add/create/reset/cancel) → 1~2문장 + 최소 액션
- 단순/정의형 설명 요청 → 최대 4줄
- 복잡한 기획 → 최대 8줄 + 옵션 2개

미팅은 다음 경우에만 제안하세요:
- 사용자가 명시적으로 회의를 요청한 경우
- 3명 이상의 에이전트가 협업해야 하는 복잡한 작업인 경우
단순 작업(삭제, 상태 확인, 1인 작업)에는 절대 미팅을 제안하지 마세요.

## 현재 오피스 상태
${state}

## 액션 형식
실행할 액션을 아래 형식으로 포함하세요 (자동 실행 안 됨, 사용자 승인 필요):

[ACTION:create_task title="작업 제목" description="설명" assignRole="developer"]
[ACTION:create_agent name="이름" role="pm" model="claude-opus-4-6"]
[ACTION:start_meeting title="미팅 제목" participants="pm,developer,reviewer" character="planning"]
[ACTION:assign_task taskId="태스크ID" agentId="에이전트ID"]
[ACTION:cancel_task taskId="태스크ID"]
[ACTION:cancel_all_pending]
[ACTION:reset_agent agentId="에이전트ID"]

사용 가능한 role: pm, developer, reviewer, designer, devops, qa
사용 가능한 model: claude-opus-4-6, claude-sonnet-4, openai-codex/o3, openai-codex/gpt-5.3-codex
사용 가능한 character: brainstorm, planning, review, retrospective

이미 있는 에이전트를 활용할 수 있으면 새로 만들지 마세요.`;
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

function hasQaToDevIntent(text: string): boolean {
  const msg = (text || '').toLowerCase();
  const qaLike = /(qc|qa|리뷰|검토|테스트|품질)/i.test(msg);
  const devLike = /(개발|개발자|반영|수정|재수정|fix|implement)/i.test(msg);
  return qaLike && devLike;
}

function recommendStartRoleFromIntent(title: string, description: string, explicit?: string): AgentRole {
  if (explicit && ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'].includes(explicit)) {
    return explicit as AgentRole;
  }
  const text = `${title}\n${description}`.toLowerCase();
  const reportLike = /(리포트|보고서|요약|분석)/i.test(text);
  const reviewOnly = /(리뷰|검토)/i.test(text) && !/(구현|개발|수정|반영|fix|implement)/i.test(text);
  const implementOnly = /(구현|개발|코딩|코드|fix|implement)/i.test(text) && !/(기획|플랜|요구사항)/i.test(text);
  const qaFirst = hasQaToDevIntent(text) && /(검증|재현|버그|품질|qc|qa)/i.test(text);

  if (qaFirst) return 'qa';
  if (implementOnly) return 'developer';
  if (reportLike && reviewOnly) return 'reviewer';
  return 'pm';
}

function classifyIntent(userMessage: string): 'status' | 'simple_action' | 'definition' | 'other' {
  const msg = (userMessage || '').toLowerCase();

  const readOnlyStatusLike = /(상태\s*재?확인|재확인|다시\s*상태|상태\s*체크|진행\s*중(이야|인가|이냐)?|진행중|실행\s*중|실행중|진행\s*상황|진행률|현황|지금\s*상태|현재\s*상태|언제\s*줘|언제\s*돼|언제\s*끝|status|eta|예상\s*시간|얼마나\s*남|몇\s*명|몇\s*건)/i.test(msg);
  const mutationLike = /(추가|생성|create|만들|리셋|reset|취소|cancel|배정|assign|재시작|restart|전부\s*리셋|전부\s*취소|전체\s*취소)/i.test(msg);

  if (readOnlyStatusLike && !mutationLike) {
    return 'status';
  }
  if (mutationLike) {
    return 'simple_action';
  }
  if (/(설명|요약|원칙|기준|체크리스트|절차|포인트|가능\s*여부|몇\s*개|\d+\s*줄)/i.test(msg)) {
    return 'definition';
  }
  return 'other';
}

function toConciseModeReply(userMessage: string, reply: string): string {
  const intent = classifyIntent(userMessage);
  const normalized = (reply || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return '처리가 완료되었습니다.';

  if (intent === 'status') {
    const oneLine = normalized.split('\n').map(s => s.trim()).filter(Boolean).join(' ');
    return oneLine.slice(0, 180);
  }

  if (intent === 'simple_action') {
    const lines = normalized.split('\n').map(s => s.trim()).filter(Boolean);
    const picked: string[] = [];
    for (const line of lines) {
      picked.push(line);
      if (/[?]|승인|진행할까요|실행할까요/.test(line) || picked.length >= 2) break;
    }
    return picked.join(' ');
  }

  if (intent === 'definition') {
    const lines = normalized.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
    return lines.join('\n');
  }

  return normalized;
}

function buildMonitoringReply(userMessage: string): string {
  const agents = listAgents();
  const tasks = listTasks();
  const pending = tasks.filter(t => t.status === 'pending');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const completed = tasks.filter(t => t.status === 'completed');

  const latestProgress = [...inProgress]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 2)
    .map(t => `"${t.title}"`)
    .join(', ');

  const wantsEta = /(eta|예상\s*시간|얼마나\s*남|언제\s*끝)/i.test(userMessage);

  if (wantsEta) {
    const etaLine = inProgress.length > 0
      ? `ETA는 아직 고정하기 어렵지만, 현재 진행 중 ${inProgress.length}건(${latestProgress || '작업'}) 완료 후 바로 갱신해 드릴게요.`
      : '현재 진행 중 작업이 없어 ETA는 즉시(대기 0건 기준)입니다.';
    return `현재 대기 ${pending.length}건 · 진행 ${inProgress.length}건 · 완료 ${completed.length}건입니다. ${etaLine}`;
  }

  return `현재 대기 ${pending.length}건 · 진행 ${inProgress.length}건 · 완료 ${completed.length}건이며, 에이전트는 ${agents.length}명입니다${latestProgress ? ` (진행중: ${latestProgress})` : ''}.`;
}

function shouldSuppressActionsByIntent(intent: 'status' | 'simple_action' | 'definition' | 'other'): boolean {
  return intent === 'status' || intent === 'definition';
}

/** Execute a single parsed action. Called only after user approval. */
function executeAction(action: ChiefAction): ChiefAction {
  try {
    switch (action.type) {
      case 'create_task': {
        const { title, description, assignRole } = action.params;
        const taskTitle = title || 'Untitled';
        const taskDescription = description || '';

        // 1) Dynamic start-role recommendation (intent/output/complexity hints)
        const preferredRole = recommendStartRoleFromIntent(taskTitle, taskDescription, assignRole);

        // 2) Resolve initial assignee from recommended first step
        let assigneeId: string | null = null;
        if (preferredRole) {
          const agents = listAgents();
          const candidate = agents.find(a => a.role === preferredRole && a.state === 'idle')
            || agents.find(a => a.role === preferredRole);
          if (candidate) assigneeId = candidate.id;
        }

        const task = createTask(taskTitle, taskDescription, assigneeId);

        // 3) Persist a real editable plan for the task
        const plan = suggestChainPlan(task.id, task.title, task.description, preferredRole || 'pm', task.expectedDeliverables);
        const planSummary = plan.steps.map((s, i) => `${i + 1}. ${s.label} — ${s.reason}`).join('\n');

        return { ...action, result: {
          ok: true,
          message: `작업 "${task.title}" 생성됨\n\n📋 추천 체인 (${plan.steps.length}단계):\n${planSummary}\n\n필요하면 단계 추가/삭제/순서 변경 후 확정하세요.`,
          id: task.id,
        }};
      }
      case 'create_agent': {
        const { name, role, model } = action.params;
        const agentRole = (role || 'developer') as AgentRole;
        const agentModel = (model || DEFAULT_MODEL_BY_ROLE[agentRole]) as AgentModel;
        const safeName = name || suggestFriendlyAgentName(agentRole);
        const agent = createAgent(safeName, agentRole, agentModel);
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

        const task = stmts.getTask.get(taskId) as any;
        if (!task) {
          return { ...action, result: { ok: false, message: `작업을 찾을 수 없습니다: ${taskId}` } };
        }

        const agent = stmts.getAgent.get(agentId) as any;
        if (!agent) {
          return { ...action, result: { ok: false, message: `에이전트를 찾을 수 없습니다: ${agentId}` } };
        }

        if (task.status === 'in-progress') {
          return { ...action, result: { ok: false, message: '진행 중 작업은 재배정할 수 없습니다. 먼저 중지/취소 후 재배정하세요.' } };
        }

        stmts.updateTask.run(agentId, 'pending', task.result || null, taskId);
        setTimeout(() => processQueue(), 100);
        return { ...action, result: { ok: true, message: `작업 "${task.title}"를 ${agent.name}에게 배정했습니다.` } };
      }
      case 'cancel_task': {
        const { taskId } = action.params;
        if (!taskId) {
          return { ...action, result: { ok: false, message: 'taskId가 필요합니다' } };
        }
        const task = stmts.getTask.get(taskId) as any;
        if (!task) {
          return { ...action, result: { ok: false, message: `작업을 찾을 수 없습니다: ${taskId}` } };
        }
        stmts.cancelTask.run(taskId);
        return { ...action, result: { ok: true, message: `작업 "${task.title}" 취소됨` } };
      }
      case 'cancel_all_pending': {
        const result = stmts.cancelAllPending.run();
        const count = result.changes;
        return { ...action, result: { ok: true, message: `대기 중 작업 ${count}건 취소됨` } };
      }
      case 'reset_agent': {
        const { agentId } = action.params;
        if (!agentId) {
          return { ...action, result: { ok: false, message: 'agentId가 필요합니다' } };
        }
        const agent = stmts.getAgent.get(agentId) as any;
        if (!agent) {
          return { ...action, result: { ok: false, message: `에이전트를 찾을 수 없습니다: ${agentId}` } };
        }
        stmts.updateAgentState.run('idle', null, null, agentId);
        return { ...action, result: { ok: true, message: `에이전트 "${agent.name}" 상태 초기화됨` } };
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
export function approveProposal(messageId: string, selectedIndices?: number[], overrideActions?: ChiefAction[]): { executedActions: ChiefAction[]; state: { agents: any[]; tasks: any[]; meetings: any[] } } {
  const actions = pendingProposals.get(messageId);
  if (!actions || actions.length === 0) {
    throw new Error(`No pending proposal found for messageId: ${messageId}`);
  }

  const base = overrideActions && overrideActions.length > 0 ? overrideActions : actions;
  const toExecute = selectedIndices
    ? selectedIndices.filter(i => i >= 0 && i < base.length).map(i => base[i])
    : base;

  const totalCount = toExecute.length;

  // Feedback: approval received
  pushMessage('chief-default', {
    id: `approval-ack-${Date.now()}`,
    role: 'chief',
    content: `✅ **승인됨** — ${totalCount}건의 액션을 실행합니다.`,
    createdAt: new Date().toISOString(),
  });

  // Execute each action with individual feedback
  const executedActions: ChiefAction[] = [];
  for (let i = 0; i < toExecute.length; i++) {
    const action = toExecute[i];
    const stepLabel = `[${i + 1}/${totalCount}]`;

    // Feedback: execution start
    pushMessage('chief-default', {
      id: `exec-start-${Date.now()}-${i}`,
      role: 'chief',
      content: `⏳ ${stepLabel} 실행 중: ${ACTION_LABEL_MAP[action.type] || action.type}${action.params.title ? ` — "${action.params.title}"` : action.params.name ? ` — "${action.params.name}"` : ''}`,
      createdAt: new Date().toISOString(),
    });

    const executed = executeAction(action);
    executedActions.push(executed);

    // Feedback: execution result
    const ok = executed.result?.ok;
    pushMessage('chief-default', {
      id: `exec-result-${Date.now()}-${i}`,
      role: 'chief',
      content: ok
        ? `✅ ${stepLabel} 완료: ${executed.result!.message}`
        : `❌ ${stepLabel} 실패: ${executed.result?.message || '알 수 없는 오류'}`,
      createdAt: new Date().toISOString(),
    });
  }

  // Feedback: all done summary + next step guide
  const successCount = executedActions.filter(a => a.result?.ok).length;
  const failCount = executedActions.length - successCount;
  const pendingTasks = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress');

  let summaryMsg = `🎯 **실행 완료** — 성공 ${successCount}건`;
  if (failCount > 0) summaryMsg += `, 실패 ${failCount}건`;
  if (pendingTasks.length > 0) {
    summaryMsg += `\n\n📋 현재 진행/대기 중인 작업 ${pendingTasks.length}건이 있습니다. 결과가 나오면 알려드리겠습니다.`;
  } else {
    summaryMsg += `\n\n추가 작업이 필요하시면 말씀해주세요.`;
  }

  pushMessage('chief-default', {
    id: `exec-summary-${Date.now()}`,
    role: 'chief',
    content: summaryMsg,
    createdAt: new Date().toISOString(),
  });

  pendingProposals.delete(messageId);
  for (const [sid, mid] of pendingProposalBySession.entries()) {
    if (mid === messageId) pendingProposalBySession.delete(sid);
  }

  return {
    executedActions,
    state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
  };
}

// Dynamic chain recommendation mode: no forced QA->Dev normalization.

const ACTION_LABEL_MAP: Record<string, string> = {
  create_task: '작업 생성',
  create_agent: '에이전트 생성',
  start_meeting: '미팅 시작',
  assign_task: '작업 배정',
  cancel_task: '작업 취소',
  cancel_all_pending: '대기 작업 전체 취소',
  reset_agent: '에이전트 초기화',
};

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

const KOREAN_NUMS: Record<string, number> = {
  '한': 1, '하나': 1, '일': 1, '두': 2, '둘': 2, '이': 2,
  '세': 3, '셋': 3, '삼': 3, '네': 4, '넷': 4, '사': 4,
  '다섯': 5, '오': 5, '여섯': 6, '육': 6,
  '일곱': 7, '칠': 7, '여덟': 8, '팔': 8,
  '아홉': 9, '구': 9, '열': 10, '십': 10,
};

function parseKoreanOrArabicNum(s: string): number | null {
  const trimmed = s.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const num = KOREAN_NUMS[trimmed];
  return num ?? null;
}

function parseExplicitRoleCounts(text: string): Record<AgentRole, number> | null {
  const result: Partial<Record<AgentRole, number>> = {};
  let found = false;
  const koreanNumPattern = Object.keys(KOREAN_NUMS).sort((a, b) => b.length - a.length).join('|');
  const numCapture = `(\\d+|${koreanNumPattern})`;
  const sortedAliases = Object.entries(ROLE_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, role] of sortedAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s*${numCapture}\\s*명?`, 'i'),
      new RegExp(`${numCapture}\\s*명?\\s*의?\\s*${escaped}`, 'i'),
    ];
    if (result[role] !== undefined) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const count = parseKoreanOrArabicNum(match[1]);
        if (count && count > 0) { result[role] = count; found = true; break; }
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
  const message = userMessage.trim();
  const lower = message.toLowerCase();
  const agents = listAgents();
  const tasks = listTasks();
  const meetings = listMeetings();
  const stateSummary = `현재 인력 ${agents.length}명, 작업 ${tasks.length}건, 미팅 ${meetings.length}건`;

  // 1) Simple status query → short, direct response
  if (/(상태|현황|진행|status|how many|몇\s*명|몇\s*건)/i.test(lower) && !/(추가|생성|만들|취소|리셋|reset)/i.test(lower)) {
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    return {
      reply: `인력 ${agents.length}명 · 대기 ${pending} · 진행 ${inProgress} · 완료 ${completed}입니다.`,
      suggestions: [],
    };
  }

  // 2) Cancel pending tasks quickly
  if (/(전체\s*취소|전부\s*취소|모두\s*취소|대기\s*작업.*취소|취소.*대기|cancel all|cancel pending)/i.test(lower)) {
    const result = stmts.cancelAllPending.run();
    const count = result.changes;
    return {
      reply: `대기 중 작업 ${count}건을 취소했습니다.`,
      suggestions: [],
    };
  }

  // 3) Reset busy agents quickly
  if (/(에이전트.*리셋|agent\s*reset|전체\s*리셋|전부\s*리셋|reset all)/i.test(lower)) {
    const resettable = agents.filter(a => a.state !== 'idle');
    for (const a of resettable) {
      stmts.updateAgentState.run('idle', null, null, a.id);
    }
    return {
      reply: `에이전트 ${resettable.length}명을 idle로 리셋했습니다.`,
      suggestions: [],
    };
  }

  const suggestions = generatePlanFromPrompt(userMessage);
  const suggestionText = suggestions.length > 0
    ? suggestions.map((s) => `${s.role} ${s.count}명`).join(', ')
    : '현재 추가 편성 없이 진행 가능';
  const isExplicitRequest = parseExplicitRoleCounts(userMessage) !== null;
  const reply = isExplicitRequest
    ? `요청 편성: ${suggestionText}\n승인하면 바로 적용합니다.`
    : `상황: ${stateSummary}\n제안 편성: ${suggestionText}\n이대로 생성할까요?`;
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
      // If user says generic approval ("응", "승인"), execute ALL pending actions sequentially
      const isGenericApproval = /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|네\s*,?\s*실행)$/i.test(userMessage.trim().toLowerCase());
      const toExecute = isGenericApproval ? [...pending] : [pending[selected[0]]];

      const results: string[] = [];
      results.push(`✅ 승인됨 — ${toExecute.length}건 실행 시작`);
      for (let i = 0; i < toExecute.length; i++) {
        const action = toExecute[i];
        const stepLabel = toExecute.length > 1 ? `[${i + 1}/${toExecute.length}] ` : '';
        const executed = executeAction(action);
        const ok = executed.result?.ok;
        results.push(`${stepLabel}${ok ? '✅' : '❌'} ${executed.result?.message || action.type}`);
        if (ok && action.type === 'create_task') {
          results.push(`${stepLabel}↪ 추천 체인이 생성되었습니다. 필요 시 체인 미리보기에서 단계를 편집할 수 있습니다.`);
        }
      }

      // Remove executed actions from pending
      if (isGenericApproval) {
        pendingProposals.delete(pendingMessageId);
        pendingProposalBySession.delete(sessionId);
      } else {
        pending.splice(selected[0], 1);
        if (pending.length === 0) {
          pendingProposals.delete(pendingMessageId);
          pendingProposalBySession.delete(sessionId);
        } else {
          pendingProposals.set(pendingMessageId, pending);
        }
      }

      const remainingPending = pendingProposals.get(pendingMessageId);
      const remainingCount = remainingPending?.length || 0;

      let reply = `실행 결과:\n${results.join('\n')}`;
      if (remainingCount > 0) {
        reply += `\n\n남은 액션 ${remainingCount}건:\n${remainingPending!.map((a, i) => `${i + 1}. ${ACTION_LABEL_MAP[a.type] || a.type}`).join('\n')}\n\n'승인'이라고 하시면 나머지도 자동 실행합니다.`;
      } else {
        const pendingTasks = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress');
        if (pendingTasks.length > 0) {
          reply += `\n\n📋 현재 ${pendingTasks.length}건의 작업이 진행/대기 중입니다. 결과가 나오면 알려드리겠습니다.`;
        } else {
          reply += `\n\n추가로 진행할 작업이 있나요?`;
        }
      }

      pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });
      return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
    } else {
      // User sent a new unrelated message — discard the pending proposal
      pendingProposals.delete(pendingMessageId);
      pendingProposalBySession.delete(sessionId);
    }
  }

  const intent = classifyIntent(userMessage);

  // Read-only monitoring/status requests should be answered immediately from internal state.
  if (intent === 'status') {
    const reply = buildMonitoringReply(userMessage);
    pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });
    return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
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
      model: 'openai-codex/gpt-5.3-codex',
      prompt: fullPrompt,
      onComplete: (run: AgentRun) => {
        try {
          const rawOutput = parseAgentOutput(run.stdout);
          const { actions: parsedActions, cleanText } = parseActions(rawOutput);
          const proposedActions = shouldSuppressActionsByIntent(intent) ? [] : parsedActions;

          const conciseBaseReply = toConciseModeReply(userMessage, cleanText || '처리가 완료되었습니다.');
          const compactActionList = intent === 'simple_action' && proposedActions.length > 2
            ? `\n\n실행 후보 액션 ${proposedActions.length}건이 준비되었습니다. 승인하시면 필요한 순서로 실행합니다.`
            : formatActionList(proposedActions);
          const reply = `${conciseBaseReply}${compactActionList}`;
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
        } finally {
          cleanupRun(run.sessionId);
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
