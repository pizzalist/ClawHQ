import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingType, MeetingCharacter, MeetingProposal, MeetingCandidate, DecisionPacket } from '@ai-office/shared';
import { stmts } from './db.js';
import { getAgent, listAgents, transitionAgent, resetAgent, createAgent } from './agent-manager.js';
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
  // === Hard participant count check: validate ALL agents exist before starting ===
  const validatedIds: string[] = [];
  for (const agentId of participantIds) {
    const agent = getAgent(agentId);
    if (agent) {
      validatedIds.push(agentId);
    }
  }
  // Auto-reinforce: if validated < requested, create missing agents to fill the gap
  const deficit = participantIds.length - validatedIds.length;
  if (deficit > 0) {
    const agents = listAgents();
    const usedIds = new Set(validatedIds);
    for (let i = 0; i < deficit; i++) {
      // Try to find an existing idle agent not already participating
      const spare = agents.find(a => a.state === 'idle' && !usedIds.has(a.id));
      if (spare) {
        validatedIds.push(spare.id);
        usedIds.add(spare.id);
      } else {
        // Create a new PM agent as fallback reinforcement
        const created = createAgent(`보강-PM-${Date.now()}-${i}`, 'pm', 'claude-opus-4-6' as any);
        validatedIds.push(created.id);
        usedIds.add(created.id);
      }
    }
  }

  const meeting = createMeeting(title, description, 'planning', validatedIds, character);
  let startedContributions = 0;

  for (const agentId of validatedIds) {
    const agent = getAgent(agentId);
    if (!agent) continue; // should not happen after validation

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

## 필수 출력 형식 (반드시 따르세요)

### 후보 목록
반드시 3~5개의 구체적인 후보/아이디어를 제시하세요. 각 후보는 아래 형식을 따르세요:

[CANDIDATE] 후보명: (한줄 설명 및 근거)

예시:
[CANDIDATE] 실시간 협업 에디터: 구글 독스 대안으로 WebSocket 기반 실시간 편집 기능 — 기존 SaaS 대비 자체 호스팅 차별화
[CANDIDATE] AI 코드 리뷰 봇: PR 자동 분석 도구 — 개발자 피로도 감소, API 연동 용이

### 다양성 규칙 (엄격)
- 최근 회의에서 이미 논의된 주제("AI Office" 등)와 동일/유사한 후보는 반드시 피하세요
- 각 후보는 서로 다른 도메인/카테고리에서 도출하세요 (중복 금지)
- "무난한" 후보보다 참신하고 구체적인 후보를 우선하세요

### 분석
후보 목록 제시 후, ${roleInfo.label} 관점에서 각 후보에 대한 간략한 분석을 작성하세요.

"제안서"나 "proposal" 형식으로 작성하지 마세요. 회의에서 발언하듯이 자연스럽게 분석과 의견을 직접 공유해주세요.

반드시 한국어로 응답하세요.`;

    // Force-reset agent to idle before starting to avoid FSM conflicts
    try { resetAgent(agentId); } catch { /* ignore */ }
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

  // Hard check: if started contributions < validated participants, log warning
  if (startedContributions < validatedIds.length) {
    console.warn(`[meeting] Participant deficit: requested=${participantIds.length}, validated=${validatedIds.length}, started=${startedContributions} for meeting ${meeting.id}`);
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
  if (meeting.sourceMeetingId || meeting.character === 'review' || meeting.type === 'review') {
    const { report, decisionPacket } = buildReviewScoringReport(meeting);
    meeting.report = report;
    meeting.decisionPacket = decisionPacket;
  } else {
    meeting.report = generateConsolidatedReport(meeting);
  }
  saveMeeting(meeting);
}

/**
 * Generate a consolidated meeting report combining all agent perspectives.
 */
function extractCandidateScoreFromText(content: string, candidateName: string): number | null {
  const escaped = candidateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escaped}[^\\d]*(\\d+)\\s*/\\s*10`, 'i'),
    new RegExp(`${escaped}[^\\d]*(\\d{1,2})\\s*점`, 'i'),
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) return Math.max(1, Math.min(10, n));
    }
  }
  return null;
}

function buildReviewDecisionPacket(meeting: Meeting): DecisionPacket | null {
  if (!meeting.sourceCandidates || meeting.sourceCandidates.length === 0) return null;
  if (!meeting.proposals || meeting.proposals.length === 0) return null;

  const reviewerScoreCards: import('@ai-office/shared').ReviewerScoreCard[] = meeting.proposals.map((proposal) => ({
    reviewerName: proposal.agentName,
    reviewerRole: 'reviewer',
    scores: meeting.sourceCandidates!.map((candidate) => ({
      candidateName: candidate.name,
      score: extractCandidateScoreFromText(proposal.content, candidate.name) ?? 7,
      weight: 1,
      rationale: `${proposal.agentName} 평가 기반`,
    })),
  }));

  const totals = new Map<string, number>();
  for (const c of meeting.sourceCandidates) totals.set(c.name, 0);
  for (const card of reviewerScoreCards) {
    for (const s of card.scores) totals.set(s.candidateName, (totals.get(s.candidateName) || 0) + s.score * s.weight);
  }

  const ranked = [...totals.entries()]
    .map(([name, total]) => ({
      name,
      total,
      avg: reviewerScoreCards.length > 0 ? total / reviewerScoreCards.length : 0,
      summary: meeting.sourceCandidates!.find(c => c.name === name)?.summary || '',
    }))
    .sort((a, b) => b.avg - a.avg);

  if (ranked.length === 0) return null;

  return {
    reviewerScoreCards,
    recommendation: { name: ranked[0].name, summary: ranked[0].summary, score: Number(ranked[0].avg.toFixed(2)) },
    alternatives: ranked.slice(1, 3).map(r => ({ name: r.name, summary: r.summary, score: Number(r.avg.toFixed(2)) })),
    status: 'pending',
  };
}

export function buildReviewScoringReport(meeting: Meeting): { report: string; decisionPacket: DecisionPacket | null } {
  const packet = buildReviewDecisionPacket(meeting);
  if (!meeting.sourceCandidates || meeting.sourceCandidates.length === 0 || !packet) {
    return {
      report: [
        '# 리뷰 점수화 결과',
        '',
        '⚠️ sourceCandidates가 없어 점수화 미팅을 생성할 수 없습니다.',
        '기획/브레인스토밍 미팅에서 후보를 먼저 생성한 뒤, "리뷰어 점수화 시작"을 사용해주세요.',
      ].join('\n'),
      decisionPacket: null,
    };
  }

  // NOTE: 점수표는 markdown table 대신 decisionPacket(JSON) 기반 UI 컴포넌트에서 렌더한다.
  // report는 의사결정 요약 텍스트만 유지한다.
  const rec = packet.recommendation;
  const alts = packet.alternatives;

  const report = [
    `# ${meeting.title} 점수화 결과`,
    '',
    '## 결과 요약',
    `- 후보 수: ${meeting.sourceCandidates.length}`,
    `- 리뷰어 수: ${packet.reviewerScoreCards.length}`,
    '- 후보별 점수표/총점/추천안/대안은 구조화 데이터 기반 UI에서 제공합니다.',
    '',
    '## 1순위 추천',
    `- ${rec.name} (평균 ${Number(rec.score || 0).toFixed(2)})`,
    `- 이유: 다수 리뷰어 점수 기준 총점이 가장 높고, 실행 가능성과 임팩트 균형이 우수합니다.`,
    '',
    '## 대안 1~2',
    ...(alts.length > 0
      ? alts.map((a, i) => `${i + 1}. ${a.name} (평균 ${Number(a.score || 0).toFixed(2)})`)
      : ['- 없음']),
    '',
    '## 의사결정 요청',
    '- 이 추천안으로 확정할까요, 아니면 기준/가중치를 수정할까요?',
  ].join('\n');

  return { report, decisionPacket: packet };
}

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
  const requestedCount = meeting.participants?.length || meeting.proposals.length;
  report += `${requestedCount}명의 전문가가 각자의 관점에서 "${meeting.title}" 주제를 분석했습니다. `;
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

  // Parse structured [CANDIDATE] tags from all proposals
  const candidateMap = new Map<string, { name: string; summary: string; count: number }>();
  const candidateRegex = /\[CANDIDATE\]\s*(.+?):\s*(.+)/gi;

  for (const proposal of meeting.proposals) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(candidateRegex.source, candidateRegex.flags);
    while ((match = regex.exec(proposal.content)) !== null) {
      const name = match[1].trim();
      const summary = match[2].trim().slice(0, 800);
      const existing = candidateMap.get(name);
      if (existing) {
        existing.count++;
      } else {
        candidateMap.set(name, { name, summary, count: 1 });
      }
    }
  }

  // If structured candidates found, use them (deduplicated)
  if (candidateMap.size > 0) {
    return [...candidateMap.values()].map(c => ({
      name: c.name,
      summary: c.summary,
      score: undefined,
      rationale: undefined,
    }));
  }

  // Fallback: legacy behavior (one candidate per agent)
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
    const candidateNames = candidates.map(c => c.name);
    const prompt = `당신은 ${agent.name}, 전문 리뷰어입니다.

"${sourceMeeting.title}" 기획 회의에서 도출된 후보들을 점수화해주세요.

## 평가 대상 후보 (${candidates.length}건)
${candidatesSummary}

## ⚠️ 중요 규칙
- 반드시 위 후보 ${candidates.length}건 각각에 대해서만 평가하세요
- 후보와 무관한 일반론, 담론, 시장 분석 등은 작성하지 마세요
- 모든 후보에 대해 빠짐없이 [SCORE] 태그를 출력하세요
- 후보 이름은 위 목록의 이름을 정확히 사용하세요

## 필수 출력 형식 (이 형식을 반드시 따르세요)

### 점수표

각 후보에 대해 아래 5개 항목을 1-10점으로 채점하세요:
- 문제 정의(Problem): 해결하려는 문제의 명확성과 크기
- 실현 가능성(Feasibility): 현재 리소스로 구현 가능한 정도
- 차별성(Differentiation): 기존 대비 독창성
- 데모 속도(Time-to-Demo): MVP까지 걸리는 시간 (빠를수록 높은 점수)
- 리스크(Risk): 리스크가 낮을수록 높은 점수

**반드시 아래 형식으로 모든 ${candidates.length}개 후보를 출력하세요 (하나도 빠뜨리지 마세요):**

${candidateNames.map(name => `[SCORE] ${name} | Problem: ?/10 | Feasibility: ?/10 | Differentiation: ?/10 | Time-to-Demo: ?/10 | Risk: ?/10 | Total: ?/50`).join('\n')}

### 최종 추천

[RECOMMENDATION] 1순위: (후보명) | 이유: (한 줄) | 실행조건: (한 줄) | Kill Criteria: (한 줄)
[ALTERNATIVE] 2순위: (후보명) | 이유: (한 줄)

### 후보별 한줄 평가

각 후보에 대해 한 줄로 핵심 장단점을 작성하세요. 일반론은 금지입니다.

반드시 한국어로 응답하세요. [SCORE], [RECOMMENDATION], [ALTERNATIVE] 태그는 반드시 포함하세요.`;

    // Force-reset agent to idle before starting to avoid FSM conflicts
    try { resetAgent(agentId); } catch { /* ignore */ }
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
