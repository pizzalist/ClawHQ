import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingType, MeetingCharacter, MeetingProposal, MeetingCandidate, DecisionPacket } from '@ai-office/shared';
import { stmts } from './db.js';
import { getAgent, listAgents, transitionAgent, resetAgent } from './agent-manager.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, type AgentRun } from './openclaw-adapter.js';

type MeetingListener = () => void;
const listeners: MeetingListener[] = [];
export function onMeetingChange(fn: MeetingListener) { listeners.push(fn); }
function emitChange() { for (const fn of listeners) fn(); }

function rowToMeeting(row: Record<string, unknown>): Meeting {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    type: row.type as MeetingType,
    status: row.status as Meeting['status'],
    participants: JSON.parse((row.participants as string) || '[]'),
    proposals: JSON.parse((row.proposals as string) || '[]'),
    decision: row.decision ? JSON.parse(row.decision as string) : null,
    character: (row.character as MeetingCharacter) || undefined,
    report: (row.report as string) || undefined,
    parentMeetingId: (row.parent_meeting_id as string) || null,
    sourceMeetingId: (row.source_meeting_id as string) || null,
    sourceCandidates: row.source_candidates ? JSON.parse(row.source_candidates as string) : undefined,
    decisionPacket: row.decision_packet ? JSON.parse(row.decision_packet as string) : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function isLegacyProposalMeeting(meeting: Meeting): boolean {
  const haystack = `${meeting.title}\n${meeting.description}\n${meeting.report || ''}\n${JSON.stringify(meeting.proposals || [])}`.toLowerCase();
  return haystack.includes('proposal') || haystack.includes('제안서') || haystack.includes('a안') || haystack.includes('b안') || haystack.includes('c안');
}

export function listMeetings(includeLegacy = false): Meeting[] {
  const meetings = (stmts.listMeetings.all() as Record<string, unknown>[]).map(rowToMeeting);
  return includeLegacy ? meetings : meetings.filter((m) => !isLegacyProposalMeeting(m));
}

export function getMeeting(id: string): Meeting | null {
  const row = stmts.getMeeting.get(id) as Record<string, unknown> | undefined;
  return row ? rowToMeeting(row) : null;
}

function saveMeeting(m: Meeting) {
  stmts.updateMeeting.run(m.status, JSON.stringify(m.proposals), m.decision ? JSON.stringify(m.decision) : null, m.report || null, m.id);
  // Persist lineage fields separately
  try {
    stmts.updateMeetingLineage.run(
      m.parentMeetingId || null,
      m.sourceMeetingId || null,
      m.sourceCandidates ? JSON.stringify(m.sourceCandidates) : null,
      m.decisionPacket ? JSON.stringify(m.decisionPacket) : null,
      m.id,
    );
  } catch { /* migration not yet applied */ }
  emitChange();
}

// Track pending contributions per meeting
const pendingContributions = new Map<string, { total: number; done: number }>();

export function createMeeting(
  title: string,
  description: string,
  type: MeetingType,
  participantIds: string[],
  character?: MeetingCharacter,
  lineage?: { parentMeetingId?: string; sourceMeetingId?: string; sourceCandidates?: MeetingCandidate[] },
): Meeting {
  const id = uuid();
  stmts.insertMeeting.run(id, title, description, type, JSON.stringify(participantIds), character || null);
  if (lineage) {
    try {
      stmts.updateMeetingLineage.run(
        lineage.parentMeetingId || null,
        lineage.sourceMeetingId || null,
        lineage.sourceCandidates ? JSON.stringify(lineage.sourceCandidates) : null,
        null, // no decision packet yet
        id,
      );
    } catch { /* migration not yet applied */ }
  }
  const meeting = getMeeting(id)!;
  emitChange();
  return meeting;
}

/** Role-specific focus areas for meeting contributions */
const ROLE_FOCUS: Record<string, { label: string; focus: string }> = {
  pm: {
    label: 'PM',
    focus: '전략, 우선순위, 실행계획, 리소스 배분, 일정 관리',
  },
  developer: {
    label: '개발자',
    focus: '기술적 분석, 구현 가능성, 기술 스택, 기술 리스크, 아키텍처',
  },
  reviewer: {
    label: '리뷰어',
    focus: '품질, 리스크, 개선점, 놓친 부분, 잠재적 문제',
  },
  designer: {
    label: '디자이너',
    focus: 'UX/UI, 사용자 관점, 디자인 방향, 사용성',
  },
  devops: {
    label: 'DevOps',
    focus: '인프라, 배포, 운영, 모니터링, 확장성',
  },
  qa: {
    label: 'QA',
    focus: '테스트 전략, 안정성, 엣지케이스, 품질 보증',
  },
};

/**
 * Start a collaborative planning meeting.
 * Each agent contributes their expert perspective on the topic (NOT a competing proposal).
 * When all contributions are in, a consolidated report is generated.
 */
export function startPlanningMeeting(title: string, description: string, participantIds: string[], character?: MeetingCharacter): Meeting {
  const meeting = createMeeting(title, description, 'planning', participantIds, character);
  let startedContributions = 0;

  for (const agentId of participantIds) {
    const agent = getAgent(agentId);
    if (!agent) continue;

    const roleInfo = ROLE_FOCUS[agent.role] || { label: agent.role, focus: '전반적인 분석' };
    const sessionId = `meeting-${meeting.id.slice(0, 8)}-${agent.name.toLowerCase()}-${Date.now()}`;

    const prompt = `당신은 ${agent.name}, AI 오피스 팀의 ${roleInfo.label}입니다.

팀이 다음 주제에 대해 회의를 진행하고 있습니다:

## "${title}"

${description}

${roleInfo.label} 관점에서 전문적인 분석과 의견을 공유해주세요.

집중해야 할 영역:
- ${roleInfo.focus}
- 이 주제에 대한 구체적인 분석
- 실행 가능한 제안

"제안서"나 "proposal" 형식으로 작성하지 마세요. 회의에서 발언하듯이 자연스럽게 분석과 의견을 직접 공유해주세요.

반드시 한국어로 응답하세요.`;

    try { transitionAgent(agentId, 'working', null, sessionId); } catch { /* may already be working */ }

    spawnAgentSession({
      sessionId,
      agentName: agent.name,
      role: agent.role,
      model: agent.model,
      prompt,
      onComplete: (run) => handleContributionComplete(meeting.id, agentId, agent.name, agent.role, run),
    });
    startedContributions++;
  }

  pendingContributions.set(meeting.id, { total: startedContributions, done: 0 });
  if (startedContributions === 0) {
    pendingContributions.delete(meeting.id);
    finalizeMeeting(meeting.id);
  }

  return meeting;
}

function handleContributionComplete(meetingId: string, agentId: string, agentName: string, agentRole: string, run: AgentRun) {
  const meeting = getMeeting(meetingId);
  if (!meeting) return;

  const content = run.exitCode === 0
    ? parseAgentOutput(run.stdout)
    : `[오류 발생: exit ${run.exitCode}]`;

  // We reuse MeetingProposal type but treat it as a "contribution"
  const contribution: MeetingProposal = {
    agentId,
    agentName,
    content,
    taskId: run.sessionId,
    reviews: [], // Not used in collaborative model
  };

  meeting.proposals.push(contribution);
  saveMeeting(meeting);

  // Reset agent to idle (force reset to avoid FSM race conditions)
  try { transitionAgent(agentId, 'done', null); } catch { /* ignore */ }
  setTimeout(() => {
    try { transitionAgent(agentId, 'idle', null, null); } catch {
      // Force reset if FSM transition fails
      try { resetAgent(agentId); } catch { /* ignore */ }
    }
  }, 500);

  cleanupRun(run.sessionId);

  // Check if all contributions are in
  const tracker = pendingContributions.get(meetingId);
  if (tracker) {
    tracker.done++;
    if (tracker.done >= tracker.total) {
      pendingContributions.delete(meetingId);
      // All contributions received — generate consolidated report
      finalizeMeeting(meetingId);
    }
  }
}

/**
 * Finalize meeting: generate a consolidated report from all contributions.
 * No review phase, no winner selection — just a unified summary.
 */
function finalizeMeeting(meetingId: string) {
  const meeting = getMeeting(meetingId);
  if (!meeting) return;

  meeting.status = 'completed';
  meeting.report = generateConsolidatedReport(meeting);
  saveMeeting(meeting);
}

/**
 * Generate a consolidated meeting report combining all agent perspectives.
 */
function generateConsolidatedReport(meeting: Meeting): string {
  const agents = listAgents();
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const date = new Date().toLocaleDateString('ko-KR');

  const charLabels: Record<string, string> = {
    brainstorm: '🧠 자유 토론',
    planning: '📋 기획 회의',
    review: '🔍 검토 회의',
    retrospective: '🔄 회고',
  };
  const charLabel = meeting.character ? (charLabels[meeting.character] || meeting.character) : meeting.type;

  // Build participant list
  const participantLines = meeting.proposals.map(p => {
    const agent = agentMap.get(p.agentId);
    const roleInfo = ROLE_FOCUS[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
    return `- ${p.agentName} (${roleInfo.label}): ${roleInfo.focus.split(',')[0].trim()} 관점`;
  }).join('\n');

  // Build per-perspective summaries
  const perspectiveSections = meeting.proposals.map(p => {
    const agent = agentMap.get(p.agentId);
    const roleInfo = ROLE_FOCUS[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
    // Take first ~500 chars as summary, or full content if short
    const summary = p.content.length > 600
      ? p.content.slice(0, 600).replace(/\n*$/, '') + '...'
      : p.content;
    return `### ${roleInfo.label} 관점 (${p.agentName})\n\n${summary}`;
  }).join('\n\n');

  // Extract common themes (simple keyword-based)
  const allContent = meeting.proposals.map(p => p.content).join('\n');

  let report = `# ${meeting.title} 회의 결과\n\n`;
  report += `**유형:** ${charLabel} | **날짜:** ${date}\n\n`;
  report += `## 참여자\n${participantLines}\n\n`;
  report += `## 안건\n\n${meeting.description || '(설명 없음)'}\n\n`;
  report += `## 핵심 논의 내용\n\n${perspectiveSections}\n\n`;
  report += `## 종합\n\n`;
  report += `${meeting.proposals.length}명의 전문가가 각자의 관점에서 "${meeting.title}" 주제를 분석했습니다. `;
  report += `위 내용을 바탕으로 다음 단계를 결정해주세요.\n`;

  return report;
}

// Keep startReviewPhase for backward compatibility but redirect to finalize
export function startReviewPhase(meetingId: string) {
  finalizeMeeting(meetingId);
}

/**
 * Extract structured candidates from a completed planning/brainstorm meeting.
 * Parses proposals into MeetingCandidate[] for downstream review meetings.
 */
export function extractCandidatesFromMeeting(meetingId: string): MeetingCandidate[] {
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.status !== 'completed') return [];

  return meeting.proposals.map(p => ({
    name: p.agentName,
    summary: p.content.slice(0, 800),
    score: undefined,
    rationale: undefined,
  }));
}

/**
 * Start a review meeting that scores candidates from a source meeting.
 * Automatically injects sourceMeetingId and sourceCandidates.
 */
export function startReviewMeetingFromSource(
  title: string,
  sourceMeetingId: string,
  reviewerIds: string[],
): Meeting | null {
  const sourceMeeting = getMeeting(sourceMeetingId);
  if (!sourceMeeting || sourceMeeting.status !== 'completed') return null;

  const candidates = extractCandidatesFromMeeting(sourceMeetingId);
  if (candidates.length === 0) return null;

  const meeting = createMeeting(
    title,
    `"${sourceMeeting.title}" 회의 결과를 기반으로 후보를 평가합니다.`,
    'review',
    reviewerIds,
    'review',
    {
      parentMeetingId: sourceMeetingId,
      sourceMeetingId,
      sourceCandidates: candidates,
    },
  );

  // Start reviewer scoring sessions
  let startedContributions = 0;
  const candidatesSummary = candidates.map((c, i) => `${i + 1}. **${c.name}**: ${c.summary.slice(0, 200)}`).join('\n');

  for (const agentId of reviewerIds) {
    const agent = getAgent(agentId);
    if (!agent) continue;

    const sessionId = `review-${meeting.id.slice(0, 8)}-${agent.name.toLowerCase()}-${Date.now()}`;
    const prompt = `당신은 ${agent.name}, 전문 리뷰어입니다.

"${sourceMeeting.title}" 기획 회의에서 도출된 후보들을 평가해주세요.

## 평가 대상 후보
${candidatesSummary}

## 평가 기준
각 후보에 대해 다음을 제공하세요:
1. 점수 (1-10)
2. 가중치 근거
3. 장단점

최종적으로 가장 추천하는 1안과 대안 1-2안을 제시하세요.
반드시 한국어로 응답하세요.`;

    try { transitionAgent(agentId, 'working', null, sessionId); } catch { /* may already be working */ }

    spawnAgentSession({
      sessionId,
      agentName: agent.name,
      role: agent.role,
      model: agent.model,
      prompt,
      onComplete: (run) => handleContributionComplete(meeting.id, agentId, agent.name, agent.role, run),
    });
    startedContributions++;
  }

  pendingContributions.set(meeting.id, { total: startedContributions, done: 0 });
  if (startedContributions === 0) {
    pendingContributions.delete(meeting.id);
    finalizeMeeting(meeting.id);
  }

  return meeting;
}

/**
 * Get child meetings that reference a parent meeting.
 */
export function getChildMeetings(parentMeetingId: string): Meeting[] {
  return listMeetings(true).filter(m => m.parentMeetingId === parentMeetingId || m.sourceMeetingId === parentMeetingId);
}

export function decideMeeting(meetingId: string, winnerId: string, feedback: string): Meeting {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  meeting.decision = { winnerId, feedback };
  meeting.status = 'completed';
  if (!meeting.report) {
    meeting.report = generateConsolidatedReport(meeting);
  }
  saveMeeting(meeting);
  return meeting;
}

export function cleanupLegacyMeetings(): { deleted: number; ids: string[] } {
  const rows = stmts.listLegacyMeetings.all() as Record<string, unknown>[];
  const ids: string[] = [];
  for (const row of rows) {
    const id = row.id as string;
    stmts.deleteMeetingById.run(id);
    ids.push(id);
  }
  if (ids.length > 0) emitChange();
  return { deleted: ids.length, ids };
}
