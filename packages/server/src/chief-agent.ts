import { v4 as uuid } from 'uuid';
import type { AgentRole, AgentModel, ChiefChatMessage, ChiefAction, ChiefResponse, ChiefCheckIn, ChiefCheckInOption, ChiefNotification, Meeting, TeamPlanSuggestion, AppEvent, Task } from '@clawhq/shared';
import { listAgents, createAgent, getAgent, suggestFriendlyAgentName } from './agent-manager.js';
import { listTasks, createTask, processQueue, isBatchComplete, getBatchResults, getTasksByBatchId, findRootTask } from './task-queue.js';
import { listMeetings, startPlanningMeeting, getMeeting, extractCandidatesFromMeeting, startReviewMeetingFromSource, getChildMeetings, deleteMeeting, deleteAllMeetings } from './meetings.js';
import { listDeliverablesByTask, validateWebDeliverable } from './deliverables.js';
import { suggestChainPlan, getChainPlanForTask, advanceChainPlan, shouldAutoChain, setChainAutoExecute, confirmChainPlan, linkTaskToChainPlan, listActiveChainPlans } from './chain-plan.js';
import { stmts } from './db.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, killAgentRun, type AgentRun } from './openclaw-adapter.js';

type Lang = 'en' | 'ko';
function L(lang: Lang, en: string, ko: string): string { return lang === 'en' ? en : ko; }

// Track language preference per session for async notifications
const sessionLanguageMap = new Map<string, Lang>();
function getSessionLang(sessionId?: string): Lang {
  return sessionLanguageMap.get(sessionId || '') || 'ko';
}

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

// Chain amendments: queued user messages to apply to next chain step
export const chainAmendments = new Map<string, string[]>();

// Pending proposals awaiting user approval, keyed by messageId
const pendingProposals = new Map<string, ChiefAction[]>();
const pendingProposalBySession = new Map<string, string>();
// Sessions currently waiting for async LLM reply (prevents "응" racing before proposal is ready)
const llmInFlightBySession = new Map<string, string>();
const queuedApprovalBySession = new Set<string>();

// Track agents assigned within a single batch to prevent duplicate assignment
const batchAssignedAgentIds = new Set<string>();

// Session-aware routing context for inline notifications/actions
const notificationSessionById = new Map<string, string>();
let lastActiveChiefSessionId = 'chief-default';

/** Reset all chief in-memory state (for full data reset) */
export function resetChiefState() {
  sessionMessages.clear();
  pendingProposals.clear();
  pendingProposalBySession.clear();
  llmInFlightBySession.clear();
  queuedApprovalBySession.clear();
  notificationSessionById.clear();
  sessionLanguageMap.clear();
  lastActiveChiefSessionId = 'chief-default';
  reportedTaskCompletions.clear();
  emittedNotificationKeys.clear();
  handledInlineActionKeys.clear();
}

function compactText(input: string, limit = 500, lang: Lang = 'ko'): string {
  const normalized = (input || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...\n\n${L(lang, '(Click "View Result" to see more)', '(더 보기는 \'결과 보기\'를 눌러주세요)')}`;
}

function summarizeTaskResult(result: string | null | undefined, lang: Lang = 'ko'): string {
  if (!result) return L(lang, '(No result)', '(결과 없음)');
  const cleaned = result
    .replace(/```[\s\S]*?```/g, L(lang, '[code block omitted]', '[코드 블록 생략]'))
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return compactText(cleaned, 500, lang);
}

function hasCriticalReviewFindings(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(\bFAIL\b|불합격|수정\s*필요|critical|major|중대|심각|필수\s*수정)/i.test(text);
}

function getMeetingReviewReadiness(meetingId: string): { candidates: ReturnType<typeof extractCandidatesFromMeeting>; canScore: boolean } {
  const candidates = extractCandidatesFromMeeting(meetingId);
  const uniqueNames = new Set(candidates.map(c => c.name.trim()).filter(Boolean));
  const canScore = uniqueNames.size >= 2;
  return { candidates, canScore };
}

function buildFixSummaryReply(userMessage: string): string | null {
  if (!/(수정\s*결과\s*요약|수정본\s*요약|수정\s*요약|fix\s*summary|변경\s*요약)/i.test(userMessage)) {
    return null;
  }

  const tasks = listTasks(true);
  const completed = tasks.filter(t => t.status === 'completed');
  const latestFix = completed
    .filter(t => /^\[fix\]/i.test(t.title) || /(수정|fix|피드백.*반영)/i.test(t.title))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  if (!latestFix) {
    return '아직 완료된 수정 작업이 없습니다. 먼저 "리뷰 피드백 반영해줘"로 수정 태스크를 실행해 주세요.';
  }

  let latestReview: Task | undefined;
  try {
    const root = findRootTask(latestFix.id);
    latestReview = completed
      .filter(t => t.parentTaskId === root.id && /review|리뷰|검토|qa|qc/i.test(t.title))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  } catch {
    latestReview = completed
      .filter(t => /review|리뷰|검토|qa|qc/i.test(t.title))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }

  const fixPreview = summarizeTaskResult(latestFix.result).slice(0, 320);
  const reviewPreview = latestReview?.result ? summarizeTaskResult(latestReview.result).slice(0, 220) : null;

  const lines = [
    `🛠️ 수정 결과 요약: "${latestFix.title}"`,
    `완료 시각: ${new Date(latestFix.updatedAt).toLocaleString('ko-KR')}`,
    '',
    '핵심 변경사항:',
    fixPreview,
  ];

  if (reviewPreview) {
    lines.push('', '검증/리뷰 요약:', reviewPreview);
  }

  lines.push('', `상세 결과가 필요하면 "결과 보기" 또는 "${latestFix.title} 전체 보여줘"라고 말해줘.`);
  return lines.join('\n');
}

/** Parse structured [SCORE] lines from reviewer output */
function parseStructuredScores(content: string, candidateNames: string[]): { candidateName: string; total: number; breakdown: Record<string, number> }[] {
  const results: { candidateName: string; total: number; breakdown: Record<string, number> }[] = [];
  const scoreLineRegex = /\[SCORE\]\s*(.+?)\s*\|(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = scoreLineRegex.exec(content)) !== null) {
    const name = match[1].trim();
    const rest = match[2];
    const breakdown: Record<string, number> = {};
    const fieldRegex = /(\w[\w\s-]*?):\s*(\d+)\s*\/\s*\d+/gi;
    let fm: RegExpExecArray | null;
    let total = 0;
    while ((fm = fieldRegex.exec(rest)) !== null) {
      const field = fm[1].trim();
      const val = parseInt(fm[2], 10);
      if (field.toLowerCase() === 'total') {
        total = val;
      } else {
        breakdown[field] = val;
      }
    }
    if (total === 0) total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    results.push({ candidateName: name, total, breakdown });
  }
  // Fallback: try legacy pattern (Name ... N/10)
  if (results.length === 0) {
    for (const cName of candidateNames) {
      const escaped = cName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const legacyPattern = new RegExp(`${escaped}[^\\d]*?(\\d+)\\s*/\\s*10`, 'i');
      const lm = content.match(legacyPattern);
      if (lm) {
        results.push({ candidateName: cName, total: parseInt(lm[1], 10), breakdown: {} });
      }
    }
  }
  return results;
}

/** Parse [RECOMMENDATION] and [ALTERNATIVE] lines */
function parseRecommendation(content: string): { recommendation: string; reason: string; alternatives: string[] } {
  const recMatch = content.match(/\[RECOMMENDATION\]\s*1순위:\s*(.+?)(?:\s*\||$)/im);
  const recommendation = recMatch?.[1]?.trim() || '';
  const reasonMatch = content.match(/\[RECOMMENDATION\].*이유:\s*(.+?)(?:\s*\||$)/im);
  const reason = reasonMatch?.[1]?.trim() || '';
  const alternatives: string[] = [];
  const altRegex = /\[ALTERNATIVE\]\s*\d*순위:\s*(.+?)(?:\s*\||$)/gim;
  let am: RegExpExecArray | null;
  while ((am = altRegex.exec(content)) !== null) {
    alternatives.push(am[1].trim());
  }
  return { recommendation, reason, alternatives };
}

/**
 * Generate a standardized decision packet from a review meeting's proposals.
 * Extracts structured [SCORE] lines, produces recommendation + alternatives.
 */
function generateDecisionPacket(meeting: Meeting): import('@clawhq/shared').DecisionPacket | null {
  if (meeting.decisionPacket) return meeting.decisionPacket;
  if (!meeting.sourceCandidates || meeting.sourceCandidates.length === 0) return null;
  if (meeting.proposals.length === 0) return null;

  const candidateNames = meeting.sourceCandidates.map(c => c.name);
  const reviewerScoreCards: import('@clawhq/shared').ReviewerScoreCard[] = [];

  for (const proposal of meeting.proposals) {
    const parsed = parseStructuredScores(proposal.content, candidateNames);
    const scores: import('@clawhq/shared').ReviewerScoreCard['scores'] = [];

    for (const candidate of meeting.sourceCandidates) {
      const found = parsed.find(p => p.candidateName === candidate.name);
      // Use parsed total normalized to 10-scale, or fallback to 5
      const breakdownCount = found ? Math.max(1, Object.keys(found.breakdown).length) : 1;
      const score = found && found.total > 0
        ? Math.min(10, Math.max(1, Math.round(found.total / breakdownCount)))
        : 5;
      const rationale = found && Object.keys(found.breakdown).length > 0
        ? Object.entries(found.breakdown).map(([k, v]) => `${k}: ${v}/10`).join(', ')
        : `${proposal.agentName}의 ${candidate.name} 평가`;
      scores.push({
        candidateName: candidate.name,
        score,
        weight: 1,
        rationale,
      });
    }
    reviewerScoreCards.push({
      reviewerName: proposal.agentName,
      reviewerRole: 'reviewer',
      scores,
    });
  }

  // Aggregate scores across reviewers
  const candidateScores = new Map<string, number[]>();
  for (const card of reviewerScoreCards) {
    for (const s of card.scores) {
      if (!candidateScores.has(s.candidateName)) candidateScores.set(s.candidateName, []);
      candidateScores.get(s.candidateName)!.push(s.score * s.weight);
    }
  }

  const ranked = [...candidateScores.entries()]
    .map(([name, scores]) => ({
      name,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      summary: meeting.sourceCandidates!.find(c => c.name === name)?.summary || '',
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Try to use parsed [RECOMMENDATION] from proposals
  const allContent = meeting.proposals.map(p => p.content).join('\n');
  const parsedRec = parseRecommendation(allContent);

  const recommendation = parsedRec.recommendation
    ? { name: parsedRec.recommendation, summary: parsedRec.reason, score: ranked.find(r => r.name === parsedRec.recommendation)?.avgScore }
    : ranked[0]
      ? { name: ranked[0].name, summary: ranked[0].summary, score: ranked[0].avgScore }
      : { name: '없음', summary: '' };

  const alternatives = parsedRec.alternatives.length > 0
    ? parsedRec.alternatives.slice(0, 2).map(name => {
        const r = ranked.find(x => x.name === name);
        return { name, summary: r?.summary || '', score: r?.avgScore };
      })
    : ranked.slice(1, 3).map(r => ({ name: r.name, summary: r.summary, score: r.avgScore }));

  return {
    reviewerScoreCards,
    recommendation,
    alternatives,
    status: 'pending',
  };
}

// Exported for testing
export { parseStructuredScores as _parseStructuredScores, parseRecommendation as _parseRecommendation };

const ACTION_EMOJI_MAP: Record<string, string> = {
  create_task: '📋',
  create_agent: '🤖',
  start_meeting: '🤝',
  assign_task: '📌',
  cancel_task: '🗑️',
  cancel_all_pending: '🗑️',
  reset_agent: '🔄',
  cancel_meeting: '❌',
  delete_meeting: '❌',
  delete_all_meetings: '❌',
};

function getActionFriendlyLabel(type: string, lang: Lang = 'ko'): string {
  const labels: Record<string, [string, string]> = {
    create_task: ['Create Task', '태스크 생성'],
    create_agent: ['Create Agent', '에이전트 생성'],
    start_meeting: ['Start Meeting', '회의 소집'],
    assign_task: ['Assign Task', '태스크 배정'],
    cancel_task: ['Cancel Task', '태스크 취소'],
    cancel_all_pending: ['Cancel All Pending', '대기 작업 전체 취소'],
    reset_agent: ['Reset Agent', '에이전트 리셋'],
    cancel_meeting: ['Cancel Meeting', '미팅 취소'],
    delete_meeting: ['Delete Meeting', '미팅 삭제'],
    delete_all_meetings: ['Delete All Meetings', '전체 미팅 삭제'],
  };
  const pair = labels[type];
  return pair ? L(lang, pair[0], pair[1]) : type;
}

function formatActionForDisplay(action: ChiefAction, lang: Lang = 'ko'): string {
  const emoji = ACTION_EMOJI_MAP[action.type] || '▶️';
  const label = getActionFriendlyLabel(action.type, lang);
  const p = action.params;

  if (action.type === 'cancel_task' && p.taskId) {
    const row = stmts.getTask.get(p.taskId) as any;
    const title = row?.title || L(lang, 'Unknown task', '알 수 없는 태스크');
    return `${emoji} ${label}: "${title}"`;
  }
  if (action.type === 'reset_agent' && p.agentId) {
    const row = stmts.getAgent.get(p.agentId) as any;
    const name = row?.name || L(lang, 'Unknown agent', '알 수 없는 에이전트');
    return `${emoji} ${label}: "${name}"`;
  }
  if (action.type === 'assign_task' && p.taskId) {
    const taskRow = stmts.getTask.get(p.taskId) as any;
    const agentRow = p.agentId ? stmts.getAgent.get(p.agentId) as any : null;
    const taskTitle = taskRow?.title || L(lang, 'Unknown task', '알 수 없는 태스크');
    const agentName = agentRow?.name || p.agentId || '';
    return `${emoji} ${label}: "${taskTitle}"${agentName ? ` → ${agentName}` : ''}`;
  }
  if (p.title) {
    return `${emoji} ${label}: "${p.title}"`;
  }
  if (p.name) {
    return `${emoji} ${label}: "${p.name}"`;
  }
  return `${emoji} ${label}`;
}

function formatActionList(actions: ChiefAction[], lang: Lang = 'ko'): string {
  if (actions.length === 0) return '';
  const lines = actions.map((a, i) => `${i + 1}. ${formatActionForDisplay(a, lang)}`);
  return lang === 'en'
    ? `\n\nProposed actions:\n${lines.join('\n')}\n\nSay a number (e.g. "1") to pick one, or "yes/approve" to run them in order.`
    : `\n\n실행 후보 액션:\n${lines.join('\n')}\n\n원하는 번호(예: 1번)를 말해 주세요. '응/승인'이면 1번부터 순서대로 진행합니다.`;
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
  // Short approval words — exact match for short messages
  if (msg.length < 20 && /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|yes|approve|sure|do it|proceed|run|execute)$/i.test(msg)) return [0];
  // Approval prefix with additional instructions — "응, 그리고 ..." / "yes, and also ..." etc.
  if (/^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|yes|approve|sure)\s*[,.]?\s+/i.test(msg)) return [0];
  return null;
}

/**
 * Extract the additional instruction part after an approval prefix.
 * e.g. "응, 그리고 개발 태스크도 만들어줘" → "그리고 개발 태스크도 만들어줘"
 */
function extractPostApprovalMessage(userMessage: string): string | null {
  const match = userMessage.trim().match(/^(?:ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|yes|approve|sure)\s*[,.]?\s+(.+)$/is);
  return match ? match[1].trim() : null;
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
function resolveNotificationSession(notification: ChiefNotification): string {
  const sid = (notification.sessionId || '').trim();
  if (sid) return sid;
  return lastActiveChiefSessionId || 'chief-default';
}

function formatMeetingResult(meetingId: string, lang: Lang = 'ko'): string {
  const meeting = getMeeting(meetingId);
  if (!meeting) return L(lang, 'Meeting not found. Please select from the meeting list.', '해당 회의를 찾을 수 없습니다. 회의 목록에서 다시 선택해주세요.');

  const proposalCount = meeting.proposals?.length || 0;
  const report = meeting.report?.trim();
  const preview = (report || meeting.proposals.map(p => `${p.agentName}: ${p.content}`).join('\n\n')).trim();

  const participantTotal = meeting.participants?.length || proposalCount;
  const lines = [
    `📄 **${L(lang, 'Meeting Result', '회의 결과')}**: "${meeting.title}"`,
    L(lang,
      `Status: ${meeting.status} · Participants: ${participantTotal} · Proposals: ${proposalCount}`,
      `상태: ${meeting.status} · 참여자: ${participantTotal}명 · 제안: ${proposalCount}건`),
  ];

  if (meeting.sourceMeetingId) {
    const sourceMeeting = getMeeting(meeting.sourceMeetingId);
    if (sourceMeeting) {
      lines.push(`📌 ${L(lang, 'Based on', '기반 회의')}: "${sourceMeeting.title}"`);
    }
  }
  if (meeting.sourceCandidates && meeting.sourceCandidates.length > 0) {
    lines.push(`📋 ${L(lang, 'Candidates evaluated', '평가 대상 후보')}: ${meeting.sourceCandidates.map(c => c.name).join(', ')}`);
  }

  lines.push('', preview || L(lang, '(No result)', '(결과 없음)'));

  if (meeting.decisionPacket) {
    const dp = meeting.decisionPacket;
    lines.push('', '---', `📊 **${L(lang, 'Final Decision Packet', '최종 의사결정 패킷')}**`);
    if (dp.recommendation) {
      lines.push(`🏆 ${L(lang, 'Recommendation', '추천안')}: **${dp.recommendation.name}** — ${dp.recommendation.summary?.slice(0, 100) || ''}`);
    }
    if (dp.alternatives && dp.alternatives.length > 0) {
      lines.push(`💡 ${L(lang, 'Alternatives', '대안')}: ${dp.alternatives.map(a => a.name).join(', ')}`);
    }
    if (dp.reviewerScoreCards && dp.reviewerScoreCards.length > 0) {
      for (const card of dp.reviewerScoreCards) {
        const scoreStr = card.scores.map(s => `${s.candidateName}: ${s.score}/10`).join(', ');
        lines.push(`  🔍 ${card.reviewerName} (${card.reviewerRole}): ${scoreStr}`);
      }
    }
  }

  return lines.join('\n');
}

function formatTaskResult(taskId: string, lang: Lang = 'ko'): string {
  const task = listTasks().find(t => t.id === taskId);
  if (!task) return L(lang, 'Task not found. Please select from the list.', '해당 작업을 찾을 수 없습니다. 목록에서 다시 선택해주세요.');
  const status = task.status;
  const preview = (task.result || L(lang, '(No result)', '(결과 없음)')).trim();
  return `📄 **${L(lang, 'Task Result', '작업 결과')}**: "${task.title}"\n${L(lang, 'Status', '상태')}: ${status}\n\n${preview}`;
}

export function notifyChief(notification: ChiefNotification) {
  const sessionId = resolveNotificationSession(notification);
  const scopedNotification: ChiefNotification = { ...notification, sessionId };
  notificationSessionById.set(notification.id, sessionId);

  const msg: ChiefChatMessage = {
    id: scopedNotification.id,
    role: 'chief',
    content: scopedNotification.summary,
    notification: scopedNotification,
    createdAt: scopedNotification.createdAt,
  };
  pushMessage(sessionId, msg);
  if (notificationCallback) notificationCallback(scopedNotification);
}

/**
 * Handle an inline action button click from the Chief console.
 */
export function handleChiefAction(notificationId: string, actionId: string, params?: Record<string, string>, sessionId?: string, language?: Lang): { reply: string; sessionId: string } {
  const scopedSessionId = (notificationSessionById.get(notificationId) || sessionId || 'chief-default').trim() || 'chief-default';
  const lang: Lang = language || getSessionLang(scopedSessionId);
  // Keep lastActiveChiefSessionId in sync so async notifications (e.g. meeting completion) route to the correct client session
  if (sessionId && sessionId.trim()) lastActiveChiefSessionId = sessionId.trim();

  const actionKey = makeInlineActionIdempotencyKey(notificationId, actionId);
  if (handledInlineActionKeys.has(actionKey)) {
    return { reply: L(lang, 'Already processed. (duplicate click prevention)', '이미 처리된 요청입니다. (중복 클릭 방지)'), sessionId: scopedSessionId };
  }
  handledInlineActionKeys.add(actionKey);

  // If user clicked an inline button, clear any pending proposal for this session
  // to prevent duplicate execution when they also type "응/승인" in chat.
  const pendingMessageId = pendingProposalBySession.get(scopedSessionId);
  if (pendingMessageId) {
    pendingProposals.delete(pendingMessageId);
    pendingProposalBySession.delete(scopedSessionId);
  }

  const extractIdFromAction = (raw: string, prefix: string): string | null => {
    const m = raw.match(new RegExp(`^${prefix}-(.+)$`));
    return m?.[1] || null;
  };

  let reply: string;

  // Normalize: actionId may be compound like "approve-meeting-xxx" or "revise-meeting-xxx"
  if (actionId === 'approve' || actionId.startsWith('approve-') || actionId.startsWith('approve_')) {
    const meetingId = params?.meetingId;
    const taskId = params?.taskId;
    const nextStepLines: string[] = [L(lang, '✅ Confirmed.', '✅ 확정되었습니다.')];

    if (meetingId) {
      const meeting = getMeeting(meetingId);
      if (!meeting) {
        nextStepLines.push(L(lang, '\n\nDone.', '\n\n완료.'));
      } else {
        if (meeting.character === 'planning' || meeting.character === 'brainstorm') {
          const { candidates, canScore } = getMeetingReviewReadiness(meetingId);
          if (canScore) {
            const candidateList = candidates.map((c, i) => `${i + 1}. **${c.name}**: ${c.summary.slice(0, 120)}`).join('\n');
            nextStepLines.push(L(lang,
              `\n\n📋 **${candidates.length} candidates identified:**\n${candidateList}`,
              `\n\n📋 **도출된 후보 ${candidates.length}건:**\n${candidateList}`));
            nextStepLines.push(L(lang,
              `\nTo rank candidates, click the "🏆 Rank Candidates" button on the meeting completion notification.`,
              `\n후보 순위 평가를 원하시면 회의 완료 알림의 "🏆 후보 순위 평가" 버튼을 눌러주세요.`));
          } else {
            nextStepLines.push(L(lang,
              `\n\n📋 No comparable candidates found — skipping scored evaluation.`,
              `\n\n📋 비교 가능한 후보가 없어 점수화 평가는 건너뜁니다.`));
            nextStepLines.push(L(lang,
              `🧭 The Chief will consolidate a final proposal and move to execution.`,
              `🧭 이번 건은 총괄자 최종안으로 취합해 실행 단계로 넘깁니다.`));
          }
        } else if (meeting.sourceMeetingId) {
          // Review meeting confirmed → auto-create spec task from recommendation
          const rec = meeting.decisionPacket?.recommendation;
          const recName = rec?.name || meeting.title;
          const taskTitle = L(lang, `[Spec] ${recName}`, `[기획/명세서] ${recName}`);
          const taskDesc = lang === 'en' ? [
            `Auto-generated task based on confirmed meeting "${meeting.title}".`,
            ``,
            rec ? `## Recommendation` : '',
            rec ? `- Name: ${rec.name}` : '',
            rec?.summary ? `- Summary: ${rec.summary}` : '',
            rec?.score != null ? `- Score: ${Number(rec.score).toFixed(2)}` : '',
            ``,
            `## Requirements`,
            `Based on the above recommendation, write a detailed spec and development plan.`,
            `- Define functional requirements`,
            `- Propose tech stack and architecture`,
            `- Define MVP scope and milestones`,
            `- Identify risks and mitigation strategies`,
          ].filter(Boolean).join('\n') : [
            `회의 "${meeting.title}" 확정 결과 기반 자동 생성 태스크입니다.`,
            ``,
            rec ? `## 추천안` : '',
            rec ? `- 이름: ${rec.name}` : '',
            rec?.summary ? `- 요약: ${rec.summary}` : '',
            rec?.score != null ? `- 점수: ${Number(rec.score).toFixed(2)}` : '',
            ``,
            `## 요구사항`,
            `위 추천안을 기반으로 상세 기획서 및 개발 명세서를 작성하세요.`,
            `- 기능 요구사항 정의`,
            `- 기술 스택 및 아키텍처 제안`,
            `- MVP 범위 및 마일스톤`,
            `- 리스크 및 대응 방안`,
          ].filter(Boolean).join('\n');

          const agents = listAgents();
          let pmAgent = agents.find(a => a.role === 'pm' && a.state === 'idle') || agents.find(a => a.role === 'pm');
          if (!pmAgent) pmAgent = createAgent(suggestFriendlyAgentName('pm'), 'pm', DEFAULT_MODEL_BY_ROLE.pm);

          const newTask = createTask(taskTitle, taskDesc, pmAgent.id);
          setTimeout(() => processQueue(), 200);

          nextStepLines.push(L(lang,
            `\n\n🚀 **Auto-executing:** Creating spec task based on "${recName}" → assigned to ${pmAgent.name} → running`,
            `\n\n🚀 **자동 실행:** 추천안 "${recName}" 기반 기획/명세서 작성 태스크 생성 → ${pmAgent.name}에게 배정 → 실행 중`));
          nextStepLines.push(`📋 ${L(lang, 'Task', '태스크')}: "${taskTitle}"`);
          nextStepLines.push(L(lang, `You'll be notified when it's done.`, `완료 시 자동으로 보고드리겠습니다.`));
        } else {
          const taskTitle = L(lang, `[Execute] ${meeting.title} — confirmed`, `[실행] ${meeting.title} 확정안`);
          const taskDesc = L(lang,
            `Execute the results of meeting "${meeting.title}".\n\n${meeting.report || meeting.proposals.map(p => `${p.agentName}: ${p.content}`).join('\n\n')}`,
            `회의 "${meeting.title}" 결과를 실행하세요.\n\n${meeting.report || meeting.proposals.map(p => `${p.agentName}: ${p.content}`).join('\n\n')}`);
          const agents = listAgents();
          let pmAgent = agents.find(a => a.role === 'pm' && a.state === 'idle') || agents.find(a => a.role === 'pm');
          if (!pmAgent) pmAgent = createAgent(suggestFriendlyAgentName('pm'), 'pm', DEFAULT_MODEL_BY_ROLE.pm);
          const newTask = createTask(taskTitle, taskDesc, pmAgent.id);
          setTimeout(() => processQueue(), 200);
          nextStepLines.push(L(lang,
            `\n\n🚀 **Auto-executing:** Execution task assigned to ${pmAgent.name}.`,
            `\n\n🚀 **자동 실행:** 실행 태스크를 ${pmAgent.name}에게 배정했습니다.`));
          nextStepLines.push(L(lang, `You'll be notified when it's done.`, `완료 시 자동으로 보고드리겠습니다.`));
        }
      }
    } else if (taskId) {
      // Task confirmed — auto-advance chain plan or create follow-up
      const task = listTasks().find(t => t.id === taskId);
      const chainPlan = task ? getChainPlanForTask(taskId) : null;

      if (chainPlan && chainPlan.status !== 'completed' && chainPlan.status !== 'cancelled') {
        const nextIdx = chainPlan.currentStep + 1;
        if (nextIdx < chainPlan.steps.length) {
          // Enable auto-execute and confirm plan if needed
          if (!chainPlan.autoExecute) {
            setChainAutoExecute(chainPlan.id, true);
          }
          if (chainPlan.status === 'proposed') {
            confirmChainPlan(chainPlan.id);
          }
          // Advance to next step
          const { nextStep } = advanceChainPlan(chainPlan.id);
          if (nextStep) {
            // Find or create agent for next step
            const agents = listAgents();
            const idleCandidates = agents.filter(a => a.role === nextStep.role && a.state === 'idle')
              .sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
            const anyCandidates = agents.filter(a => a.role === nextStep.role)
              .sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
            let nextAgent = idleCandidates[0] || anyCandidates[0];
            if (!nextAgent) nextAgent = createAgent(suggestFriendlyAgentName(nextStep.role), nextStep.role, DEFAULT_MODEL_BY_ROLE[nextStep.role]);

            // Bug 4 fix: 기존 prefix 제거 후 현재 단계 prefix만 붙임
            const strippedTaskTitle = (task?.title || '').replace(/^(\[[^\]]*\]\s*)+/, '');
            const nextTitle = `[${nextStep.label}] ${strippedTaskTitle}`.trim();
            const nextDesc = `이전 단계 결과를 기반으로 ${nextStep.label}을(를) 수행하세요.\n\n${nextStep.reason}\n\n## 이전 결과\n${(task?.result || '').slice(0, 4000)}`;
            const newTask = createTask(nextTitle, nextDesc, nextAgent.id, taskId);
            // Link new task to same chain plan so handleRunComplete can find it
            linkTaskToChainPlan(newTask.id, chainPlan.id);
            // Delay processQueue enough for agent to transition to idle (2s idle delay + buffer)
            setTimeout(() => processQueue(), 3000);

            nextStepLines.push(L(lang,
              `\n\n🚀 **Auto-executing:** Next step "${nextStep.label}" task created → assigned to ${nextAgent.name} → running`,
              `\n\n🚀 **자동 실행:** 다음 단계 "${nextStep.label}" 태스크 생성 → ${nextAgent.name}에게 배정 → 실행 중`));
            nextStepLines.push(`📋 ${L(lang, 'Task', '태스크')}: "${nextTitle}"`);
            nextStepLines.push(`📊 ${L(lang, 'Chain progress', '체인 진행')}: ${nextIdx + 1}/${chainPlan.steps.length} ${L(lang, 'steps', '단계')}`);
            nextStepLines.push(L(lang, `You'll be notified when it's done.`, `완료 시 자동으로 보고드리겠습니다.`));
          } else {
            nextStepLines.push(L(lang, `\n\n✅ All chain plan steps completed.`, `\n\n✅ 체인 플랜의 모든 단계가 완료되었습니다.`));
          }
        } else {
          // Chain plan exhausted — fall through to context-based next step derivation below
        }
      }
      // If no chain advancement happened (chain exhausted or no chain), derive next step from task context
      if (nextStepLines.length === 1 && task && task.result) {
        // Only the "✅ 확정되었습니다." line — need to add next step
        // No chain plan — derive next step from task context
        const taskTitle = task.title.toLowerCase();
        let nextRole: import('@clawhq/shared').AgentRole = 'developer';
        let nextLabel = '개발 실행';
        if (/(기획|명세|spec|plan)/i.test(taskTitle)) {
          nextRole = 'developer';
          nextLabel = '개발 실행';
        } else if (/(개발|구현|implement|code)/i.test(taskTitle)) {
          nextRole = 'reviewer';
          nextLabel = '코드 리뷰';
        } else if (/(리뷰|review)/i.test(taskTitle)) {
          nextRole = 'qa';
          nextLabel = 'QA 검증';
        } else {
          // Default: no auto follow-up for ambiguous tasks
          const pendingCount = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress').length;
          if (pendingCount > 0) {
            nextStepLines.push(L(lang,
              `\n\n📌 ${pendingCount} tasks in progress/pending. You'll be notified when done.`,
              `\n\n📌 남은 작업 ${pendingCount}건이 진행/대기 중입니다. 완료 시 자동 보고드립니다.`));
          } else {
            nextStepLines.push(L(lang, `\n\n✅ All tasks completed.`, `\n\n✅ 모든 작업이 완료되었습니다.`));
          }
          reply = nextStepLines.join('');
          // skip the auto-follow-up below
          const replyMsg2: ChiefChatMessage = {
            id: `chief-action-reply-${Date.now()}`,
            role: 'chief',
            content: reply,
            createdAt: new Date().toISOString(),
          };
          pushMessage(scopedSessionId, replyMsg2);
          return { reply, sessionId: scopedSessionId };
        }

        const agents = listAgents();
        const idleOfRole = agents.filter(a => a.role === nextRole && a.state === 'idle')
          .sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
        const anyOfRole = agents.filter(a => a.role === nextRole)
          .sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
        let nextAgent = idleOfRole[0] || anyOfRole[0];
        if (!nextAgent) nextAgent = createAgent(suggestFriendlyAgentName(nextRole), nextRole, DEFAULT_MODEL_BY_ROLE[nextRole]);

        // Bug 4 fix: 기존 prefix 제거
        const nextTaskTitle = `[${nextLabel}] ${task.title.replace(/^(\[[^\]]*\]\s*)+/, '')}`;
        const nextTaskDesc = `이전 태스크 "${task.title}" 결과를 기반으로 ${nextLabel}을(를) 수행하세요.\n\n⚠️ 주의: 코드/결과물은 아래 텍스트에 포함되어 있습니다. 파일 시스템이 아닌 아래 내용을 직접 검토하세요.\n\n## 이전 결과\n${(task.result || '').slice(0, 4000)}`;
        const newTask = createTask(nextTaskTitle, nextTaskDesc, nextAgent.id, taskId);
        setTimeout(() => processQueue(), 3000);

        nextStepLines.push(L(lang,
          `\n\n🚀 **Auto-executing:** "${nextLabel}" task created → assigned to ${nextAgent.name} → running`,
          `\n\n🚀 **자동 실행:** "${nextLabel}" 태스크 생성 → ${nextAgent.name}에게 배정 → 실행 중`));
        nextStepLines.push(`📋 ${L(lang, 'Task', '태스크')}: "${nextTaskTitle}"`);
        nextStepLines.push(L(lang, `You'll be notified when it's done.`, `완료 시 자동으로 보고드리겠습니다.`));
      } else {
        nextStepLines.push(L(lang,
          `\n\n📌 Next step: Check pending/in-progress tasks and provide further instructions if needed.`,
          `\n\n📌 다음 단계: 현재 대기/진행 작업 상태를 확인하고, 필요 시 추가 실행을 지시해주세요.`));
      }
    } else {
      nextStepLines.push(L(lang,
        `\n\n📌 Next step: Check pending/in-progress tasks and provide further instructions if needed.`,
        `\n\n📌 다음 단계: 현재 대기/진행 작업 상태를 확인하고, 필요 시 추가 실행을 지시해주세요.`));
    }

    reply = nextStepLines.join('');
  } else if (actionId === 'request_revision' || actionId.startsWith('revise-') || actionId.startsWith('revision-') || actionId.startsWith('request_revision')) {
    const taskId = params?.taskId;
    const task = taskId ? listTasks(true).find(t => t.id === taskId) : null;
    const reviewLike = !!task && /(review|리뷰|검토|qa|qc)/i.test(task.title);

    if (task && reviewLike) {
      const rootTask = findRootTask(task.id);
      const fixAction: ChiefAction = {
        type: 'create_task',
        params: {
          title: `[Fix] ${rootTask.title.replace(/^\[.*?\]\s*/, '')}`,
          description: [
            `리뷰 태스크 "${task.title}"의 피드백을 반영합니다.`,
            '',
            '---',
            '## 원본 코드/결과',
            (rootTask.result || '(원본 없음)').slice(0, 5000),
            '',
            '---',
            '## 리뷰 피드백',
            (task.result || '(리뷰 피드백 없음)').slice(0, 3000),
          ].join('\n'),
          assignRole: 'developer',
        },
      };
      const pendingId = `fix-from-action-${Date.now()}`;
      pendingProposals.set(pendingId, [fixAction]);
      pendingProposalBySession.set(scopedSessionId, pendingId);
      reply = L(lang,
        `✅ Fix task prepared.\n\n${formatActionForDisplay(fixAction, lang)}\n\nApprove to execute immediately.`,
        `✅ 수정 반영 작업을 준비했습니다.\n\n${formatActionForDisplay(fixAction, lang)}\n\n승인하면 즉시 실행됩니다.`);
    } else {
      reply = L(lang,
        'Revision request noted. What needs to be changed?\n\n💡 The more specific the direction, the faster we can process it.',
        '수정 요청을 접수했습니다. 어떤 부분을 수정해야 할까요?\n\n💡 구체적인 수정 방향을 알려주시면 더 빠르게 처리할 수 있습니다.');
    }
  } else if (actionId === 'view_result' || actionId.startsWith('view-')) {
    const meetingId = extractIdFromAction(actionId, 'view-meeting') || params?.meetingId;
    const taskId = extractIdFromAction(actionId, 'view') || params?.taskId;

    if (meetingId) {
      reply = formatMeetingResult(meetingId, lang);
    } else if (taskId) {
      reply = formatTaskResult(taskId, lang);
    } else {
      reply = L(lang, 'Could not find the result target. Please select from the list.', '확인할 결과 대상을 찾지 못했습니다. 목록에서 다시 선택해주세요.');
    }
  } else if (actionId === 'select_proposal' || actionId.startsWith('select-')) {
    const proposalAgent = params?.agentName || L(lang, 'Selected proposal', '선택된 안');
    reply = L(lang,
      `Selected ${proposalAgent}'s proposal. Shall we proceed?`,
      `${proposalAgent}의 제안을 선택했습니다. 이대로 진행할까요?`);
  } else if (actionId === 'retry' || actionId.startsWith('retry-')) {
    reply = L(lang, 'Retrying. Please wait...', '재시도를 시작합니다. 잠시 기다려주세요.');
  } else if (actionId === 'start_review' || actionId.startsWith('start-review-')) {
    // Auto-start review meeting from source meeting
    const meetingId = extractIdFromAction(actionId, 'start-review') || params?.meetingId;
    if (meetingId) {
      const sourceMeeting = getMeeting(meetingId);
      if (sourceMeeting) {
        const { canScore } = getMeetingReviewReadiness(meetingId);
        if (!canScore) {
          reply = L(lang,
            'ℹ️ No comparable candidates found — skipping candidate evaluation.\n\nPlease proceed with Chief\'s consolidated final proposal.',
            'ℹ️ 비교 가능한 후보가 없어 후보 평가는 생략됩니다.\n\n총괄자 최종안 작성(취합 결정)으로 진행해주세요.');
        } else {
          // Find or create 3 reviewers
          const agents = listAgents();
          const reviewerPool = agents.filter(a => a.role === 'reviewer');
          const reviewerIds: string[] = [];
          for (const r of reviewerPool) {
            if (reviewerIds.length < 3) reviewerIds.push(r.id);
          }
          // Create additional reviewers if needed
          while (reviewerIds.length < 3) {
            const created = createAgent(suggestFriendlyAgentName('reviewer'), 'reviewer', 'claude-opus-4-6' as any);
            reviewerIds.push(created.id);
          }
          const reviewMeeting = startReviewMeetingFromSource(
            L(lang, `[Review] ${sourceMeeting.title}`, `[리뷰] ${sourceMeeting.title}`),
            meetingId,
            reviewerIds,
            lang,
          );
          if (reviewMeeting) {
            reply = L(lang,
              `🔍 Review meeting "${reviewMeeting.title}" started.\n${reviewerIds.length} reviewers are evaluating the planning meeting candidates.\nYou'll be notified with scorecards and the final recommendation.`,
              `🔍 리뷰 미팅 "${reviewMeeting.title}"을 시작했습니다.\n${reviewerIds.length}명의 리뷰어가 기획 회의 후보를 평가 중입니다.\n완료 시 점수표와 최종 추천안을 보고드리겠습니다.`);
          } else {
            reply = L(lang,
              '⚠️ Cannot start review meeting.\n\nAt least 2 scoreable candidates are required. Please generate explicit [CANDIDATE] entries first.',
              '⚠️ 리뷰 미팅을 시작할 수 없습니다.\n\n점수화 대상 후보가 2개 이상 필요합니다. 먼저 명시적 [CANDIDATE] 후보를 도출해 주세요.');
          }
        }
      } else {
        reply = L(lang, 'Source meeting not found.', '리뷰 대상 회의를 찾을 수 없습니다.');
      }
    } else {
      reply = L(lang, 'Source meeting not found.', '리뷰 대상 회의를 찾을 수 없습니다.');
    }
  } else {
    reply = L(lang, 'Request acknowledged. Please try again or choose a different option.', `요청을 확인했습니다. 다시 시도하거나 다른 옵션을 선택해주세요.`);
  }

  const replyMsg: ChiefChatMessage = {
    id: `chief-action-reply-${Date.now()}`,
    role: 'chief',
    content: reply,
    createdAt: new Date().toISOString(),
  };
  pushMessage(scopedSessionId, replyMsg);
  return { reply, sessionId: scopedSessionId };
}

function emitCheckIn(checkIn: ChiefCheckIn) {
  const sessionId = (checkIn.sessionId || lastActiveChiefSessionId || 'chief-default').trim() || 'chief-default';
  const scopedCheckIn: ChiefCheckIn = { ...checkIn, sessionId };
  pushMessage(sessionId, {
    id: scopedCheckIn.id,
    role: 'chief',
    content: scopedCheckIn.message,
    createdAt: scopedCheckIn.createdAt,
  });
  if (checkInCallback) checkInCallback(scopedCheckIn);
}

// Track which tasks/meetings we've already reported on to avoid duplicates
const reportedTaskCompletions = new Set<string>();
const reportedTaskFailures = new Set<string>();
const reportedMeetingCompletions = new Set<string>();

// Session-scoped notification dedup: tracks notificationId hashes to prevent duplicate cards
const emittedNotificationKeys = new Set<string>();

// Idempotency guards for user actions/check-ins (double-click / duplicate UI entry points)
const handledInlineActionKeys = new Set<string>();
const handledCheckInResponseKeys = new Set<string>();

function dedupeNotificationKey(type: string, entityId: string): string {
  return `${type}::${entityId}`;
}

function isNotificationDuplicate(type: string, entityId: string): boolean {
  const key = dedupeNotificationKey(type, entityId);
  if (emittedNotificationKeys.has(key)) return true;
  emittedNotificationKeys.add(key);
  return false;
}

// Unified dedup guard: covers notification + checkin + confirm for same entity
function isEntityFullyReported(entityType: 'task' | 'meeting', entityId: string): boolean {
  const notifKey = `${entityType}_complete::${entityId}`;
  const checkinKey = `checkin_${entityType}::${entityId}`;
  return emittedNotificationKeys.has(notifKey) && emittedNotificationKeys.has(checkinKey);
}

function makeInlineActionIdempotencyKey(notificationId: string, actionId: string): string {
  return `${notificationId}::${actionId}`;
}

function makeCheckInIdempotencyKey(checkInId: string, optionId: string): string {
  return `${checkInId}::${optionId}`;
}

/**
 * Called by index.ts when a task event fires.
 * Chief monitors progress and proactively communicates with the user.
 */
export function chiefHandleTaskEvent(event: AppEvent) {
  const lang = getSessionLang(lastActiveChiefSessionId);
  // Issue 2: Chain completion notification in chat
  if (event.type === 'chain_completed' && event.taskId) {
    const tasks = listTasks();
    const rootTask = tasks.find(t => t.id === event.taskId);
    if (rootTask && !isNotificationDuplicate('chain_complete', event.taskId)) {
      const plan = getChainPlanForTask(event.taskId);
      const agents = listAgents();
      let stepLine = '';
      if (plan) {
        stepLine = plan.steps.map(s => {
          const agent = s.agentId ? agents.find(a => a.id === s.agentId) : null;
          return `${s.label}${agent ? ` (${agent.name})` : ''} ✅`;
        }).join(' → ');
      }

      // Check if last step was review and extract verdict
      let reviewInfo = '';
      if (rootTask.result) {
        const passMatch = rootTask.result.match(/PASS|FAIL|합격|불합격/i);
        const findingsMatch = rootTask.result.match(/(\d+)\s*건?\s*(issue|finding|문제|지적)/i);
        if (passMatch) {
          const verdict = /PASS|합격/i.test(passMatch[0]) ? '✅ PASS' : '❌ FAIL';
          const findings = findingsMatch ? ` (${findingsMatch[1]}건 issues)` : '';
          reviewInfo = `\n📋 리뷰 결과: ${verdict}${findings}`;
          if (/FAIL|불합격/i.test(passMatch[0])) {
            reviewInfo += `\n💡 "리뷰 피드백 반영해줘"라고 하면 수정 작업을 시작합니다.`;
          }
        } else {
          // No explicit PASS/FAIL — check if review has critical/major issues
          const hasCriticalIssues = /\b(critical|major|심각|중대|필수\s*수정)\b/i.test(rootTask.result);
          const isCleanPass = /\b(PASS|통과|합격)\b/i.test(rootTask.result) && !hasCriticalIssues;
          if (hasCriticalIssues && !isCleanPass) {
            reviewInfo = `\n📋 리뷰 결과: ❌ 수정 필요`;
            reviewInfo += `\n💡 "리뷰 피드백 반영해줘"라고 하면 수정 작업을 시작합니다.`;
          }
        }
      }

      // Auto-show result preview (Issue 5)
      const resultPreview = rootTask.result
        ? '\n\n📄 **결과 미리보기:**\n' + rootTask.result.slice(0, 300).replace(/\n{2,}/g, '\n') + (rootTask.result.length > 300 ? '...' : '')
        : '';

      const summary = L(lang,
        `🎉 [Chain Complete] "${rootTask.title}" — full pipeline finished.\n${stepLine ? `• ${stepLine}` : ''}${reviewInfo}${resultPreview}\n\n📊 Click "View Result" to see the final output.`,
        `🎉 [체인 완료] "${rootTask.title}" 전체 파이프라인이 완료되었습니다.\n${stepLine ? `• ${stepLine}` : ''}${reviewInfo}${resultPreview}\n\n📊 결과 보기 버튼으로 최종 결과를 확인하세요.`);

      notifyChief({
        id: `notif-chain-complete-${event.taskId}-${Date.now()}`,
        type: 'task_complete',
        title: L(lang, `🎉 Chain Complete: ${rootTask.title}`, `🎉 체인 완료: ${rootTask.title}`),
        summary,
        actions: [
          { id: `view-${event.taskId}`, label: '📄 결과 보기', action: 'view_result', params: { taskId: event.taskId } },
          { id: `approve-${event.taskId}`, label: '✅ 확정', action: 'approve', params: { taskId: event.taskId } },
        ],
        taskId: event.taskId,
        createdAt: new Date().toISOString(),
      });

      // notifyChief already injects into chief chat stream; avoid duplicate completion messages.
    }
    return;
  }

  if (event.type === 'chain_spawned' && event.taskId) {
    // Bug 3 fix: autoAdvance가 켜져 있으면 확인 요청 메시지를 보내지 않음
    // event.taskId가 자식 태스크일 수 있으므로 모든 활성 플랜에서 autoExecute 확인
    const chainPlanForSpawn = getChainPlanForTask(event.taskId);
    const allActivePlans = listActiveChainPlans();
    const anyAutoExec = chainPlanForSpawn?.autoExecute || allActivePlans.some(p => p.autoExecute);
    if (anyAutoExec) {
      return; // 자동실행 모드에서는 확인 요청 스킵
    }

    // Bug 5 fix: 체인이 완료 상태거나 다음 단계가 없으면 check-in 스킵
    if (chainPlanForSpawn) {
      const isChainDone = chainPlanForSpawn.status === 'completed' || chainPlanForSpawn.status === 'cancelled';
      const noMoreSteps = chainPlanForSpawn.currentStep >= chainPlanForSpawn.steps.length - 1;
      if (isChainDone || noMoreSteps) {
        return; // 체인 종료 — "다음 단계 추천" 팝업 불필요
      }
    }

    emitCheckIn({
      id: `checkin-chain-${event.taskId}-${Date.now()}`,
      stage: 'progress',
      message: `🔗 **추천:** 다음 단계로 진행하는 것을 권장합니다.\n현재 단계 결과를 바탕으로 자동 시작했습니다. 원치 않으면 멈출 수 있습니다.\n\n${event.message}`,
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
    const resultPreview = summarizeTaskResult(task.result, lang);
    const elapsedMs = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
    const elapsedSec = Math.round(elapsedMs / 1000);

    const deliverables = listDeliverablesByTask(event.taskId);
    const webDeliverables = deliverables.filter(d => d.type === 'web');
    let validationWarning = '';
    for (const wd of webDeliverables) {
      const validation = validateWebDeliverable(wd.content);
      if (!validation.valid) {
        validationWarning = L(lang,
          `\n\n⚠️ **Blank Screen Risk Warning**:\n${validation.issues.map(i => `• ${i}`).join('\n')}\n\n🔍 Checklist: DOM mount / console errors / network 404·500 / render loop\nRevision recommended.`,
          `\n\n⚠️ **빈 화면 위험 경고**:\n${validation.issues.map(i => `• ${i}`).join('\n')}\n\n🔍 체크리스트: DOM mount 확인 / console error 확인 / network 404·500 확인 / 렌더 루프 여부\n수정 요청을 권장합니다.`);
        break;
      }
    }

    // Dedup: skip if already emitted for this task
    if (isNotificationDuplicate('task_complete', event.taskId)) return;

    const isReviewTask = /(review|리뷰|검토|qa|qc)/i.test(task.title);
    const needsFixFromReview = isReviewTask && hasCriticalReviewFindings(task.result);
    const reviewFixHint = needsFixFromReview
      ? L(lang,
        `\n\n💡 To apply review fixes, click "🔧 Apply Fix" below or say "apply review feedback".`,
        `\n\n💡 리뷰 피드백 반영이 필요하면 아래 "🔧 수정 반영(Fix)" 버튼(또는 "리뷰 피드백 반영해줘")을 사용하세요.`)
      : '';

    // Emit notification with inline actions
    notifyChief({
      id: `notif-task-${event.taskId}-${Date.now()}`,
      type: webDeliverables.length > 0 && validationWarning ? 'task_failed' : 'task_complete',
      title: task.title,
      summary: L(lang,
        `✅ [Task Complete] "${task.title}"\nAssigned: ${assignee?.name || 'Unassigned'} (${assignee?.role || '-'}) | Duration: ${elapsedSec}s${validationWarning}${reviewFixHint}${task.result ? '\n\n📄 **Result Preview:**\n' + task.result.slice(0, 300).replace(/\n{2,}/g, '\n') + (task.result.length > 300 ? '...' : '') : ''}`,
        `✅ [태스크 완료] "${task.title}"\n담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'}) | 소요: ${elapsedSec}초${validationWarning}${reviewFixHint}${task.result ? '\n\n📄 **결과 미리보기:**\n' + task.result.slice(0, 300).replace(/\n{2,}/g, '\n') + (task.result.length > 300 ? '...' : '') : ''}`),
      actions: [
        { id: `view-${event.taskId}`, label: '📄 결과 보기', action: 'view_result', params: { taskId: event.taskId } },
        { id: `approve-${event.taskId}`, label: '✅ 확정', action: 'approve', params: { taskId: event.taskId } },
        { id: `revise-${event.taskId}`, label: needsFixFromReview ? '🔧 수정 반영(Fix)' : '🔄 수정 요청', action: 'request_revision', params: { taskId: event.taskId } },
      ],
      taskId: event.taskId,
      createdAt: new Date().toISOString(),
    });

    // Batch consolidation: if this task belongs to a batch and all batch tasks are done,
    // automatically create a consolidation task that merges all results
    if (task.batchId && isBatchComplete(task.batchId)) {
      const batchKey = `batch_consolidation::${task.batchId}`;
      if (!emittedNotificationKeys.has(batchKey)) {
        emittedNotificationKeys.add(batchKey);
        const { tasks: batchTasks, combinedResult } = getBatchResults(task.batchId);
        
        // Create consolidation task assigned to a PM
        const agents = listAgents();
        let pmAgent = agents.find(a => a.role === 'pm' && a.state === 'idle') || agents.find(a => a.role === 'pm');
        if (!pmAgent) pmAgent = createAgent(suggestFriendlyAgentName('pm'), 'pm', DEFAULT_MODEL_BY_ROLE.pm);

        const consolidationTitle = `[취합 보고서] ${batchTasks.map(t => t.title).join(' + ')}`;
        const consolidationDesc = [
          `## 병렬 작업 결과 취합`,
          `아래 ${batchTasks.length}건의 작업 결과를 분석하여 **하나의 통합 보고서**로 정리하세요.`,
          ``,
          `### 요구사항`,
          `1. 각 작업의 핵심 내용을 비교/분석`,
          `2. 공통점과 차이점 정리`,
          `3. 최종 추천안 또는 통합 결론 도출`,
          `4. 우선순위가 있다면 순위 매기기`,
          ``,
          `---`,
          ``,
          combinedResult,
        ].join('\n');

        const consolidationTask = createTask(consolidationTitle, consolidationDesc, pmAgent.id);
        // Auto-execute chain for consolidation tasks — no user check-in needed
        const consolidationPlan = getChainPlanForTask(consolidationTask.id);
        if (consolidationPlan) {
          setChainAutoExecute(consolidationPlan.id, true);
          confirmChainPlan(consolidationPlan.id);
        }
        setTimeout(() => processQueue(), 200);

        notifyChief({
          id: `notif-batch-consolidation-${task.batchId}-${Date.now()}`,
          type: 'task_complete',
          title: `📋 병렬 작업 ${batchTasks.length}건 완료 → 취합 진행 중`,
          summary: `✅ 병렬 작업 ${batchTasks.length}건이 모두 완료되었습니다.\n\n` +
            batchTasks.map(t => `• "${t.title}" ✅`).join('\n') +
            `\n\n🔄 결과를 통합하는 취합 보고서를 ${pmAgent.name}에게 배정하여 자동 진행 중입니다.`,
          actions: [],
          createdAt: new Date().toISOString(),
        });
      }
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
      summary: L(lang,
        `❌ [Task Failed] "${task.title}"\nAssigned: ${assignee?.name || 'Unassigned'} (${assignee?.role || '-'})\nError: ${(task.result || event.message || 'Unknown error').slice(0, 200)}`,
        `❌ [태스크 실패] "${task.title}"\n담당: ${assignee?.name || '미배정'} (${assignee?.role || '-'})\n오류: ${(task.result || event.message || '알 수 없는 오류').slice(0, 200)}`),
      actions: [
        { id: `view-${event.taskId}`, label: '📄 상세 보기', action: 'view_result', params: { taskId: event.taskId } },
        { id: `retry-${event.taskId}`, label: '🔄 재시도', action: 'custom', params: { taskId: event.taskId, command: 'retry' } },
      ],
      taskId: event.taskId,
      createdAt: new Date().toISOString(),
    });

    // No check-in — notification card above is the single entry point
  }
}

/**
 * Called by index.ts when a meeting changes state.
 * Chief reports meeting progress and asks for decisions.
 */
export function chiefHandleMeetingChange() {
  const lang = getSessionLang(lastActiveChiefSessionId);
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
        ? compactText(meeting.report, 500, lang)
        : compactText(participantSummary, 500, lang);

      // Build context-appropriate actions
      const meetingActions: any[] = [
        { id: `view-meeting-${meeting.id}`, label: '📊 결과 보기', action: 'view_result', params: { meetingId: meeting.id } },
      ];

      // If planning/brainstorm meeting, only allow review scoring when explicit comparable candidates exist.
      const isPlanningLike = meeting.character === 'planning' || meeting.character === 'brainstorm';
      const readiness = isPlanningLike ? getMeetingReviewReadiness(meeting.id) : null;
      if (isPlanningLike && readiness?.canScore) {
        meetingActions.push(
          { id: `start-review-${meeting.id}`, label: '🏆 후보 순위 평가 (리뷰어가 점수 매김)', action: 'start_review', params: { meetingId: meeting.id } },
        );
      }

      meetingActions.push(
        {
          id: `approve-meeting-${meeting.id}`,
          label: isPlanningLike && !(readiness?.canScore) ? '🧭 총괄자 최종안 작성' : '✅ 확정',
          action: 'approve',
          params: {
            meetingId: meeting.id,
            mode: isPlanningLike && !(readiness?.canScore) ? 'finalize_by_chief' : 'confirm',
          },
        },
        { id: `revise-meeting-${meeting.id}`, label: '🔄 수정 요청', action: 'request_revision', params: { meetingId: meeting.id } },
      );

      // Show lineage info in summary
      let lineageInfo = '';
      if (meeting.sourceMeetingId) {
        const sourceMeeting = getMeeting(meeting.sourceMeetingId);
        if (sourceMeeting) {
          lineageInfo = `\n📌 기반: "${sourceMeeting.title}" 결과를 평가한 리뷰입니다.`;
        }
      }

      // Dedup: skip if we already emitted a notification for this meeting
      if (!isNotificationDuplicate('meeting_complete', meeting.id)) {
        const participantCount = meeting.participants?.length || contributionCount;
        const noCandidateHint = isPlanningLike && !(readiness?.canScore)
          ? L(lang,
            '\n\nℹ️ No comparable candidates found — candidate evaluation is disabled. Please proceed with Chief\'s consolidated final proposal.',
            '\n\nℹ️ 비교 가능한 후보가 없어 후보 평가는 비활성화되었습니다. 총괄자 최종안 작성으로 진행하세요.')
          : '';
        notifyChief({
          id: `notif-meeting-${meeting.id}-${Date.now()}`,
          type: 'meeting_complete',
          title: meeting.title,
          summary: L(lang,
            `🏛️ [Meeting Complete] "${meeting.title}"\n\n${contributionCount} of ${participantCount} participants completed discussions.${lineageInfo}\n\n${reportPreview}${noCandidateHint}\n\nReview the results and decide on next steps.`,
            `🏛️ [회의 완료] "${meeting.title}"\n\n참여자 ${participantCount}명 중 ${contributionCount}명이 논의를 완료했습니다.${lineageInfo}\n\n${reportPreview}${noCandidateHint}\n\n결과를 확인하고 다음 단계를 결정해주세요.`),
          actions: meetingActions,
          meetingId: meeting.id,
          createdAt: new Date().toISOString(),
        });
      }

      // For review meetings with source candidates, generate a decision packet
      if (meeting.sourceMeetingId && meeting.sourceCandidates && meeting.sourceCandidates.length > 0) {
        const decisionPacket = generateDecisionPacket(meeting);
        if (decisionPacket) {
          try {
            stmts.updateMeetingLineage.run(
              meeting.parentMeetingId || null,
              meeting.sourceMeetingId || null,
              meeting.sourceCandidates ? JSON.stringify(meeting.sourceCandidates) : null,
              JSON.stringify(decisionPacket),
              meeting.id,
            );
          } catch { /* ignore */ }
        }
      }

      // Check-in removed: notification card above already provides 확정/수정요청 buttons.
      // Emitting both caused duplicate cards and duplicate meeting result content (Bug #2 & #3).
    }
  }
}

/**
 * Handle user's response to a check-in option.
 * Returns a chief message with follow-up or action.
 */
export function respondToCheckIn(checkInId: string, optionId: string, userComment?: string, language?: Lang): { reply: string; actions?: ChiefAction[] } {
  const lang: Lang = language || 'ko';
  const dedupeKey = makeCheckInIdempotencyKey(checkInId, optionId);
  if (handledCheckInResponseKeys.has(dedupeKey)) {
    return { reply: L(lang, 'Already processed. (duplicate click prevention)', '이미 처리된 응답입니다. (중복 클릭 방지)') };
  }
  handledCheckInResponseKeys.add(dedupeKey);

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
  const lang = getSessionLang(sessionId);
  const seeded: ChiefChatMessage[] = [{
    id: `chief-welcome-${Date.now()}`,
    role: 'chief',
    content: L(lang,
      "Hello, I'm the Chief. I'll review the current office state and suggest team composition and execution plans. What shall we start?",
      '안녕하세요, 총괄자입니다. 현재 오피스 상태를 보고 팀 편성과 실행 플랜을 제안해드릴게요. 어떤 일을 시작할까요?'),
    createdAt: new Date().toISOString(),
  }];
  sessionMessages.set(sessionId, seeded);
  return seeded;
}

function pushMessage(sessionId: string, message: ChiefChatMessage) {
  // Guard: never push empty chief messages (causes blank bubbles in sidebar)
  if (message.role === 'chief') {
    const hasContent = (message.content || '').trim().length > 0;
    const hasNotification = message.notification != null;
    if (!hasContent && !hasNotification) {
      console.warn(`[chief] Dropped empty chief message id=${message.id} session=${sessionId}`);
      return;
    }
  }
  const list = getSessionMessages(sessionId);
  list.push(message);
  if (list.length > MAX_HISTORY) {
    list.splice(0, list.length - MAX_HISTORY);
  }
}

export function summarizeOfficeState(): string {
  const agents = listAgents();
  // Re-read tasks from DB at call time for freshest status
  const tasks = listTasks();
  const meetings = listMeetings();

  // Bug 1 fix: 체인 플랜 완료된 태스크는 DB가 in-progress여도 completed로 표시
  // + DB에서 실시간 재조회하여 stale 캐시 문제 해결
  const correctedTasks = tasks.map(t => {
    if (t.status === 'in-progress') {
      // Re-check actual DB status to catch race with completion
      const freshRow = stmts.getTask.get(t.id) as Record<string, unknown> | undefined;
      if (freshRow && (freshRow.status as string) === 'completed') {
        return { ...t, status: 'completed' as import('@clawhq/shared').TaskStatus, result: (freshRow.result as string) ?? t.result };
      }
      const plan = getChainPlanForTask(t.id);
      if (plan && (plan.status === 'completed' || plan.currentStep >= plan.steps.length - 1)) {
        return { ...t, status: 'completed' as import('@clawhq/shared').TaskStatus };
      }
    }
    return t;
  });
  const pendingTasks = correctedTasks.filter((t) => t.status === 'pending');
  const activeTasks = correctedTasks.filter((t) => t.status === 'in-progress');
  const completedTasks = correctedTasks.filter((t) => t.status === 'completed');
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

  const lines = [
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
  ];

  // Include recent completed task results for Chief context
  const recentWithResults = completedTasks.filter(t => t.result).slice(0, 3);
  if (recentWithResults.length > 0) {
    lines.push('');
    lines.push(`## 최근 완료 태스크 결과 (상위 ${recentWithResults.length}건)`);
    for (const task of recentWithResults) {
      lines.push(`\n📋 완료된 태스크 "${task.title}" 결과 (요약):`);
      lines.push(task.result!.slice(0, 500));
    }
  }

  // Include recent review results for fix-request context
  const recentReviews = completedTasks
    .filter(t => t.title.startsWith('[Review]') || t.title.startsWith('[리뷰]') || t.title.startsWith('[코드 리뷰]'))
    .slice(0, 2);
  if (recentReviews.length > 0) {
    lines.push('');
    lines.push(`## 최근 리뷰 결과`);
    for (const rv of recentReviews) {
      const isPass = /\b(PASS|통과|합격)\b/i.test(rv.result || '') && !/\b(FAIL|실패|불합격|critical|major)\b/i.test(rv.result || '');
      lines.push(`\n🔍 "${rv.title}" — ${isPass ? '✅ PASS' : '❌ 수정 필요'}`);
      if (!isPass && rv.result) {
        lines.push(rv.result.slice(0, 400));
      }
    }
  }

  return lines.join('\n');
}

function buildChiefSystemPrompt(language: 'en' | 'ko' = 'ko'): string {
  const state = summarizeOfficeState();

  const langRule = language === 'en'
    ? '5. Respond in English.'
    : '5. 한국어로 대화하세요.';

  const intro = language === 'en'
    ? 'You are ClawHQ\'s Chief (총괄자).'
    : '당신은 ClawHQ의 총괄자(Chief)입니다.';

  if (language === 'en') {
    return `${intro}

Rules:
1. Be concise. Default is 1-2 sentences; never exceed 3 sentences.
2. For simple operations (status check, delete, cancel), suggest execution immediately. Do not suggest meetings.
3. Only present options for complex tasks (new projects, team composition, etc.).
4. Present at most 2 options when giving choices.
${langRule}
6. Always get user approval before execution.
7. Use taskId, agentId, etc. directly from the office state below.
8. For simple/definitional questions (e.g. "explain principles", "summarize criteria", "N-item checklist"), give a direct short answer without unnecessary execution suggestions.
9. When a chain is in progress and the user makes additional requests, inform them the content will be applied to the next step.
10. For add/create/reset/cancel requests, respond in 1-2 sentences with only the minimum required actions.

Response length:
- Status query → 1-2 sentences (one line if possible)
- Simple action (add/create/reset/cancel) → 1-2 sentences + minimal actions
- Simple/definitional explanation → max 4 lines
- Complex planning → max 8 lines + 2 options

When proposing chains/pipelines:
- Always frame as "Here's the recommended plan. Approve to execute."
- Before approval, never use definitive phrases like "executing" or "proceeding".
- For role transitions (e.g. QA→Dev), use "Recommending X as the next step. Shall we proceed?"

Only suggest meetings when:
- The user explicitly requests a meeting
- Complex work requiring 3+ agents to collaborate
Never suggest meetings for simple tasks (delete, status check, single-agent work).

## Auto Difficulty Assessment
When the user requests a new project/feature, assess difficulty first and suggest the appropriate flow.

**Level 1 — Simple**
- Criteria: Single page/component, existing feature modification, UI change, style update
- Examples: "Create a login page", "Change button color", "Fix header"
- Flow: Assign directly to 1 Developer
- Actions: create_task → assign (developer)

**Level 2 — Standard**
- Criteria: CRUD app, multiple pages, API integration, single service scope
- Examples: "Build a chat app", "Todo CRUD", "Create a bulletin board"
- Flow: PM writes spec → Developer implements → Reviewer reviews
- Actions: create_task (PM spec) → chain to dev/review after completion

**Level 3 — Complex**
- Criteria: Multi-service/microservices, real-time features, DB design needed, large-scale architecture, mixed tech stacks
- Examples: "SNS platform", "E-commerce site", "Real-time collaboration tool", "SaaS product"
- Flow (topic is decided):
  1. First convene a technical review meeting (start_meeting, character="architecture")
  2. PM writes development spec based on meeting results (create_task, PM)
  3. Distribute role-based tasks from the spec (parallelizable)
- Flow (topic/idea is NOT decided, e.g. "I want to build the best project"):
  1. Brainstorm meeting (start_meeting, character="brainstorm") — generate candidate ideas
  2. After completion, review/evaluate candidates (start_review) — score and select
  3. Planning meeting for the selected topic (start_meeting, character="planning")
  4. PM spec → role-based development
- Decision: If the user specified a concrete project → architecture. If they're exploring ideas → brainstorm.
- Action order (topic decided): start_meeting (architecture) → confirm → PM spec → role-based create_task
- Action order (idea exploration): start_meeting (brainstorm) → start_review → confirm → planning → create_task

Assessment notes:
- If the user explicitly says "skip meeting" or "just build it", respect their preference.
- When in doubt, treat as Standard. Fast execution beats excessive process.
- Briefly inform the user of your difficulty assessment (e.g. "This looks complex. Shall we start with a technical review meeting?")

## Meeting Flow Rules (Strict)
- "Have N PMs meet first" → Always create/run the meeting first.
- Do not pre-present candidate proposals before the meeting. Candidates are derived only from meeting results.
- Order: Create meeting → Wait for completion → Report results → Present candidates (strictly follow this order)
- Never present "Plan A/B/C" or candidate lists before a meeting.

## Current Office State
${state}

## Action Format
Include actions in the following format (not auto-executed — requires user approval):

[ACTION:create_task title="Task Title" description="Description" assignRole="developer"]
[ACTION:create_agent name="Name" role="pm" model="claude-opus-4-6"]
[ACTION:start_meeting title="Meeting Title" participants="pm,developer,reviewer" participantCount="3" character="planning"]
[ACTION:assign_task taskId="taskID" agentId="agentID"]
[ACTION:cancel_task taskId="taskID"]
[ACTION:cancel_all_pending]
[ACTION:reset_agent agentId="agentID"]
[ACTION:cancel_meeting meetingId="meetingID"]
[ACTION:delete_meeting meetingId="meetingID"]
[ACTION:delete_all_meetings]
[ACTION:confirm_meeting meetingId="meetingID"]
[ACTION:confirm_task taskId="taskID"]
[ACTION:start_review meetingId="meetingID"]
[ACTION:view_task_result taskId="taskID"]

Decision actions:
- confirm_meeting: Confirm a completed meeting and auto-execute next step (meetingId optional — auto-selects latest completed meeting)
- confirm_task: Confirm a completed task and auto-advance chain (taskId optional — defaults to latest completed task)
- start_review: Score brainstorming/planning meeting results via reviewers (meetingId optional — defaults to latest meeting)
- When user says "confirm", "proceed", "next step", suggest the appropriate confirm action.
- When user says "review", "score", "evaluate candidates", suggest start_review.
- view_task_result: Retrieve and display detailed results of a completed task

Cancel/Stop actions:
- cancel_task: Cancel a specific task (works for both pending AND in-progress tasks, kills running agent)
- cancel_all_pending: Cancel ALL tasks (pending + in-progress) and kill running agents
- cancel_meeting / delete_meeting / delete_all_meetings: Remove meetings
- When user says "stop", "cancel", "kill", "종료", "멈춰", "전체 종료", "stop all", etc., ALWAYS include the appropriate cancel/delete ACTION tags. Do not just describe what to do — emit the action tags so they can be executed.

Available roles: pm, developer, reviewer, designer, devops, qa
Available models: claude-opus-4-6, claude-sonnet-4, openai-codex/o3, openai-codex/gpt-5.3-codex
Available characters: brainstorm, planning, review, retrospective, kickoff, architecture, design, sprint-planning, estimation, demo, postmortem, code-review, daily
- brainstorm: Idea generation / candidate derivation
- planning: Spec/plan writing (based on confirmed topic)
- kickoff: Project kickoff (goals/roles/timeline)
- architecture: Technical architecture design
- design: UI/UX design
- sprint-planning: Sprint planning / task distribution
- estimation: Effort/resource/timeline estimation
- demo: Deliverable demo review
- postmortem: Incident/failure analysis
- code-review: Code review
- daily: Daily standup
- retrospective: Retrospective (what went well/improvements/action items)
- review: Candidate scoring/evaluation

Character selection: Auto-select the type matching user request context. E.g. "architecture design meeting" → architecture, "sprint planning" → sprint-planning

Reuse existing agents when possible — don't create new ones unnecessarily.

## Review Feedback Application
When the user says "apply review feedback", "fix it", "apply fixes", etc.:
1. Reference the most recently completed review result (check office state above)
2. Suggest creating a fix task with [Fix] prefix via create_task
3. Include "apply review feedback" in the task description
4. Assign to developer with assignRole="developer" (Dev→Review 2-step chain auto-applies)`;
  }

  return `${intro}

규칙:
1. 간결하게 답하세요. 기본은 1~2문장, 필요해도 3문장을 넘기지 마세요.
2. 상태 조회, 삭제, 취소 같은 단순 작업은 바로 실행 제안하세요. 미팅을 제안하지 마세요.
3. 복잡한 작업(새 프로젝트 시작, 팀 구성 등)에만 옵션을 제시하세요.
4. 옵션을 제시할 때는 최대 2개까지만.
${langRule}
6. 실행 전에 반드시 사용자 승인을 받으세요.
7. 아래 오피스 상태를 참고해 taskId, agentId 등을 직접 사용하세요.
8. 단순/정의형 질문(예: "원칙 설명", "기준 요약", "체크리스트 n개")은 설명 모드로 짧게 직답하고, 불필요한 실행 제안/추가 액션 요청을 붙이지 마세요.
9. 체인이 진행 중일 때 사용자가 추가 요청을 하면, 해당 내용을 다음 단계에 반영할 것임을 알려주세요.
9. add/create/reset/cancel 계열 요청은 1~2문장으로 답하고, 필요한 최소 액션만 제시하세요.

응답 길이:
- 상태 조회 → 1~2문장(가능하면 한 줄)
- 단순 액션(add/create/reset/cancel) → 1~2문장 + 최소 액션
- 단순/정의형 설명 요청 → 최대 4줄
- 복잡한 기획 → 최대 8줄 + 옵션 2개

체인/파이프라인 제안 시:
- 반드시 "추천안입니다. 확정하시면 실행합니다." 형태로 안내하세요.
- 확정 전에는 "실행합니다" 또는 "진행합니다" 같은 단정 문구를 사용하지 마세요.
- QA→Dev 등 역할 전환 시 "다음 단계로 ○○를 추천합니다. 진행할까요?" 형태를 사용하세요.

미팅은 다음 경우에만 제안하세요:
- 사용자가 명시적으로 회의를 요청한 경우
- 3명 이상의 에이전트가 협업해야 하는 복잡한 작업인 경우
단순 작업(삭제, 상태 확인, 1인 작업)에는 절대 미팅을 제안하지 마세요.

## 요청 난이도 자동 판단
사용자가 새 프로젝트/기능을 요청하면 먼저 난이도를 판단하고, 그에 맞는 플로우를 제안하세요.

**Level 1 — Simple (단순)**
- 기준: 단일 페이지/컴포넌트, 기존 기능 수정, UI 변경, 스타일 수정
- 예시: "로그인 페이지 만들어줘", "버튼 색 바꿔줘", "헤더 수정"
- 플로우: Developer 1명에게 바로 배정
- 액션: create_task → assign (developer)

**Level 2 — Standard (보통)**
- 기준: CRUD 앱, 여러 페이지, API 연동, 단일 서비스 범위
- 예시: "채팅 앱 만들어줘", "Todo CRUD", "게시판 만들어줘"
- 플로우: PM 명세서 작성 → Developer 구현 → Reviewer 리뷰
- 액션: create_task (PM 기획) → 완료 후 체인으로 개발/리뷰

**Level 3 — Complex (복잡)**
- 기준: 다중 서비스/마이크로서비스, 실시간 기능, DB 설계 필요, 대규모 아키텍처, 여러 기술 스택 혼합
- 예시: "SNS 플랫폼", "이커머스 사이트", "실시간 협업 툴", "SaaS 제품"
- 플로우 (주제가 정해진 경우):
  1. 먼저 기술 검토 회의를 소집 (start_meeting, character="architecture")
  2. 회의 결과를 바탕으로 PM이 개발 명세서 작성 (create_task, PM)
  3. 명세서 기반으로 역할별 태스크 분배
- 플로우 (주제/아이디어가 정해지지 않은 경우, 예: "최고의 프로젝트 만들고 싶어"):
  1. 브레인스토밍 회의 (start_meeting, character="brainstorm") — 후보 아이디어 도출
  2. 회의 완료 후 리뷰 평가 (start_review) — 후보 점수화 및 최종 선정
  3. 선정된 주제로 기획 회의 (start_meeting, character="planning")
  4. PM 명세서 → 역할별 개발
- 판단 기준: 사용자가 구체적인 프로젝트를 지정했으면 architecture, 아이디어를 찾는 단계면 brainstorm
- 액션 순서 (주제 확정): start_meeting (architecture) → confirm → PM 명세서 → 역할별 create_task
- 액션 순서 (아이디어 탐색): start_meeting (brainstorm) → start_review → confirm → planning → create_task

판단 시 주의:
- 사용자가 "회의 없이 바로 해줘", "바로 개발해줘" 등 명시적으로 요청하면 그 의사를 존중하세요.
- 애매하면 Standard로 처리하세요. 과도한 프로세스보다 빠른 실행이 낫습니다.
- 난이도 판단 결과를 사용자에게 간결히 알려주세요 (예: "복잡한 프로젝트로 판단됩니다. 기술 검토 회의부터 시작할까요?")

## 미팅 흐름 규칙 (엄격)
- "PM N명 먼저 미팅" 요청 시: 반드시 미팅을 먼저 생성/실행하세요.
- 미팅 생성 전에 후보안을 선제 제시하지 마세요. 후보는 미팅 완료 후 결과에서만 도출됩니다.
- 순서: 미팅 생성 → 미팅 완료 대기 → 결과 보고 → 후보 제시 (이 순서를 반드시 지키세요)
- 미팅 전에 "A안/B안/C안" 또는 후보 목록을 제시하면 안 됩니다.

## 현재 오피스 상태
${state}

## 액션 형식
실행할 액션을 아래 형식으로 포함하세요 (자동 실행 안 됨, 사용자 승인 필요):

[ACTION:create_task title="작업 제목" description="설명" assignRole="developer"]
[ACTION:create_agent name="이름" role="pm" model="claude-opus-4-6"]
[ACTION:start_meeting title="미팅 제목" participants="pm,developer,reviewer" participantCount="3" character="planning"]
[ACTION:assign_task taskId="태스크ID" agentId="에이전트ID"]
[ACTION:cancel_task taskId="태스크ID"]
[ACTION:cancel_all_pending]
[ACTION:reset_agent agentId="에이전트ID"]
[ACTION:cancel_meeting meetingId="미팅ID"]
[ACTION:delete_meeting meetingId="미팅ID"]
[ACTION:delete_all_meetings]
[ACTION:confirm_meeting meetingId="미팅ID"]
[ACTION:confirm_task taskId="태스크ID"]
[ACTION:start_review meetingId="미팅ID"]
[ACTION:view_task_result taskId="태스크ID"]

의사결정 액션:
- confirm_meeting: 완료된 미팅을 확정하고 다음 단계 자동 실행 (meetingId 생략 가능 — 최근 완료 미팅 자동 선택)
- confirm_task: 완료된 태스크를 확정하고 체인 다음 단계 자동 실행 (taskId 생략 시 최근 완료 태스크)
- start_review: 브레인스토밍/기획 미팅 결과를 리뷰어 점수화 (meetingId 생략 시 최근 미팅)
- 사용자가 "확정", "진행", "다음 단계" 등을 말하면 적절한 confirm 액션을 제안하세요.
- 사용자가 "리뷰", "점수화", "후보 평가" 등을 말하면 start_review를 제안하세요.
- view_task_result: 완료된 태스크의 상세 결과를 조회하여 사용자에게 보여줌

취소/종료 액션:
- cancel_task: 특정 태스크 취소 (대기 + 진행중 모두 가능, 실행 중인 에이전트 프로세스도 종료)
- cancel_all_pending: 전체 태스크 취소 (대기 + 진행중 모두 종료)
- cancel_meeting / delete_meeting / delete_all_meetings: 미팅 삭제
- 사용자가 "종료", "멈춰", "취소", "전체 종료", "stop", "kill" 등을 말하면 반드시 적절한 cancel/delete ACTION 태그를 포함하세요. 설명만 하지 말고 실행 가능한 액션 태그를 반드시 출력하세요.

사용 가능한 role: pm, developer, reviewer, designer, devops, qa
사용 가능한 model: claude-opus-4-6, claude-sonnet-4, openai-codex/o3, openai-codex/gpt-5.3-codex
사용 가능한 character: brainstorm, planning, review, retrospective, kickoff, architecture, design, sprint-planning, estimation, demo, postmortem, code-review, daily
- brainstorm: 아이디어 발산/후보 도출
- planning: 기획서/명세서 작성 (확정된 주제 기반)
- kickoff: 프로젝트 킥오프 (목표/역할/일정)
- architecture: 기술 아키텍처 설계
- design: UI/UX 설계
- sprint-planning: 스프린트 계획/태스크 분배
- estimation: 공수/리소스/일정 산정
- demo: 결과물 시연 리뷰
- postmortem: 장애/실패 분석
- code-review: 코드 리뷰
- daily: 데일리 스탠드업
- retrospective: 회고 (잘된점/개선점/액션아이템)
- review: 후보 점수화/평가

character 선택 기준: 사용자 요청 맥락에 맞는 타입을 자동 선택하세요. 예) "아키텍처 설계 회의" → architecture, "스프린트 계획" → sprint-planning

이미 있는 에이전트를 활용할 수 있으면 새로 만들지 마세요.

## 리뷰 피드백 반영
사용자가 "리뷰 피드백 반영해줘", "수정해줘", "fix", "수정 반영" 등을 말하면:
1. 가장 최근 완료된 리뷰 결과를 참조 (위 오피스 상태에서 확인)
2. [Fix] 접두어로 수정 태스크를 create_task로 생성 제안
3. 태스크 설명에 "리뷰 피드백을 반영하여 수정" 내용 포함
4. assignRole="developer"로 개발자에게 배정 (Dev→Review 2단계 체인 자동 적용됨)`;
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

const TASK_ID_PLACEHOLDER_RE = /^(\(?.*생성된\s*task\s*id.*\)?|\(?.*task\s*id.*\)?|\{?taskid\}?|<taskid>|new[-_ ]?task|__NEW__|__new__|NEW_TASK_ID|TASK_ID|<.*id.*>)$/i;

function isTaskIdPlaceholder(value?: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  return TASK_ID_PLACEHOLDER_RE.test(v);
}

function normalizeTaskId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function bindActionWithRuntimeContext(action: ChiefAction, runtime: { lastCreatedTaskId?: string | null }): ChiefAction {
  if (action.type !== 'assign_task' && action.type !== 'cancel_task') return action;

  const rawTaskId = normalizeTaskId(action.params.taskId);
  if (!isTaskIdPlaceholder(rawTaskId)) return action;

  const boundTaskId = runtime.lastCreatedTaskId ?? undefined;
  if (!boundTaskId) return action;

  return {
    ...action,
    params: {
      ...action.params,
      taskId: boundTaskId,
    },
  };
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

function classifyIntent(userMessage: string): 'status' | 'other' {
  const msg = (userMessage || '').toLowerCase();

  // Only detect read-only status queries for fast synchronous response.
  // Everything else goes to LLM for flexible intent handling.
  const readOnlyStatusLike = /(상태\s*재?확인|재확인|다시\s*상태|상태\s*체크|상태\s*확인|진행\s*중(이야|인가|이냐)?|진행중\??|실행\s*중|실행중|진행\s*상황|진행률|현황|지금\s*상태|현재\s*상태|결과\s*(나왔|는\??|어때\??)?|다\s*됐(어|나|니)?\??|아직(이야|이냐|인가)?\??|끝났(어|나|니)?\??|완료\s*됐(어|나|니)?\??|언제\s*(줘|돼|됨|끝나)|status|eta|예상\s*시간|얼마나\s*남|몇\s*명|몇\s*건)/i.test(msg);
  const mutationLike = /(추가|생성|create|만들|리셋|reset|취소|cancel|배정|assign|재시작|restart|종료|stop|kill|중지|멈춰|끝내)/i.test(msg);

  if (readOnlyStatusLike && !mutationLike) {
    return 'status';
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

  // Let LLM handle response formatting for all other intents
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

  const wantsEta = /(eta|예상\s*시간|얼마나\s*남|언제\s*끝|언제\s*줘|언제\s*돼)/i.test(userMessage);
  const wantsResult = /(다\s*됐|끝났|완료\s*됐|결과\s*나왔)/i.test(userMessage);

  if (wantsResult) {
    const recent = [...completed]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 2);
    if (recent.length > 0) {
      const names = recent.map(t => `"${t.title}"`).join(', ');
      return `최근 완료: ${names}. 전체 완료 ${completed.length}건 · 진행 ${inProgress.length}건 · 대기 ${pending.length}건입니다. 결과는 '결과 보기'에서 확인할 수 있습니다.`;
    }
    return `아직 완료된 작업이 없습니다. 현재 진행 ${inProgress.length}건 · 대기 ${pending.length}건입니다.`;
  }

  if (wantsEta) {
    const etaLine = inProgress.length > 0
      ? `현재 진행 중 ${inProgress.length}건(${latestProgress || '작업'})이 있으며, 완료 시 바로 알려드리겠습니다.`
      : '현재 진행 중 작업이 없어 즉시 처리 가능합니다.';
    return `대기 ${pending.length}건 · 진행 ${inProgress.length}건 · 완료 ${completed.length}건. ${etaLine}`;
  }

  return `현재 대기 ${pending.length}건 · 진행 ${inProgress.length}건 · 완료 ${completed.length}건이며, 에이전트는 ${agents.length}명입니다${latestProgress ? ` (진행중: ${latestProgress})` : ''}.`;
}

function shouldSuppressActionsByIntent(intent: 'status' | 'other'): boolean {
  return intent === 'status';
}

function shouldAutoSuggestMeeting(userMessage: string): boolean {
  const msg = (userMessage || '').toLowerCase();

  // User explicitly wants to skip meeting
  if (/(미팅\s*없이|회의\s*없이|바로\s*개발|바로\s*실행|skip\s*meeting)/i.test(msg)) return false;

  const planningLike = /(기획|설계|아키텍처|전략|비교|분석|리스크|우선순위|로드맵|요구사항|의사결정)/i.test(msg);
  const collaborativeLike = /(팀|역할|pm|개발자|리뷰어|합의|토론|검토)/i.test(msg);
  const longRequest = msg.trim().length >= 16;

  return planningLike && (collaborativeLike || longRequest);
}

function buildMeetingSuggestionAction(userMessage: string): ChiefAction {
  const trimmed = (userMessage || '').trim();
  const titleCore = trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
  return {
    type: 'start_meeting',
    params: {
      title: titleCore ? `${titleCore} 검토 미팅` : '요청사항 검토 미팅',
      participants: 'pm,developer,reviewer',
      participantCount: '3',
      character: 'planning',
    },
  };
}

function shouldBatchMultiStackTasks(userMessage: string, actions: ChiefAction[]): boolean {
  const createTasks = actions.filter(a => a.type === 'create_task');
  if (createTasks.length < 2) return false;

  const msg = (userMessage || '').toLowerCase();
  const splitIntent = /(분할|나눠|파트|스택|frontend|backend|프론트|백엔드|qa|테스트|대형|large|big)/i.test(msg);

  const titles = createTasks.map(a => `${a.params?.title || ''} ${a.params?.description || ''}`.toLowerCase()).join(' ');
  const roleSpread = /(frontend|프론트|ui|backend|백엔드|api|qa|테스트|검증)/i.test(titles);

  return splitIntent || roleSpread;
}

function applyBatchToCreateTaskActions(userMessage: string, actions: ChiefAction[]): { actions: ChiefAction[]; batchId?: string } {
  if (!shouldBatchMultiStackTasks(userMessage, actions)) return { actions };

  const batchId = `batch-${Date.now()}-${uuid().slice(0, 8)}`;
  const patched = actions.map((a) => {
    if (a.type !== 'create_task') return a;
    return {
      ...a,
      params: {
        ...a.params,
        batchId,
      },
    };
  });

  return { actions: patched, batchId };
}

const ALL_AGENT_ROLES: AgentRole[] = ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'];

function isAgentRole(value: string): value is AgentRole {
  return (ALL_AGENT_ROLES as string[]).includes(value);
}

function parseMeetingParticipantRoleCounts(raw: string | undefined): Record<AgentRole, number> {
  const counts: Record<AgentRole, number> = { pm: 0, developer: 0, reviewer: 0, designer: 0, devops: 0, qa: 0 };
  const input = (raw || 'pm,developer').trim().toLowerCase();
  if (!input) {
    counts.pm = 1;
    counts.developer = 1;
    return counts;
  }

  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Examples:
    // - "pm"
    // - "pm 2"
    // - "pm 2명"
    // - "2 pm"
    // - "2명 pm"
    const m = part.match(/^(?:([a-z가-힣]+)\s*(\d+|한|하나|일|두|둘|이|세|셋|삼|네|넷|사|다섯|오|여섯|육|일곱|칠|여덟|팔|아홉|구|열|십)\s*명?|(?:\d+|한|하나|일|두|둘|이|세|셋|삼|네|넷|사|다섯|오|여섯|육|일곱|칠|여덟|팔|아홉|구|열|십)\s*명?\s*([a-z가-힣]+))$/i);

    let roleToken: string | null = null;
    let countToken: string | null = null;

    if (m) {
      roleToken = (m[1] || m[3] || '').trim().toLowerCase();
      countToken = (m[2] || (m[1] ? null : part.match(/(\d+|한|하나|일|두|둘|이|세|셋|삼|네|넷|사|다섯|오|여섯|육|일곱|칠|여덟|팔|아홉|구|열|십)/i)?.[1]) || '').trim();
    } else {
      // Fallback: role only
      roleToken = part;
    }

    const resolvedRole = roleToken ? ROLE_ALIASES[roleToken] || (isAgentRole(roleToken) ? roleToken : null) : null;
    if (!resolvedRole) continue;

    const parsedCount = countToken ? parseKoreanOrArabicNum(countToken) : null;
    const count = Math.max(1, Math.min(MAX_COUNT_PER_ROLE, parsedCount ?? 1));
    counts[resolvedRole] += count;
  }

  // If parser failed to detect all tokens, keep safe default
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    counts.pm = 1;
    counts.developer = 1;
  }
  console.log(`[chief] parseMeetingParticipantRoleCounts("${input}") => total=${Object.values(counts).reduce((a,b)=>a+b,0)}`, JSON.stringify(counts));
  return counts;
}

function ensureMeetingParticipants(roleCounts: Record<AgentRole, number>): { participantIds: string[]; createdAgentNames: string[] } {
  console.log(`[chief] ensureMeetingParticipants roleCounts:`, JSON.stringify(roleCounts));
  const participantIds: string[] = [];
  const createdAgentNames: string[] = [];

  const pushExistingOrCreate = (role: AgentRole) => {
    const currentIds = new Set(participantIds);
    const agents = listAgents();
    const idle = agents.find(a => a.role === role && a.state === 'idle' && !currentIds.has(a.id));
    const any = agents.find(a => a.role === role && !currentIds.has(a.id));
    const selected = idle || any;

    if (selected) {
      participantIds.push(selected.id);
      return;
    }

    const created = createAgent(suggestFriendlyAgentName(role), role, DEFAULT_MODEL_BY_ROLE[role]);
    participantIds.push(created.id);
    createdAgentNames.push(created.name);
  };

  for (const role of ALL_AGENT_ROLES) {
    const needed = Math.max(0, roleCounts[role] || 0);
    for (let i = 0; i < needed; i++) pushExistingOrCreate(role);
  }

  // Hard minimum guarantee: at least requested total, minimum 2
  const requestedTotal = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  const hardMinimum = Math.max(2, requestedTotal);
  const orderedRequested = ALL_AGENT_ROLES.filter(r => (roleCounts[r] || 0) > 0);
  const fallbackRole = orderedRequested[0] || 'developer';
  while (participantIds.length < hardMinimum) {
    pushExistingOrCreate(fallbackRole);
  }

  console.log(`[chief] ensureMeetingParticipants result: ${participantIds.length} participants, created: [${createdAgentNames.join(', ')}]`);
  return { participantIds, createdAgentNames };
}

/** Execute a single parsed action. Called only after user approval. */
function executeAction(action: ChiefAction, sessionId?: string): ChiefAction {
  console.log(`[chief] executeAction: type=${action.type}, params=${JSON.stringify(action.params).slice(0, 200)}`);
  try {
    switch (action.type) {
      case 'create_task': {
        const { title, description, assignRole } = action.params;
        const taskTitle = title || 'Untitled';
        let taskDescription = description || '';

        // Auto-inject related task results into description for context continuity
        // Look for recently completed tasks that are referenced or related
        const allTasks = listTasks();
        const completedRelated = allTasks.filter(t => 
          t.status === 'completed' && t.result && 
          (taskTitle.includes(t.title.replace(/^\[.*?\]\s*/, '')) || 
           t.title.replace(/^\[.*?\]\s*/, '').split(' ').some(w => w.length > 3 && taskTitle.includes(w)))
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        if (completedRelated.length > 0) {
          const prevTask = completedRelated[0];
          const prevResult = prevTask.result!.slice(0, 4000);
          taskDescription = `${taskDescription}\n\n## 참고: 이전 태스크 결과 ("${prevTask.title}")\n\n${prevResult}`;
        }

        // Attach recent meeting context if available
        const recentMeetings = listMeetings().filter(m => m.status === 'completed').sort((a, b) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        if (recentMeetings.length > 0) {
          const recentMeeting = recentMeetings[0];
          const meetingAge = Date.now() - new Date(recentMeeting.updatedAt + 'Z').getTime();
          // Attach if meeting was completed within last 60 minutes (likely related)
          if (meetingAge < 60 * 60 * 1000 && recentMeeting.report) {
            taskDescription = `${taskDescription}\n\n## 참고: 최근 회의 결과 ("${recentMeeting.title}")\n\n${recentMeeting.report.slice(0, 3000)}`;
          }
        }

        // Check for duplicate task
        const duplicate = allTasks.find(t => t.title === taskTitle && (t.status === 'in-progress' || t.status === 'pending'));
        if (duplicate) {
          return { ...action, result: { ok: false, message: `동일한 작업 "${taskTitle}"이(가) 이미 진행 중입니다 (ID: ${duplicate.id.slice(0, 8)})` } };
        }

        // Auto-attach original code + review feedback for fix tasks
        if (taskTitle.startsWith('[Fix]') || /수정|fix|피드백.*반영/i.test(taskTitle)) {
          const recentReview = allTasks
            .filter(t => (t.title.startsWith('[Review]') || t.title.startsWith('[리뷰]') || t.title.startsWith('[코드 리뷰]')) && t.status === 'completed' && t.result)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

          if (recentReview) {
            try {
              const rootTask = findRootTask(recentReview.id);
              // Find the dev step result (sibling task under same root)
              const devTask = allTasks.find(t =>
                t.parentTaskId === rootTask.id &&
                (t.title.startsWith('[Dev]') || t.title.startsWith('[개발]') || t.title.startsWith('[개발 실행]')) &&
                t.status === 'completed' && t.result
              );
              const originalCode = devTask?.result || rootTask.result || '';
              if (originalCode) {
                taskDescription += `\n\n---\n## 📝 원본 코드 (수정 대상)\n${originalCode.slice(0, 4000)}`;
              }
              taskDescription += `\n\n---\n## 🔍 리뷰어 피드백 (반영 필요)\n${recentReview.result!.slice(0, 2000)}`;
            } catch { /* findRootTask may throw if orphaned */ }
          }
        }

        // 1) Dynamic start-role recommendation (intent/output/complexity hints)
        const preferredRole = recommendStartRoleFromIntent(taskTitle, taskDescription, assignRole);

        // 2) Resolve initial assignee from recommended first step (least-recently-used for fairness)
        let assigneeId: string | null = null;
        if (preferredRole) {
          const agents = listAgents();
          // Exclude agents already assigned in this batch to distribute work
          const candidates = agents.filter(a => a.role === preferredRole && a.state === 'idle' && !batchAssignedAgentIds.has(a.id));
          if (candidates.length === 0) {
            // fallback: any idle agent of that role (including batch-assigned, they might be only option)
            const fallback = agents.filter(a => a.role === preferredRole && a.state === 'idle');
            if (fallback.length > 0) {
              fallback.sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
              assigneeId = fallback[0].id;
            } else {
              const any = agents.filter(a => a.role === preferredRole);
              any.sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
              if (any.length > 0) assigneeId = any[0].id;
            }
          } else {
            // Pick least recently used idle agent not in batch
            candidates.sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
            assigneeId = candidates[0].id;
          }
        }

        // Track assigned agents within this batch to prevent duplicate assignment
        if (assigneeId) {
          batchAssignedAgentIds.add(assigneeId);
        }

        const taskBatchId = action.params.batchId || null;
        const task = createTask(taskTitle, taskDescription, assigneeId, null, undefined, taskBatchId ? { batchId: taskBatchId } : undefined);

        // 3) Persist a real editable plan for the task
        const plan = suggestChainPlan(task.id, task.title, task.description, preferredRole || 'pm', task.expectedDeliverables);
        const planSummary = plan.steps.map((s, i) => `${i + 1}. ${s.label} — ${s.reason}`).join('\n');

        return { ...action, result: {
          ok: true,
          message: `작업 "${task.title}" 생성됨 (taskId: ${task.id}, runId: pending)\n\n📋 추천 체인 (${plan.steps.length}단계):\n${planSummary}\n\n필요하면 단계 추가/삭제/순서 변경 후 확정하세요.`,
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
        const { title, participants, character, participantCount: participantCountRaw } = action.params;
        const isScoringReview = (character || '').toLowerCase() === 'review' || /(점수화|스코어|scoring)/i.test(title || '');
        if (isScoringReview) {
          return {
            ...action,
            result: {
              ok: false,
              message: '점수화 리뷰 미팅은 sourceCandidates가 필요합니다. 완료된 기획/브레인스토밍 미팅에서 "후보 순위 평가" 버튼으로 생성해주세요.',
            },
          };
        }
        const roleCounts = parseMeetingParticipantRoleCounts(participants);

        // If participantCount is explicitly specified, enforce it
        const requestedCount = participantCountRaw ? parseInt(participantCountRaw, 10) : null;
        if (requestedCount && !isNaN(requestedCount) && requestedCount > 0) {
          // Scale up role counts proportionally to meet the requested total
          const currentTotal = Object.values(roleCounts).reduce((a, b) => a + b, 0);
          if (currentTotal < requestedCount) {
            const deficit = requestedCount - currentTotal;
            // Distribute deficit among requested roles proportionally, fallback to first role
            const activeRoles = (Object.keys(roleCounts) as AgentRole[]).filter(r => roleCounts[r] > 0);
            const fallbackRole = activeRoles[0] || 'pm';
            for (let i = 0; i < deficit; i++) {
              roleCounts[activeRoles[i % activeRoles.length] || fallbackRole]++;
            }
          }
        }

        const { participantIds, createdAgentNames } = ensureMeetingParticipants(roleCounts);

        // Hard assert: if participantCount was requested, enforce exact count
        if (requestedCount && !isNaN(requestedCount) && requestedCount > 0) {
          const fallbackRole: AgentRole = (Object.keys(roleCounts) as AgentRole[]).find(r => roleCounts[r] > 0) || 'pm';
          while (participantIds.length < requestedCount) {
            const created = createAgent(suggestFriendlyAgentName(fallbackRole), fallbackRole, DEFAULT_MODEL_BY_ROLE[fallbackRole]);
            participantIds.push(created.id);
            createdAgentNames.push(created.name);
          }
          if (participantIds.length !== requestedCount) {
            console.error(`[chief] HARD ASSERT FAIL: requested ${requestedCount} participants but got ${participantIds.length}`);
          }
        }

        if (participantIds.length < 2) {
          return { ...action, result: { ok: false, message: '미팅 참여자 자동 구성 실패 (최소 2명 필요)' } };
        }

        // Build contextual description from recent session messages
        const meetingLangCtx = getSessionLang(sessionId);
        let meetingDescription = meetingLangCtx === 'en' ? 'Meeting initiated by Chief' : '총괄자가 시작한 미팅';
        if (sessionId) {
          const recentMsgs = getSessionMessages(sessionId).slice(-15);
          const contextParts: string[] = [];
          for (const m of recentMsgs) {
            if (!m.content?.trim()) continue;
            const prefix = m.role === 'user'
              ? (meetingLangCtx === 'en' ? '[User]' : '[사용자]')
              : (meetingLangCtx === 'en' ? '[Chief]' : '[총괄자]');
            const truncated = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
            contextParts.push(`${prefix} ${truncated}`);
          }
          if (contextParts.length > 0) {
            meetingDescription = meetingLangCtx === 'en'
              ? `## Previous Conversation Context\n\n${contextParts.join('\n\n')}\n\nPlease conduct the meeting based on the conversation above.`
              : `## 이전 대화 컨텍스트\n\n${contextParts.join('\n\n')}\n\n위 대화를 바탕으로 미팅을 진행해주세요.`;
          }
        }

        const meetingLang = getSessionLang(sessionId);
        const meeting = startPlanningMeeting(
          title || (meetingLang === 'en' ? 'Chief Meeting' : '총괄자 미팅'),
          meetingDescription,
          participantIds,
          (character as any) || 'planning',
          meetingLang,
        );

        const createdMsg = createdAgentNames.length > 0
          ? ` (부족 인원 자동 생성: ${createdAgentNames.join(', ')})`
          : '';

        return { ...action, result: { ok: true, message: `미팅 "${meeting.title}" 시작됨${createdMsg}`, id: meeting.id } };
      }
      case 'assign_task': {
        const taskId = normalizeTaskId(action.params.taskId);
        const agentId = String(action.params.agentId ?? '').trim();
        if (!taskId || !agentId) {
          return { ...action, result: { ok: false, message: 'taskId와 agentId가 필요합니다' } };
        }
        if (isTaskIdPlaceholder(taskId)) {
          return { ...action, result: { ok: false, message: 'taskId placeholder는 실행할 수 없습니다. create_task의 실제 id를 사용하세요.' } };
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
        return { ...action, result: { ok: true, message: `작업 "${task.title}"를 ${agent.name}에게 배정했습니다. (taskId: ${taskId}, runId: pending)` } };
      }
      case 'cancel_task': {
        const taskId = normalizeTaskId(action.params.taskId);
        if (!taskId) {
          return { ...action, result: { ok: false, message: 'taskId가 필요합니다' } };
        }
        const task = stmts.getTask.get(taskId) as any;
        if (!task) {
          return { ...action, result: { ok: false, message: `작업을 찾을 수 없습니다: ${taskId}` } };
        }
        // Kill running agent process if in-progress
        if (task.status === 'in-progress' && task.session_id) {
          killAgentRun(task.session_id);
        }
        stmts.cancelTask.run(taskId);
        return { ...action, result: { ok: true, message: `작업 "${task.title}" 취소됨` } };
      }
      case 'cancel_all_pending': {
        // Also kill in-progress tasks
        const inProgressTasks = listTasks().filter(t => t.status === 'in-progress');
        for (const t of inProgressTasks) {
          if ((t as any).session_id) killAgentRun((t as any).session_id);
          stmts.cancelTask.run(t.id);
        }
        const result = stmts.cancelAllPending.run();
        const count = result.changes + inProgressTasks.length;
        const cancelLang = getSessionLang(sessionId);
        return { ...action, result: { ok: true, message: L(cancelLang, `Cancelled ${count} task(s) (pending + in-progress)`, `작업 ${count}건 취소됨 (대기 + 진행중)`) } };
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
      case 'confirm_meeting': {
        // Confirm/approve a completed meeting and trigger next steps
        const { meetingId } = action.params;
        if (!meetingId) {
          // Try to find the latest completed meeting
          const allMeetings = listMeetings();
          const latestCompleted = allMeetings.filter(m => m.status === 'completed').sort((a, b) => 
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
          if (!latestCompleted) {
            return { ...action, result: { ok: false, message: '확정할 완료된 미팅이 없습니다' } };
          }
          // Delegate to handleChiefAction with a synthetic notification
          const notifId = `synthetic-confirm-${latestCompleted.id}-${Date.now()}`;
          const result = handleChiefAction(notifId, `approve-${latestCompleted.id}`, { meetingId: latestCompleted.id }, sessionId);
          return { ...action, result: { ok: true, message: result.reply } };
        }
        let meeting = getMeeting(meetingId);
        if (!meeting) {
          // Fuzzy match: LLM sometimes uses truncated IDs
          const allMeetings = listMeetings();
          meeting = allMeetings.find(m => m.id.startsWith(meetingId)) || null;
        }
        if (!meeting) {
          return { ...action, result: { ok: false, message: `미팅을 찾을 수 없습니다: ${meetingId}` } };
        }
        const resolvedMeetingId = meeting.id;
        const notifId = `synthetic-confirm-${resolvedMeetingId}-${Date.now()}`;
        const result = handleChiefAction(notifId, `approve-${resolvedMeetingId}`, { meetingId: resolvedMeetingId }, sessionId);
        return { ...action, result: { ok: true, message: result.reply } };
      }
      case 'start_review': {
        // Start review scoring for a completed brainstorm/planning meeting
        const { meetingId } = action.params;
        if (!meetingId) {
          const allMeetings = listMeetings();
          const latestBrainstorm = allMeetings.filter(m => 
            m.status === 'completed' && (m.character === 'brainstorm' || m.character === 'planning') && !m.sourceMeetingId
          ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
          if (!latestBrainstorm) {
            return { ...action, result: { ok: false, message: '리뷰할 미팅이 없습니다' } };
          }
          const notifId = `synthetic-review-${latestBrainstorm.id}-${Date.now()}`;
          const r = handleChiefAction(notifId, `start-review-${latestBrainstorm.id}`, { meetingId: latestBrainstorm.id }, sessionId);
          return { ...action, result: { ok: true, message: r.reply } };
        }
        let resolvedId = meetingId;
        if (!getMeeting(meetingId)) {
          // Fuzzy match: LLM sometimes uses truncated IDs
          const allMeetings = listMeetings();
          const found = allMeetings.find(m => m.id.startsWith(meetingId));
          if (found) resolvedId = found.id;
          else return { ...action, result: { ok: false, message: `미팅을 찾을 수 없습니다: ${meetingId}` } };
        }
        const notifId = `synthetic-review-${resolvedId}-${Date.now()}`;
        const r = handleChiefAction(notifId, `start-review-${resolvedId}`, { meetingId: resolvedId }, sessionId);
        return { ...action, result: { ok: true, message: r.reply } };
      }
      case 'confirm_task': {
        // Confirm a completed task and trigger chain advancement
        const { taskId } = action.params;
        if (!taskId) {
          const tasks = listTasks();
          const latestCompleted = tasks.filter(t => t.status === 'completed' && !t.parentTaskId).sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
          if (!latestCompleted) {
            return { ...action, result: { ok: false, message: '확정할 완료된 태스크가 없습니다' } };
          }
          const notifId = `synthetic-confirm-task-${latestCompleted.id}-${Date.now()}`;
          const result = handleChiefAction(notifId, `approve-${latestCompleted.id}`, { taskId: latestCompleted.id }, sessionId);
          return { ...action, result: { ok: true, message: result.reply } };
        }
        const notifId = `synthetic-confirm-task-${taskId}-${Date.now()}`;
        const result = handleChiefAction(notifId, `approve-${taskId}`, { taskId }, sessionId);
        return { ...action, result: { ok: true, message: result.reply } };
      }
      case 'cancel_meeting': // alias for delete_meeting
      case 'delete_meeting': {
        const { meetingId } = action.params;
        if (!meetingId) {
          return { ...action, result: { ok: false, message: 'meetingId가 필요합니다' } };
        }
        let meeting = getMeeting(meetingId);
        if (!meeting) {
          // Fuzzy match: LLM sometimes uses truncated IDs
          const allMeetings = listMeetings();
          meeting = allMeetings.find(m => m.id.startsWith(meetingId)) || null;
        }
        if (!meeting) {
          return { ...action, result: { ok: false, message: `미팅을 찾을 수 없습니다: ${meetingId}` } };
        }
        const deleted = deleteMeeting(meeting.id);
        return { ...action, result: { ok: deleted, message: deleted ? `미팅 "${meeting.title}" 삭제됨` : '미팅 삭제 실패' } };
      }
      case 'delete_all_meetings': {
        const count = deleteAllMeetings();
        return { ...action, result: { ok: true, message: `미팅 ${count}건 삭제됨` } };
      }
      case 'view_task_result': {
        const { taskId } = action.params;
        const tasks = listTasks();
        const task = taskId
          ? tasks.find(t => t.id === taskId || t.id.startsWith(taskId))
          : tasks.filter(t => t.status === 'completed').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        if (!task) return { ...action, result: { ok: false, message: '태스크를 찾을 수 없습니다' } };
        return { ...action, result: { ok: true, message: `📋 "${task.title}" 결과:\n\n${task.result || '결과 없음'}` } };
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
export function approveProposal(
  messageId: string,
  selectedIndices?: number[],
  overrideActions?: ChiefAction[],
  options?: { continueOnError?: boolean },
  sessionId?: string,
): {
  executedActions: ChiefAction[];
  skippedActions: ChiefAction[];
  stoppedReason?: string;
  messages: ChiefChatMessage[];
  state: { agents: any[]; tasks: any[]; meetings: any[] };
} {
  const actions = pendingProposals.get(messageId);
  if (!actions || actions.length === 0) {
    throw new Error(`No pending proposal found for messageId: ${messageId}`);
  }

  const scopedSessionId = (sessionId || lastActiveChiefSessionId || 'chief-default').trim() || 'chief-default';

  const continueOnError = options?.continueOnError === true;
  const base = overrideActions && overrideActions.length > 0 ? overrideActions : actions;
  const toExecute = selectedIndices
    ? selectedIndices.filter(i => i >= 0 && i < base.length).map(i => base[i])
    : base;

  const totalCount = toExecute.length;

  // Feedback: approval received
  pushMessage(scopedSessionId, {
    id: `approval-ack-${Date.now()}`,
    role: 'chief',
    content: `✅ **승인됨** — ${totalCount}건의 액션을 실행합니다. (정책: ${continueOnError ? 'continue-on-error' : 'fail-fast'})`,
    createdAt: new Date().toISOString(),
  });

  // Execute each action with individual feedback
  const executedActions: ChiefAction[] = [];
  let stoppedReason: string | undefined;
  let stopIndex = -1;
  const runtimeBinding: { lastCreatedTaskId?: string | null } = { lastCreatedTaskId: null };

  // Auto-assign batchId when multiple create_task actions are in the same approval
  const createTaskActions = toExecute.filter(a => a.type === 'create_task');
  const batchId = createTaskActions.length >= 2 ? uuid() : null;
  if (batchId) {
    for (const a of createTaskActions) {
      a.params = { ...a.params, batchId };
    }
  }

  for (let i = 0; i < toExecute.length; i++) {
    const action = bindActionWithRuntimeContext(toExecute[i], runtimeBinding);
    const stepLabel = `[${i + 1}/${totalCount}]`;

    // Feedback: execution start
    pushMessage(scopedSessionId, {
      id: `exec-start-${Date.now()}-${i}`,
      role: 'chief',
      content: `⏳ ${stepLabel} 실행 중: ${ACTION_LABEL_MAP[action.type] || action.type}${action.params.title ? ` — "${action.params.title}"` : action.params.name ? ` — "${action.params.name}"` : ''}`,
      createdAt: new Date().toISOString(),
    });

    const executed = executeAction(action, sessionId || lastActiveChiefSessionId || 'chief-default');
    executedActions.push(executed);

    if (executed.result?.ok && executed.type === 'create_task' && executed.result?.id) {
      runtimeBinding.lastCreatedTaskId = executed.result.id;
    }

    // Feedback: execution result
    const ok = executed.result?.ok;
    pushMessage(scopedSessionId, {
      id: `exec-result-${Date.now()}-${i}`,
      role: 'chief',
      content: ok
        ? `✅ ${stepLabel} 완료: ${executed.result!.message}`
        : `❌ ${stepLabel} 실패: ${executed.result?.message || '알 수 없는 오류'}`,
      createdAt: new Date().toISOString(),
    });

    if (!ok && !continueOnError) {
      stoppedReason = `${stepLabel} 실패로 인해 후속 액션 중단 (${executed.result?.message || '알 수 없는 오류'})`;
      stopIndex = i;
      break;
    }
  }

  const skippedActions = stopIndex >= 0 ? toExecute.slice(stopIndex + 1) : [];
  if (stoppedReason && skippedActions.length > 0) {
    const skippedList = skippedActions.map((a, idx) => `${stopIndex + 2 + idx}. ${ACTION_LABEL_MAP[a.type] || a.type}`).join(', ');
    pushMessage(scopedSessionId, {
      id: `exec-abort-${Date.now()}`,
      role: 'chief',
      content: `⛔ 실행 중단: ${stoppedReason}\n미실행 액션: ${skippedList}`,
      createdAt: new Date().toISOString(),
    });
  }

  // Feedback: all done summary + next step guide
  const successCount = executedActions.filter(a => a.result?.ok).length;
  const failCount = executedActions.length - successCount;
  const pendingTasks = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress');
  const traceLines: string[] = [];
  for (const action of executedActions) {
    const tid = action.result?.id;
    if (!tid) continue;
    const task = listTasks(true).find(t => t.id === tid);
    const assignee = task?.assigneeId ? getAgent(task.assigneeId) : null;
    const runId = assignee?.currentTaskId === tid ? (assignee.sessionId || 'pending') : 'pending';
    traceLines.push(`• taskId=${tid} | runId=${runId}`);
  }

  let summaryMsg = `🎯 **실행 완료** — 성공 ${successCount}건`;
  if (failCount > 0) summaryMsg += `, 실패 ${failCount}건`;
  if (stoppedReason) summaryMsg += `\n\n⛔ **중단 사유:** ${stoppedReason}`;
  if (skippedActions.length > 0) {
    summaryMsg += `\n🧾 **미실행 액션:** ${skippedActions.map(a => ACTION_LABEL_MAP[a.type] || a.type).join(', ')}`;
  }
  if (traceLines.length > 0) {
    summaryMsg += `\n\n🔎 **실행 추적 정보**\n${traceLines.join('\n')}`;
  }
  if (pendingTasks.length > 0) {
    summaryMsg += `\n\n📌 **다음 단계:** ${pendingTasks.length}건의 작업이 진행/대기 중입니다.\n• "진행중이야?"로 상태 확인 가능\n• 완료 시 자동으로 보고드립니다`;
  } else {
    summaryMsg += `\n\n📌 **다음 단계:** 추가 작업이 필요하시면 말씀해주세요.`;
  }

  pushMessage(scopedSessionId, {
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
    skippedActions,
    stoppedReason,
    messages: getChiefMessages(scopedSessionId),
    state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
  };
}

// Dynamic chain recommendation mode: no forced QA->Dev normalization.

function getActionLabelMap(type: string, lang: Lang = 'ko'): string {
  const labels: Record<string, [string, string]> = {
    create_task: ['Create Task', '작업 생성'],
    create_agent: ['Create Agent', '에이전트 생성'],
    start_meeting: ['Start Meeting', '미팅 시작'],
    assign_task: ['Assign Task', '작업 배정'],
    cancel_task: ['Cancel Task', '작업 취소'],
    cancel_all_pending: ['Cancel All Pending', '대기 작업 전체 취소'],
    reset_agent: ['Reset Agent', '에이전트 초기화'],
    cancel_meeting: ['Delete Meeting', '미팅 삭제'],
    delete_meeting: ['Delete Meeting', '미팅 삭제'],
    delete_all_meetings: ['Delete All Meetings', '전체 미팅 삭제'],
    start_review: ['Rank Candidates', '후보 순위 평가'],
    confirm_meeting: ['Confirm Meeting', '미팅 확정'],
    confirm_task: ['Confirm Task', '태스크 확정'],
    view_task_result: ['View Task Result', '태스크 결과 조회'],
  };
  const pair = labels[type];
  return pair ? L(lang, pair[0], pair[1]) : type;
}

// Keep backward-compatible constant for places that don't have lang context
const ACTION_LABEL_MAP: Record<string, string> = {
  create_task: '작업 생성',
  create_agent: '에이전트 생성',
  start_meeting: '미팅 시작',
  assign_task: '작업 배정',
  cancel_task: '작업 취소',
  cancel_all_pending: '대기 작업 전체 취소',
  reset_agent: '에이전트 초기화',
  cancel_meeting: '미팅 삭제',
  delete_meeting: '미팅 삭제',
  delete_all_meetings: '전체 미팅 삭제',
  start_review: '후보 순위 평가',
  confirm_meeting: '미팅 확정',
  confirm_task: '태스크 확정',
  view_task_result: '태스크 결과 조회',
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

// Test helper: inject pending proposal without going through LLM flow.
export function __unsafeSetPendingProposalForTest(messageId: string, actions: ChiefAction[], sessionId = 'chief-default'): void {
  pendingProposals.set(messageId, actions);
  pendingProposalBySession.set(sessionId, messageId);
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
export function chatWithChief(sessionId: string, userMessage: string, language: 'en' | 'ko' = 'ko'): { messageId: string; async: boolean; reply?: string; suggestions?: TeamPlanSuggestion[]; messages?: ChiefChatMessage[] } {
  lastActiveChiefSessionId = sessionId || 'chief-default';
  sessionLanguageMap.set(sessionId, language);
  const lang: Lang = language;
  const now = new Date().toISOString();
  pushMessage(sessionId, { id: `user-${Date.now()}`, role: 'user', content: userMessage, createdAt: now });

  const messageId = `chief-${Date.now()}-${uuid().slice(0, 8)}`;

  const fixSummaryReply = buildFixSummaryReply(userMessage);
  if (fixSummaryReply) {
    pushMessage(sessionId, { id: messageId, role: 'chief', content: fixSummaryReply, createdAt: now });
    return { messageId, async: false, reply: fixSummaryReply, messages: getChiefMessages(sessionId) };
  }

  // Feature 1: Mid-chain intervention — if a chain is actively running, queue the user message as an amendment
  const allTasks = listTasks();
  const inProgressChainTasks = allTasks.filter(t => t.status === 'in-progress' && !t.parentTaskId);
  const activeChainRootId = inProgressChainTasks.find(t => {
    const plan = getChainPlanForTask(t.id);
    return plan && (plan.status === 'running' || plan.status === 'confirmed');
  })?.id;

  const isStatusIntent = classifyIntent(userMessage) === 'status';
  const isStatusOrApproval = /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|yes|approve|sure|do it|proceed|run|execute)$/i.test(userMessage.trim()) || isStatusIntent;
  if (activeChainRootId && !isStatusOrApproval) {
    const amendments = chainAmendments.get(activeChainRootId) || [];
    amendments.push(userMessage.trim());
    chainAmendments.set(activeChainRootId, amendments);
    const reply = L(lang, `✅ Noted. Will be applied to the next step: ${userMessage.trim()}`, `✅ 메모했습니다. 다음 단계에 반영됩니다: ${userMessage.trim()}`);
    pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: now });
    if (responseCallback) {
      responseCallback(sessionId, {
        messageId,
        reply,
        actions: [],
        state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
        sessionId,
      });
    }
    return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
  }

  // Detect review fix request — shortcut before LLM call
  const isFixRequest = /(리뷰.*(피드백|수정|반영)|피드백.*반영|수정.*반영|fix.*review|🔧\s*수정\s*반영)/i.test(userMessage.trim());
  if (isFixRequest) {
    const recentReview = allTasks
      .filter(t => (t.title.startsWith('[Review]') || t.title.startsWith('[리뷰]') || t.title.startsWith('[코드 리뷰]')) && t.status === 'completed' && t.result)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

    if (recentReview) {
      let rootTask: ReturnType<typeof findRootTask> | null = null;
      try { rootTask = findRootTask(recentReview.id); } catch {}
      const baseTitle = rootTask?.title?.replace(/^\[.*?\]\s*/, '') || recentReview.title.replace(/^\[.*?\]\s*/, '');
      const fixTitle = `[Fix] ${baseTitle}`;
      const sourceCode = rootTask?.result || '';
      const fixDescription = [
        '리뷰어 피드백을 반영하여 코드를 수정해주세요.',
        '',
        '⚠️ Critical/Major 이슈를 모두 수정하고, 수정된 전체 코드를 출력하세요.',
        '',
        '---',
        '## 🧩 원본 코드/결과 (수정 대상)',
        sourceCode ? sourceCode.slice(0, 5000) : '(원본 코드 없음)',
        '',
        '---',
        '## 🔍 리뷰 피드백',
        (recentReview.result || '').slice(0, 3000),
      ].join('\n');

      // Create a proposal action for user to approve
      const fixAction: ChiefAction = {
        type: 'create_task',
        params: { title: fixTitle, description: fixDescription, assignRole: 'developer' },
      };
      pendingProposals.set(messageId, [fixAction]);
      pendingProposalBySession.set(sessionId, messageId);

      const reply = L(lang,
        `✅ Proposing a fix task for review feedback.\n\n📋 "${fixTitle}"\n• Developer will apply review feedback\n• Auto-review after fix completes\n\nApprove to execute.${formatActionList([fixAction], lang)}`,
        `✅ 리뷰 피드백 반영 작업을 제안합니다.\n\n📋 "${fixTitle}"\n• 개발자가 리뷰 피드백을 반영하여 수정합니다\n• 수정 완료 후 자동으로 재리뷰합니다\n\n승인하시면 실행합니다.${formatActionList([fixAction], lang)}`);
      pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: now });
      if (responseCallback) {
        responseCallback(sessionId, {
          messageId,
          reply,
          actions: [fixAction],
          state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
          sessionId,
        });
      }
      return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
    }
  }

  // Short affirmative responses with no pending proposal → ignore gracefully
  const isShortAffirmative = /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok)$/i.test(userMessage.trim().toLowerCase());
  const pendingMessageId = pendingProposalBySession.get(sessionId);

  // If user changed their mind while previous LLM proposal was still in-flight, clear stale queued approval.
  if (!isShortAffirmative && queuedApprovalBySession.has(sessionId)) {
    queuedApprovalBySession.delete(sessionId);
  }

  if (isShortAffirmative && !pendingMessageId) {
    if (llmInFlightBySession.has(sessionId)) {
      queuedApprovalBySession.add(sessionId);
      const reply = L(lang, 'Processing previous request. Your approval will be auto-applied once it completes.', '직전 요청을 처리 중입니다. 완료되면 방금 승인("응")을 자동으로 이어서 실행할게요.');
      pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: now });
      return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
    }
    const reply = L(lang, 'No pending proposals. Please give a new instruction.', '현재 대기 중인 제안이 없습니다. 새로운 지시를 해주세요.');
    pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: now });
    return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
  }

  // If there is a pending proposal for this session, treat short approval text as execution intent.
  if (pendingMessageId) {
    const pending = pendingProposals.get(pendingMessageId) || [];
    const selected = parseApprovalSelection(userMessage, pending.length);
    if (selected && selected.length > 0) {
      // If user says generic approval ("응", "승인"), execute ALL pending actions sequentially
      const isGenericApproval = /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok|yes|approve|sure|do it|proceed|run|execute|네\s*,?\s*실행)$/i.test(userMessage.trim().toLowerCase())
        || /^(ㅇ|ㅇㅇ|응|네|예|승인|확인|좋아|진행해|go|ok)\s*[,.]?\s+/i.test(userMessage.trim().toLowerCase());
      const toExecute = isGenericApproval ? [...pending] : [pending[selected[0]]];

      const results: string[] = [];
      const runtimeBinding: { lastCreatedTaskId?: string | null } = { lastCreatedTaskId: null };
      batchAssignedAgentIds.clear(); // Reset batch tracking for this approval round
      results.push(L(lang, `✅ Approved — executing ${toExecute.length} action(s)`, `✅ 승인됨 — ${toExecute.length}건 실행 시작`));
      console.log(`[chief] chatWithChief approval: executing ${toExecute.length} actions, isGenericApproval=${isGenericApproval}`);
      for (let i = 0; i < toExecute.length; i++) {
        const action = bindActionWithRuntimeContext(toExecute[i], runtimeBinding);
        const stepLabel = toExecute.length > 1 ? `[${i + 1}/${toExecute.length}] ` : '';
        console.log(`[chief] chatWithChief step ${i+1}/${toExecute.length}: type=${action.type}, params=${JSON.stringify(action.params).slice(0, 200)}`);
        const executed = executeAction(action, sessionId);
        const ok = executed.result?.ok;
        console.log(`[chief] chatWithChief step ${i+1} result: ok=${ok}, message=${executed.result?.message?.slice(0, 100)}`);
        if (ok && executed.type === 'create_task' && executed.result?.id) {
          runtimeBinding.lastCreatedTaskId = executed.result.id;
        }
        results.push(`${stepLabel}${ok ? '✅' : '❌'} ${executed.result?.message || action.type}`);
        if (ok && action.type === 'create_task' && executed.result?.id) {
          // Auto-confirm and auto-execute the chain plan
          const taskChainPlan = getChainPlanForTask(executed.result.id);
          if (taskChainPlan && taskChainPlan.status === 'proposed') {
            confirmChainPlan(taskChainPlan.id);
            setChainAutoExecute(taskChainPlan.id, true);
          }
          results.push(`${stepLabel}↪ ${L(lang, 'Recommended chain auto-confirmed. Track progress in the chain preview.', '추천 체인이 자동 확정되었습니다. 체인 미리보기에서 진행 상황을 확인할 수 있습니다.')}`);
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

      let reply = `${L(lang, 'Execution results', '실행 결과')}:\n${results.join('\n')}`;
      if (remainingCount > 0) {
        reply += L(lang,
          `\n\n📌 **Next:** ${remainingCount} remaining action(s).\n${remainingPending!.map((a, i) => `${i + 1}. ${getActionLabelMap(a.type, lang)}`).join('\n')}\n\nSay "approve" to auto-execute the rest.`,
          `\n\n📌 **다음 단계:** 남은 액션 ${remainingCount}건이 있습니다.\n${remainingPending!.map((a, i) => `${i + 1}. ${getActionLabelMap(a.type, lang)}`).join('\n')}\n\n'승인'이라고 하시면 나머지도 자동 실행합니다.`);
      } else {
        const pendingTasks = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress');
        if (pendingTasks.length > 0) {
          reply += L(lang,
            `\n\n📌 **Next:** ${pendingTasks.length} task(s) in progress/pending.\n• Check status: "status" or "what's happening?"\n• Results: You'll be notified automatically\n• New requests: You can assign new tasks anytime`,
            `\n\n📌 **다음 단계:** ${pendingTasks.length}건의 작업이 진행/대기 중입니다.\n• 상태 확인: "진행중이야?" 또는 "상태 확인"\n• 결과 확인: 완료 시 자동으로 알려드립니다\n• 추가 요청: 언제든 새 작업을 지시할 수 있습니다`);
        } else {
          reply += L(lang,
            `\n\n📌 **Next:** All tasks completed.\n• Need more? Just ask\n• Say "status" to see the full overview`,
            `\n\n📌 **다음 단계:** 모든 작업이 완료되었습니다.\n• 추가 작업이 필요하면 말씀해주세요\n• "상태 확인"으로 전체 현황을 볼 수 있습니다`);
        }
      }

      pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });

      // If user had additional instructions after approval prefix, process them as a follow-up
      const postApproval = extractPostApprovalMessage(userMessage);
      if (postApproval) {
        // Queue the additional instruction as a new chat message after a short delay
        // so the approval result is visible first
        setTimeout(() => {
          chatWithChief(sessionId, postApproval);
        }, 500);
      }

      return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
    } else {
      // User sent a new unrelated message — discard the pending proposal
      pendingProposals.delete(pendingMessageId);
      pendingProposalBySession.delete(sessionId);
    }
  }

  const ruleIntent = classifyIntent(userMessage);
  const inDemoMode = isDemoMode();
  const intent: 'status' | 'other' = inDemoMode ? ruleIntent : 'other';

  // Always handle read-only status queries synchronously so they are never misrouted as amendments/actions.
  if (ruleIntent === 'status') {
    const reply = buildMonitoringReply(userMessage);
    pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });
    return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
  }

  // Demo mode only: auto-suggest meeting via rules.
  // Full mode delegates meeting necessity judgment to the model.
  if (inDemoMode && shouldAutoSuggestMeeting(userMessage)) {
    const action = buildMeetingSuggestionAction(userMessage);
    pendingProposals.set(messageId, [action]);
    pendingProposalBySession.set(sessionId, messageId);

    const reply = [
      '이 요청은 복잡도/의사결정 요소가 있어서 먼저 3인 미팅(PM·개발·리뷰어)으로 정렬하는 것을 권장합니다.',
      '',
      `제안: 미팅 시작 — "${action.params.title}"`,
      '원하면 지금 바로 세팅할게요. `응` 또는 `승인`이라고 답하면 시작합니다.',
      '(바로 태스크로 가려면 "미팅 없이 진행"이라고 말해줘.)',
    ].join('\n');

    pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });
    return { messageId, async: false, reply, messages: getChiefMessages(sessionId) };
  }

  // LLM mode
  if (!isDemoMode()) {
    const systemPrompt = buildChiefSystemPrompt(language);
    const recentMessages = getSessionMessages(sessionId).slice(-10);
    const conversationContext = recentMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Chief'}: ${m.content}`)
      .join('\n\n');

    const fullPrompt = `${systemPrompt}\n\n## 대화 이력\n${conversationContext}\n\nUser: ${userMessage}\n\nChief:`;

    llmInFlightBySession.set(sessionId, messageId);
    spawnAgentSession({
      sessionId: `chief-llm-${messageId}`,
      agentName: 'Chief',
      role: 'chief',
      model: 'claude-opus-4-6',
      prompt: fullPrompt,
      onComplete: (run: AgentRun) => {
        try {
          console.log(`[chief-debug] stdout-full: ${JSON.stringify(run.stdout.slice(0, 3000))}`);
          console.log(`[chief-debug] stderr-full: ${run.stderr.slice(0, 2000)}`);
          const rawOutput = parseAgentOutput(run.stdout);
          const { actions: parsedActions, cleanText } = parseActions(rawOutput);
          const intentActions = shouldSuppressActionsByIntent(intent) ? [] : parsedActions;
          const { actions: proposedActions, batchId } = applyBatchToCreateTaskActions(userMessage, intentActions);

          // If user already sent "응" while this LLM call was still processing, auto-approve once.
          const hadQueuedApproval = queuedApprovalBySession.delete(sessionId);
          if (hadQueuedApproval && proposedActions.length > 0) {
            const runtimeBinding: { lastCreatedTaskId?: string | null } = { lastCreatedTaskId: null };
            batchAssignedAgentIds.clear();
            const results: string[] = [`✅ 승인됨(대기열 자동실행) — ${proposedActions.length}건 실행 시작`];
            for (let i = 0; i < proposedActions.length; i++) {
              const action = bindActionWithRuntimeContext(proposedActions[i], runtimeBinding);
              const stepLabel = proposedActions.length > 1 ? `[${i + 1}/${proposedActions.length}] ` : '';
              const executed = executeAction(action, sessionId);
              const ok = executed.result?.ok;
              if (ok && executed.type === 'create_task' && executed.result?.id) {
                runtimeBinding.lastCreatedTaskId = executed.result.id;
                const taskChainPlan = getChainPlanForTask(executed.result.id);
                if (taskChainPlan && taskChainPlan.status === 'proposed') {
                  confirmChainPlan(taskChainPlan.id);
                  setChainAutoExecute(taskChainPlan.id, true);
                }
              }
              results.push(`${stepLabel}${ok ? '✅' : '❌'} ${executed.result?.message || action.type}`);
            }
            const autoApprovedReply = `${cleanText ? cleanText + '\n\n' : ''}${results.join('\n')}`;
            pushMessage(sessionId, { id: messageId, role: 'chief', content: autoApprovedReply, createdAt: new Date().toISOString() });
            if (responseCallback) {
              responseCallback(sessionId, {
                messageId,
                reply: autoApprovedReply,
                actions: [],
                state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
                sessionId,
              });
            }
            return;
          }

          // Emergency auto-execute: stop/cancel commands skip approval
          // Auto-execute start_review and view_task_result without approval
          const autoExecTypes = new Set(['start_review', 'view_task_result', 'confirm_meeting', 'confirm_task']);
          const allAutoExec = proposedActions.length > 0 && proposedActions.every(a => autoExecTypes.has(a.type));
          if (allAutoExec) {
            const results: string[] = [`⚡ 즉시 실행 — ${proposedActions.length}건`];
            for (const action of proposedActions) {
              try {
                const r = executeAction(action, sessionId);
                results.push(`✅ ${ACTION_LABEL_MAP[action.type] || action.type}: ${r.result?.message || '완료'}`);
              } catch (e) {
                results.push(`❌ ${ACTION_LABEL_MAP[action.type] || action.type}: ${e instanceof Error ? e.message : '실패'}`);
              }
            }
            const autoReply = `${cleanText ? cleanText + '\n\n' : ''}${results.join('\n')}`;
            pushMessage(sessionId, { id: messageId, role: 'chief', content: autoReply, createdAt: new Date().toISOString() });
            if (responseCallback) {
              responseCallback(sessionId, {
                messageId,
                reply: autoReply,
                actions: [],
                state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
                sessionId,
              });
            }
            return;
          }

          const isEmergencyStop = /^(멈춰|중지|스톱|stop|cancel|취소|다\s*멈춰|전부\s*중지|다\s*중지|그만)/i.test(userMessage.trim());
          const allCancelActions = proposedActions.length > 0 && proposedActions.every(a => a.type === 'cancel_task' || a.type === 'cancel_all_pending' || a.type === 'cancel_meeting');
          if (isEmergencyStop && allCancelActions) {
            // Execute immediately without approval
            const results: string[] = [`🛑 긴급 중지 — ${proposedActions.length}건 즉시 실행`];
            for (const action of proposedActions) {
              try {
                const r = executeAction(action, sessionId);
                results.push(`✅ ${ACTION_LABEL_MAP[action.type] || action.type}: ${r.result?.message || '완료'}`);
              } catch (e) {
                results.push(`❌ ${ACTION_LABEL_MAP[action.type] || action.type}: ${e instanceof Error ? e.message : '실패'}`);
              }
            }
            const emergencyReply = results.join('\n');
            pushMessage(sessionId, { id: messageId, role: 'chief', content: emergencyReply, createdAt: new Date().toISOString() });
            if (responseCallback) {
              responseCallback(sessionId, {
                messageId,
                reply: emergencyReply,
                actions: [],
                state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
                sessionId,
              });
            }
            return;
          }

          const conciseBaseReply = toConciseModeReply(userMessage, cleanText || '처리가 완료되었습니다.');
          const compactActionList = proposedActions.length > 5
            ? L(language, `\n\n${proposedActions.length} proposed actions ready. Approve to execute in order.`, `\n\n실행 후보 액션 ${proposedActions.length}건이 준비되었습니다. 승인하시면 필요한 순서로 실행합니다.`)
            : formatActionList(proposedActions, language);
          const batchHint = batchId
            ? `\n\n🧩 멀티-스택 분할 작업으로 판단되어 batch(${batchId})로 묶었습니다. 각 파트 완료 후 종합 취합 태스크가 자동 생성됩니다.`
            : '';
          const reply = `${conciseBaseReply}${compactActionList}${batchHint}`;
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
            sessionId,
          };

          if (responseCallback) {
            responseCallback(sessionId, response);
          }
        } finally {
          llmInFlightBySession.delete(sessionId);
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
