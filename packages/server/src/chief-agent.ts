import { v4 as uuid } from 'uuid';
import type { AgentRole, AgentModel, ChiefChatMessage, ChiefAction, ChiefResponse, ChiefCheckIn, ChiefCheckInOption, ChiefNotification, Meeting, TeamPlanSuggestion, AppEvent, Task } from '@ai-office/shared';
import { listAgents, createAgent, getAgent, suggestFriendlyAgentName } from './agent-manager.js';
import { listTasks, createTask, processQueue } from './task-queue.js';
import { listMeetings, startPlanningMeeting, getMeeting, extractCandidatesFromMeeting, startReviewMeetingFromSource, getChildMeetings, deleteMeeting, deleteAllMeetings } from './meetings.js';
import { listDeliverablesByTask, validateWebDeliverable } from './deliverables.js';
import { suggestChainPlan, getChainPlanForTask, advanceChainPlan, shouldAutoChain, setChainAutoExecute, confirmChainPlan } from './chain-plan.js';
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

// Session-aware routing context for inline notifications/actions
const notificationSessionById = new Map<string, string>();
let lastActiveChiefSessionId = 'chief-default';

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
function generateDecisionPacket(meeting: Meeting): import('@ai-office/shared').DecisionPacket | null {
  if (meeting.decisionPacket) return meeting.decisionPacket;
  if (!meeting.sourceCandidates || meeting.sourceCandidates.length === 0) return null;
  if (meeting.proposals.length === 0) return null;

  const candidateNames = meeting.sourceCandidates.map(c => c.name);
  const reviewerScoreCards: import('@ai-office/shared').ReviewerScoreCard[] = [];

  for (const proposal of meeting.proposals) {
    const parsed = parseStructuredScores(proposal.content, candidateNames);
    const scores: import('@ai-office/shared').ReviewerScoreCard['scores'] = [];

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
function resolveNotificationSession(notification: ChiefNotification): string {
  const sid = (notification.sessionId || '').trim();
  if (sid) return sid;
  return lastActiveChiefSessionId || 'chief-default';
}

function formatMeetingResult(meetingId: string): string {
  const meeting = getMeeting(meetingId);
  if (!meeting) return '해당 회의를 찾을 수 없습니다. 회의 목록에서 다시 선택해주세요.';

  const proposalCount = meeting.proposals?.length || 0;
  const report = meeting.report?.trim();
  const preview = (report || meeting.proposals.map(p => `${p.agentName}: ${p.content}`).join('\n\n')).trim();

  const participantTotal = meeting.participants?.length || proposalCount;
  const lines = [
    `📄 **회의 결과**: "${meeting.title}"`,
    `상태: ${meeting.status} · 참여자: ${participantTotal}명 · 제안: ${proposalCount}건`,
  ];

  // Show lineage info
  if (meeting.sourceMeetingId) {
    const sourceMeeting = getMeeting(meeting.sourceMeetingId);
    if (sourceMeeting) {
      lines.push(`📌 기반 회의: "${sourceMeeting.title}"`);
    }
  }
  if (meeting.sourceCandidates && meeting.sourceCandidates.length > 0) {
    lines.push(`📋 평가 대상 후보: ${meeting.sourceCandidates.map(c => c.name).join(', ')}`);
  }

  lines.push('', preview || '(결과 없음)');

  // Show decision packet if available
  if (meeting.decisionPacket) {
    const dp = meeting.decisionPacket;
    lines.push('', '---', '📊 **최종 의사결정 패킷**');
    if (dp.recommendation) {
      lines.push(`🏆 추천안: **${dp.recommendation.name}** — ${dp.recommendation.summary?.slice(0, 100) || ''}`);
    }
    if (dp.alternatives && dp.alternatives.length > 0) {
      lines.push(`💡 대안: ${dp.alternatives.map(a => a.name).join(', ')}`);
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

function formatTaskResult(taskId: string): string {
  const task = listTasks().find(t => t.id === taskId);
  if (!task) return '해당 작업을 찾을 수 없습니다. 목록에서 다시 선택해주세요.';
  const status = task.status;
  const preview = (task.result || '(결과 없음)').trim();
  return `📄 **작업 결과**: "${task.title}"\n상태: ${status}\n\n${preview}`;
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
export function handleChiefAction(notificationId: string, actionId: string, params?: Record<string, string>, sessionId?: string): { reply: string; sessionId: string } {
  const scopedSessionId = (notificationSessionById.get(notificationId) || sessionId || 'chief-default').trim() || 'chief-default';

  const actionKey = makeInlineActionIdempotencyKey(notificationId, actionId);
  if (handledInlineActionKeys.has(actionKey)) {
    return { reply: '이미 처리된 요청입니다. (중복 클릭 방지)', sessionId: scopedSessionId };
  }
  handledInlineActionKeys.add(actionKey);

  const extractIdFromAction = (raw: string, prefix: string): string | null => {
    const m = raw.match(new RegExp(`^${prefix}-(.+)$`));
    return m?.[1] || null;
  };

  let reply: string;

  // Normalize: actionId may be compound like "approve-meeting-xxx" or "revise-meeting-xxx"
  if (actionId === 'approve' || actionId.startsWith('approve-') || actionId.startsWith('approve_')) {
    const meetingId = params?.meetingId;
    const taskId = params?.taskId;
    const nextStepLines: string[] = ['✅ 확정되었습니다.'];

    if (meetingId) {
      const meeting = getMeeting(meetingId);
      if (!meeting) {
        nextStepLines.push('\n\n완료.');
      } else {
        if (meeting.character === 'planning' || meeting.character === 'brainstorm') {
          // Do NOT auto-start review. Show candidates and let user decide.
          const candidates = extractCandidatesFromMeeting(meetingId);
          if (candidates && candidates.length > 0) {
            const candidateList = candidates.map((c, i) => `${i + 1}. **${c.name}**: ${c.summary.slice(0, 120)}`).join('\n');
            nextStepLines.push(`\n\n📋 **도출된 후보 ${candidates.length}건:**\n${candidateList}`);
            nextStepLines.push(`\n리뷰어 점수화를 원하시면 회의 완료 알림의 "🔍 리뷰어 점수화 시작" 버튼을 눌러주세요.`);
          } else {
            nextStepLines.push(`\n\n📋 구조화된 후보가 없습니다. 회의 결과를 확인해주세요.`);
          }
        } else if (meeting.sourceMeetingId) {
          // Review meeting confirmed → auto-create spec task from recommendation
          const rec = meeting.decisionPacket?.recommendation;
          const recName = rec?.name || meeting.title;
          const taskTitle = `[기획/명세서] ${recName}`;
          const taskDesc = [
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

          nextStepLines.push(`\n\n🚀 **자동 실행:** 추천안 "${recName}" 기반 기획/명세서 작성 태스크 생성 → ${pmAgent.name}에게 배정 → 실행 중`);
          nextStepLines.push(`📋 태스크: "${taskTitle}"`);
          nextStepLines.push(`완료 시 자동으로 보고드리겠습니다.`);
        } else {
          // Generic meeting — create task from content
          const taskTitle = `[실행] ${meeting.title} 확정안`;
          const taskDesc = `회의 "${meeting.title}" 결과를 실행하세요.\n\n${meeting.report || meeting.proposals.map(p => `${p.agentName}: ${p.content}`).join('\n\n')}`;
          const agents = listAgents();
          let pmAgent = agents.find(a => a.role === 'pm' && a.state === 'idle') || agents.find(a => a.role === 'pm');
          if (!pmAgent) pmAgent = createAgent(suggestFriendlyAgentName('pm'), 'pm', DEFAULT_MODEL_BY_ROLE.pm);
          const newTask = createTask(taskTitle, taskDesc, pmAgent.id);
          setTimeout(() => processQueue(), 200);
          nextStepLines.push(`\n\n🚀 **자동 실행:** 실행 태스크를 ${pmAgent.name}에게 배정했습니다.`);
          nextStepLines.push(`완료 시 자동으로 보고드리겠습니다.`);
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
            let nextAgent = agents.find(a => a.role === nextStep.role && a.state === 'idle') || agents.find(a => a.role === nextStep.role);
            if (!nextAgent) nextAgent = createAgent(suggestFriendlyAgentName(nextStep.role), nextStep.role, DEFAULT_MODEL_BY_ROLE[nextStep.role]);

            const nextTitle = `[${nextStep.label}] ${task?.title || ''}`.trim();
            const nextDesc = `이전 단계 결과를 기반으로 ${nextStep.label}을(를) 수행하세요.\n\n${nextStep.reason}\n\n## 이전 결과\n${(task?.result || '').slice(0, 2000)}`;
            const newTask = createTask(nextTitle, nextDesc, nextAgent.id);
            setTimeout(() => processQueue(), 200);

            nextStepLines.push(`\n\n🚀 **자동 실행:** 다음 단계 "${nextStep.label}" 태스크 생성 → ${nextAgent.name}에게 배정 → 실행 중`);
            nextStepLines.push(`📋 태스크: "${nextTitle}"`);
            nextStepLines.push(`📊 체인 진행: ${nextIdx + 1}/${chainPlan.steps.length} 단계`);
            nextStepLines.push(`완료 시 자동으로 보고드리겠습니다.`);
          } else {
            nextStepLines.push(`\n\n✅ 체인 플랜의 모든 단계가 완료되었습니다.`);
          }
        } else {
          nextStepLines.push(`\n\n✅ 체인 플랜의 모든 단계가 완료되었습니다.`);
        }
      } else if (task && task.result) {
        // No chain plan — derive next step from task context
        const taskTitle = task.title.toLowerCase();
        let nextRole: import('@ai-office/shared').AgentRole = 'developer';
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
            nextStepLines.push(`\n\n📌 남은 작업 ${pendingCount}건이 진행/대기 중입니다. 완료 시 자동 보고드립니다.`);
          } else {
            nextStepLines.push(`\n\n✅ 모든 작업이 완료되었습니다.`);
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
        let nextAgent = agents.find(a => a.role === nextRole && a.state === 'idle') || agents.find(a => a.role === nextRole);
        if (!nextAgent) nextAgent = createAgent(suggestFriendlyAgentName(nextRole), nextRole, DEFAULT_MODEL_BY_ROLE[nextRole]);

        const nextTaskTitle = `[${nextLabel}] ${task.title}`;
        const nextTaskDesc = `이전 태스크 "${task.title}" 결과를 기반으로 ${nextLabel}을(를) 수행하세요.\n\n## 이전 결과\n${(task.result || '').slice(0, 2000)}`;
        const newTask = createTask(nextTaskTitle, nextTaskDesc, nextAgent.id);
        setTimeout(() => processQueue(), 200);

        nextStepLines.push(`\n\n🚀 **자동 실행:** "${nextLabel}" 태스크 생성 → ${nextAgent.name}에게 배정 → 실행 중`);
        nextStepLines.push(`📋 태스크: "${nextTaskTitle}"`);
        nextStepLines.push(`완료 시 자동으로 보고드리겠습니다.`);
      } else {
        nextStepLines.push(`\n\n✅ 확정 완료.`);
      }
    } else {
      nextStepLines.push(`\n\n✅ 확정 완료.`);
    }

    reply = nextStepLines.join('');
  } else if (actionId === 'request_revision' || actionId.startsWith('revise-') || actionId.startsWith('revision-') || actionId.startsWith('request_revision')) {
    reply = '수정 요청을 접수했습니다. 어떤 부분을 수정해야 할까요?\n\n💡 구체적인 수정 방향을 알려주시면 더 빠르게 처리할 수 있습니다.';
  } else if (actionId === 'view_result' || actionId.startsWith('view-')) {
    const meetingId = extractIdFromAction(actionId, 'view-meeting') || params?.meetingId;
    const taskId = extractIdFromAction(actionId, 'view') || params?.taskId;

    if (meetingId) {
      reply = formatMeetingResult(meetingId);
    } else if (taskId) {
      reply = formatTaskResult(taskId);
    } else {
      reply = '확인할 결과 대상을 찾지 못했습니다. 목록에서 다시 선택해주세요.';
    }
  } else if (actionId === 'select_proposal' || actionId.startsWith('select-')) {
    const proposalAgent = params?.agentName || '선택된 안';
    reply = `${proposalAgent}의 제안을 선택했습니다. 이대로 진행할까요?`;
  } else if (actionId === 'retry' || actionId.startsWith('retry-')) {
    reply = '재시도를 시작합니다. 잠시 기다려주세요.';
  } else if (actionId === 'start_review' || actionId.startsWith('start-review-')) {
    // Auto-start review meeting from source meeting
    const meetingId = extractIdFromAction(actionId, 'start-review') || params?.meetingId;
    if (meetingId) {
      const sourceMeeting = getMeeting(meetingId);
      if (sourceMeeting) {
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
          `[리뷰] ${sourceMeeting.title}`,
          meetingId,
          reviewerIds,
        );
        if (reviewMeeting) {
          reply = `🔍 리뷰 미팅 "${reviewMeeting.title}"을 시작했습니다.\n${reviewerIds.length}명의 리뷰어가 기획 회의 후보를 평가 중입니다.\n완료 시 점수표와 최종 추천안을 보고드리겠습니다.`;
        } else {
          reply = '⚠️ 리뷰 미팅을 시작할 수 없습니다.\n\n점수화 대상 후보(sourceCandidates)가 없습니다. 먼저 기획/브레인스토밍 회의를 완료하여 후보를 도출한 뒤 "리뷰어 점수화 시작"을 눌러주세요.';
        }
      } else {
        reply = '리뷰 대상 회의를 찾을 수 없습니다.';
      }
    } else {
      reply = '리뷰 대상 회의를 찾을 수 없습니다.';
    }
  } else {
    // Catch-all: graceful fallback — never expose raw actionId to user
    reply = `요청을 확인했습니다. 다시 시도하거나 다른 옵션을 선택해주세요.`;
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
  if (event.type === 'chain_spawned' && event.taskId) {
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
    const resultPreview = summarizeTaskResult(task.result);
    const elapsedMs = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
    const elapsedSec = Math.round(elapsedMs / 1000);

    // Check web deliverables for validation issues
    const deliverables = listDeliverablesByTask(event.taskId);
    const webDeliverables = deliverables.filter(d => d.type === 'web');
    let validationWarning = '';
    for (const wd of webDeliverables) {
      // Always re-validate to catch edge cases
      const validation = validateWebDeliverable(wd.content);
      if (!validation.valid) {
        validationWarning = `\n\n⚠️ **빈 화면 위험 경고**:\n${validation.issues.map(i => `• ${i}`).join('\n')}\n\n🔍 체크리스트: DOM mount 확인 / console error 확인 / network 404·500 확인 / 렌더 루프 여부\n수정 요청을 권장합니다.`;
        break;
      }
    }

    // Dedup: skip if already emitted for this task
    if (isNotificationDuplicate('task_complete', event.taskId)) return;

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
      // Informational only: keep a single confirmation entry point on notification card
      if (!isNotificationDuplicate('checkin_task_completion_info', task.id)) {
        emitCheckIn({
          id: `checkin-completion-${Date.now()}`,
          stage: 'completion',
          message: `모든 작업이 완료되었습니다! 🎉\n\n` +
            `완료된 작업 ${completedCount}건의 최종 결과를 확인해주세요.\n` +
            `확정/수정은 상단 완료 알림 카드의 버튼에서 한 번만 진행해 주세요.`,
          taskId: task.id,
          resultSummary: resultPreview,
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

      // Build context-appropriate actions
      const meetingActions: any[] = [
        { id: `view-meeting-${meeting.id}`, label: '📄 회의 결과 보기', action: 'view_result', params: { meetingId: meeting.id } },
      ];

      // If planning/brainstorm meeting, offer to start review scoring
      if (meeting.character === 'planning' || meeting.character === 'brainstorm') {
        meetingActions.push(
          { id: `start-review-${meeting.id}`, label: '🔍 리뷰어 점수화 시작', action: 'start_review', params: { meetingId: meeting.id } },
        );
      }

      meetingActions.push(
        { id: `approve-meeting-${meeting.id}`, label: '✅ 확정', action: 'approve', params: { meetingId: meeting.id } },
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
        notifyChief({
          id: `notif-meeting-${meeting.id}-${Date.now()}`,
          type: 'meeting_complete',
          title: meeting.title,
          summary: `🏛️ [회의 완료] "${meeting.title}"\n\n참여자 ${participantCount}명 중 ${contributionCount}명이 논의를 완료했습니다.${lineageInfo}\n\n${reportPreview}\n\n결과를 확인하고 다음 단계를 결정해주세요.`,
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
export function respondToCheckIn(checkInId: string, optionId: string, userComment?: string): { reply: string; actions?: ChiefAction[] } {
  const dedupeKey = makeCheckInIdempotencyKey(checkInId, optionId);
  if (handledCheckInResponseKeys.has(dedupeKey)) {
    return { reply: '이미 처리된 응답입니다. (중복 클릭 방지)' };
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

체인/파이프라인 제안 시:
- 반드시 "추천안입니다. 확정하시면 실행합니다." 형태로 안내하세요.
- 확정 전에는 "실행합니다" 또는 "진행합니다" 같은 단정 문구를 사용하지 마세요.
- QA→Dev 등 역할 전환 시 "다음 단계로 ○○를 추천합니다. 진행할까요?" 형태를 사용하세요.

미팅은 다음 경우에만 제안하세요:
- 사용자가 명시적으로 회의를 요청한 경우
- 3명 이상의 에이전트가 협업해야 하는 복잡한 작업인 경우
단순 작업(삭제, 상태 확인, 1인 작업)에는 절대 미팅을 제안하지 마세요.

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

const TASK_ID_PLACEHOLDER_RE = /^(\(?.*생성된\s*task\s*id.*\)?|\(?.*task\s*id.*\)?|\{?taskid\}?|<taskid>|new[-_ ]?task)$/i;

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

function classifyIntent(userMessage: string): 'status' | 'simple_action' | 'definition' | 'other' {
  const msg = (userMessage || '').toLowerCase();

  const readOnlyStatusLike = /(상태\s*재?확인|재확인|다시\s*상태|상태\s*체크|진행\s*중(이야|인가|이냐)?|진행중|실행\s*중|실행중|진행\s*상황|진행률|현황|지금\s*상태|현재\s*상태|언제\s*줘|언제\s*돼|언제\s*끝|다\s*됐|아직(이야|인가|이냐|이에요)?|어떻게\s*되|되고\s*있|결과\s*나왔|끝났|완료\s*됐|다\s*했|했어\?|됐어\?|status|eta|예상\s*시간|얼마나\s*남|몇\s*명|몇\s*건)/i.test(msg);
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

function shouldSuppressActionsByIntent(intent: 'status' | 'simple_action' | 'definition' | 'other'): boolean {
  return intent === 'status' || intent === 'definition';
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
        const { title, participants, character, participantCount: participantCountRaw } = action.params;
        const isScoringReview = (character || '').toLowerCase() === 'review' || /(점수화|스코어|scoring)/i.test(title || '');
        if (isScoringReview) {
          return {
            ...action,
            result: {
              ok: false,
              message: '점수화 리뷰 미팅은 sourceCandidates가 필요합니다. 완료된 기획/브레인스토밍 미팅에서 "리뷰어 점수화 시작"으로 생성해주세요.',
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

        const meeting = startPlanningMeeting(
          title || '총괄자 미팅',
          `총괄자가 시작한 미팅`,
          participantIds,
          (character as any) || 'planning',
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
        return { ...action, result: { ok: true, message: `작업 "${task.title}"를 ${agent.name}에게 배정했습니다.` } };
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
      case 'cancel_meeting': // alias for delete_meeting
      case 'delete_meeting': {
        const { meetingId } = action.params;
        if (!meetingId) {
          return { ...action, result: { ok: false, message: 'meetingId가 필요합니다' } };
        }
        const meeting = getMeeting(meetingId);
        if (!meeting) {
          return { ...action, result: { ok: false, message: `미팅을 찾을 수 없습니다: ${meetingId}` } };
        }
        const deleted = deleteMeeting(meetingId);
        return { ...action, result: { ok: deleted, message: deleted ? `미팅 "${meeting.title}" 삭제됨` : '미팅 삭제 실패' } };
      }
      case 'delete_all_meetings': {
        const count = deleteAllMeetings();
        return { ...action, result: { ok: true, message: `미팅 ${count}건 삭제됨` } };
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
): {
  executedActions: ChiefAction[];
  skippedActions: ChiefAction[];
  stoppedReason?: string;
  state: { agents: any[]; tasks: any[]; meetings: any[] };
} {
  const actions = pendingProposals.get(messageId);
  if (!actions || actions.length === 0) {
    throw new Error(`No pending proposal found for messageId: ${messageId}`);
  }

  const continueOnError = options?.continueOnError === true;
  const base = overrideActions && overrideActions.length > 0 ? overrideActions : actions;
  const toExecute = selectedIndices
    ? selectedIndices.filter(i => i >= 0 && i < base.length).map(i => base[i])
    : base;

  const totalCount = toExecute.length;

  // Feedback: approval received
  pushMessage('chief-default', {
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

  for (let i = 0; i < toExecute.length; i++) {
    const action = bindActionWithRuntimeContext(toExecute[i], runtimeBinding);
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

    if (executed.result?.ok && executed.type === 'create_task' && executed.result?.id) {
      runtimeBinding.lastCreatedTaskId = executed.result.id;
    }

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

    if (!ok && !continueOnError) {
      stoppedReason = `${stepLabel} 실패로 인해 후속 액션 중단 (${executed.result?.message || '알 수 없는 오류'})`;
      stopIndex = i;
      break;
    }
  }

  const skippedActions = stopIndex >= 0 ? toExecute.slice(stopIndex + 1) : [];
  if (stoppedReason && skippedActions.length > 0) {
    const skippedList = skippedActions.map((a, idx) => `${stopIndex + 2 + idx}. ${ACTION_LABEL_MAP[a.type] || a.type}`).join(', ');
    pushMessage('chief-default', {
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

  let summaryMsg = `🎯 **실행 완료** — 성공 ${successCount}건`;
  if (failCount > 0) summaryMsg += `, 실패 ${failCount}건`;
  if (stoppedReason) summaryMsg += `\n\n⛔ **중단 사유:** ${stoppedReason}`;
  if (skippedActions.length > 0) {
    summaryMsg += `\n🧾 **미실행 액션:** ${skippedActions.map(a => ACTION_LABEL_MAP[a.type] || a.type).join(', ')}`;
  }
  if (pendingTasks.length > 0) {
    summaryMsg += `\n\n📌 **다음 단계:** ${pendingTasks.length}건의 작업이 진행/대기 중입니다.\n• "진행중이야?"로 상태 확인 가능\n• 완료 시 자동으로 보고드립니다`;
  } else {
    summaryMsg += `\n\n📌 **다음 단계:** 추가 작업이 필요하시면 말씀해주세요.`;
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
    skippedActions,
    stoppedReason,
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
  cancel_meeting: '미팅 삭제',
  delete_meeting: '미팅 삭제',
  delete_all_meetings: '전체 미팅 삭제',
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
export function chatWithChief(sessionId: string, userMessage: string): { messageId: string; async: boolean; reply?: string; suggestions?: TeamPlanSuggestion[]; messages?: ChiefChatMessage[] } {
  lastActiveChiefSessionId = sessionId || 'chief-default';
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
      const runtimeBinding: { lastCreatedTaskId?: string | null } = { lastCreatedTaskId: null };
      results.push(`✅ 승인됨 — ${toExecute.length}건 실행 시작`);
      for (let i = 0; i < toExecute.length; i++) {
        const action = bindActionWithRuntimeContext(toExecute[i], runtimeBinding);
        const stepLabel = toExecute.length > 1 ? `[${i + 1}/${toExecute.length}] ` : '';
        const executed = executeAction(action);
        const ok = executed.result?.ok;
        if (ok && executed.type === 'create_task' && executed.result?.id) {
          runtimeBinding.lastCreatedTaskId = executed.result.id;
        }
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
        reply += `\n\n📌 **다음 단계:** 남은 액션 ${remainingCount}건이 있습니다.\n${remainingPending!.map((a, i) => `${i + 1}. ${ACTION_LABEL_MAP[a.type] || a.type}`).join('\n')}\n\n'승인'이라고 하시면 나머지도 자동 실행합니다.`;
      } else {
        const pendingTasks = listTasks().filter(t => t.status === 'pending' || t.status === 'in-progress');
        if (pendingTasks.length > 0) {
          reply += `\n\n📌 **다음 단계:** ${pendingTasks.length}건의 작업이 진행/대기 중입니다.\n• 상태 확인: "진행중이야?" 또는 "상태 확인"\n• 결과 확인: 완료 시 자동으로 알려드립니다\n• 추가 요청: 언제든 새 작업을 지시할 수 있습니다`;
        } else {
          reply += `\n\n📌 **다음 단계:** 모든 작업이 완료되었습니다.\n• 추가 작업이 필요하면 말씀해주세요\n• "상태 확인"으로 전체 현황을 볼 수 있습니다`;
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
      model: 'claude-opus-4-6',
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
            sessionId,
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
