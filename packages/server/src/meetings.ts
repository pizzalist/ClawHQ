import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingType, MeetingCharacter, MeetingProposal, MeetingCandidate, DecisionPacket } from '@clawhq/shared';
import { stmts } from './db.js';
import { getAgent, listAgents, transitionAgent, resetAgent, createAgent } from './agent-manager.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, type AgentRun } from './openclaw-adapter.js';

type RoleInfo = { label: string; focus: string };
type Lang = 'en' | 'ko';

function getRoleFocus(lang: Lang): Record<string, RoleInfo> {
  if (lang === 'en') {
    return {
      pm: { label: 'PM', focus: 'Strategy, priorities, execution plan, resource allocation, scheduling' },
      developer: { label: 'Developer', focus: 'Technical analysis, feasibility, tech stack, technical risks, architecture' },
      reviewer: { label: 'Reviewer', focus: 'Quality, risks, improvements, blind spots, potential issues' },
      designer: { label: 'Designer', focus: 'UX/UI, user perspective, design direction, usability' },
      devops: { label: 'DevOps', focus: 'Infrastructure, deployment, operations, monitoring, scalability' },
      qa: { label: 'QA', focus: 'Test strategy, stability, edge cases, quality assurance' },
    };
  }
  return {
    pm: { label: 'PM', focus: '전략, 우선순위, 실행계획, 리소스 배분, 일정 관리' },
    developer: { label: '개발자', focus: '기술적 분석, 구현 가능성, 기술 스택, 기술 리스크, 아키텍처' },
    reviewer: { label: '리뷰어', focus: '품질, 리스크, 개선점, 놓친 부분, 잠재적 문제' },
    designer: { label: '디자이너', focus: 'UX/UI, 사용자 관점, 디자인 방향, 사용성' },
    devops: { label: 'DevOps', focus: '인프라, 배포, 운영, 모니터링, 확장성' },
    qa: { label: 'QA', focus: '테스트 전략, 안정성, 엣지케이스, 품질 보증' },
  };
}

function buildMeetingPrompt(agentName: string, roleInfo: RoleInfo, title: string, description: string, character: MeetingCharacter, lang: Lang = 'ko'): string {
  if (lang === 'en') {
    return buildMeetingPromptEN(agentName, roleInfo, title, description, character);
  }
  return buildMeetingPromptKO(agentName, roleInfo, title, description, character);
}

function buildMeetingPromptEN(agentName: string, roleInfo: RoleInfo, title: string, description: string, character: MeetingCharacter): string {
  const header = `You are ${agentName}, the team's ${roleInfo.label} at AI Office.\n\nThe team is holding a meeting on the following topic:\n\n## "${title}"\n\n${description}\n\nShare your expert analysis and opinions from the ${roleInfo.label} perspective.\n\nAreas to focus on:\n- ${roleInfo.focus}\n`;

  const PROMPTS: Record<string, string> = {
    brainstorm: `## Required Output Format (must follow)

### Candidate List
Present 3–5 specific candidates/ideas. Each candidate must follow this format:

[CANDIDATE] Candidate Name: (one-line description and rationale)

### Diversity Rules (strict)
- Each candidate must come from a different domain/category (no duplicates)
- Prefer novel, specific candidates over "safe" ones

### Analysis
After listing candidates, write a brief analysis of each from the ${roleInfo.label} perspective.`,

    planning: (() => {
      const roleTasks: Record<string, string> = {
        PM: `### PM Scope\n- Project goals and scope definition\n- Feature requirements list (with priorities)\n- MVP scope and milestone timeline\n- Stakeholders and success metrics`,
        Developer: `### Developer Scope\n- Tech stack selection and rationale\n- System architecture design (component diagram)\n- Key API endpoint design\n- Data model draft\n- Technical risks and alternatives`,
        Reviewer: `### Reviewer Scope\n- Code quality standards and review checklist\n- Potential risks and bottleneck analysis\n- Security/performance considerations\n- Test strategy proposal`,
        Designer: `### Designer Scope\n- UX flows and key screen layouts\n- Design system/component inventory\n- Usability considerations\n- Accessibility requirements`,
        DevOps: `### DevOps Scope\n- Infrastructure setup and deployment strategy\n- CI/CD pipeline design\n- Monitoring/logging plan\n- Scaling strategy`,
        QA: `### QA Scope\n- Test strategy (unit/integration/E2E)\n- Key test case scenarios\n- Quality criteria and acceptance conditions\n- Automation scope`,
      };
      const roleSection = roleTasks[roleInfo.label] || `### ${roleInfo.label} Scope\n- Write detailed specs from the ${roleInfo.focus} perspective`;
      return `## Required Output Format — Planning/Specification (do NOT propose candidates!)

This meeting is about writing a **detailed plan/development spec** for an already-decided topic.
Do not propose new candidates. Do not use [CANDIDATE] tags.

${roleSection}

Structure the spec using markdown ## sections.
Be specific and actionable — detailed enough to start development immediately, not vague direction-setting.`;
    })(),

    kickoff: `## Required Output Format — Project Kickoff

### Project Goals & Vision
- Problem the project solves
- Definition of success

### Team Roles & Responsibilities
- Each role's scope

### Timeline & Milestones
- Key milestones and expected dates
- Dependencies and bottlenecks

### Success Criteria & KPIs
- Measurable success metrics
- Monitoring approach`,

    architecture: `## Required Output Format — Technical Architecture Design

### System Architecture
- Overall system structure (component roles)
- Data flow

### Tech Stack Selection
- Technology choices per layer with rationale
- Alternative comparison

### DB Schema Design
- Core entities and relationships
- Indexing strategy

### API Design
- Key endpoints
- Auth/authorization approach

### Infrastructure & Deployment
- Deployment environment
- CI/CD pipeline
- Monitoring/logging`,

    design: `## Required Output Format — UI/UX Design

### User Personas
- Target user definitions

### Core User Flows
- User journey per key scenario

### Screen Layout
- Layout and components per key screen
- Navigation structure

### Design System
- Color/typography/component guide
- Responsive strategy`,

    'sprint-planning': `## Required Output Format — Sprint Planning

### Sprint Goal
- Core objectives for this sprint

### Backlog Priorities
- Task list (by priority)
- Story points/effort estimate per task

### Task Assignment
- Tasks assigned per team member

### Risks & Dependencies
- Potential blockers
- External dependencies`,

    estimation: `## Required Output Format — Effort/Resource Estimation

### Per-Feature Effort Estimate
- Expected effort per feature/module (in person-days)

### Timeline Estimate
- Optimistic / realistic / pessimistic scenarios

### Resource Requirements
- Required personnel and roles
- External resources (APIs, services, etc.)

### Risk Buffer
- Uncertainty factors
- Recommended buffer ratio`,

    demo: `## Required Output Format — Demo/Presentation Review

### Demo Item Evaluation
- Completeness assessment per demo item
- Achievement rate vs. goals

### Feedback
- What went well
- Areas needing improvement

### Next Steps
- Priority fixes
- Goals for next demo`,

    postmortem: `## Required Output Format — Postmortem (Incident/Failure Analysis)

### Incident Timeline
- Chronological record from occurrence to resolution

### Root Cause Analysis
- Direct cause
- Root cause (5 Whys)

### Impact Scope
- Impact on users/systems

### Prevention Measures
- Short-term fixes
- Long-term improvements
- Monitoring enhancements`,

    'code-review': `## Required Output Format — Code Review

### Code Quality
- Readability, structure, naming assessment
- SOLID principles compliance

### Security
- Potential security vulnerabilities

### Performance
- Performance issues or optimization opportunities

### Improvement Suggestions
- Specific refactoring proposals
- Test coverage opinions`,

    daily: `## Required Output Format — Daily Standup

### Completed Yesterday
- Key completed items

### Today's Plan
- Planned work items

### Blockers/Issues
- Problems blocking progress
- Areas needing help`,

    retrospective: `## Required Output Format — Retrospective

### What Went Well (Keep)
- Things to continue doing

### What to Improve (Problem)
- What was problematic or inefficient

### What to Try (Try)
- Improvements to try next time
- Specific action items`,

    review: `## Required Output Format — Review/Evaluation

Rate each candidate on these criteria (1–10):
- Feasibility
- Impact/Value
- Risk

[SCORE] Candidate Name: (score) — (one-line evaluation)`,
  };

  const body = PROMPTS[character] || PROMPTS.brainstorm;
  return `${header}\n${body}\n\nRespond in English.`;
}

function buildMeetingPromptKO(agentName: string, roleInfo: RoleInfo, title: string, description: string, character: MeetingCharacter): string {
  const header = `당신은 ${agentName}, AI 오피스 팀의 ${roleInfo.label}입니다.\n\n팀이 다음 주제에 대해 회의를 진행하고 있습니다:\n\n## "${title}"\n\n${description}\n\n${roleInfo.label} 관점에서 전문적인 분석과 의견을 공유해주세요.\n\n집중해야 할 영역:\n- ${roleInfo.focus}\n`;

  const PROMPTS: Record<string, string> = {
    brainstorm: `## 필수 출력 형식 (반드시 따르세요)

### 후보 목록
반드시 3~5개의 구체적인 후보/아이디어를 제시하세요. 각 후보는 아래 형식을 따르세요:

[CANDIDATE] 후보명: (한줄 설명 및 근거)

### 다양성 규칙 (엄격)
- 각 후보는 서로 다른 도메인/카테고리에서 도출하세요 (중복 금지)
- "무난한" 후보보다 참신하고 구체적인 후보를 우선하세요

### 분석
후보 목록 제시 후, ${roleInfo.label} 관점에서 각 후보에 대한 간략한 분석을 작성하세요.`,

    planning: (() => {
      const roleTasks: Record<string, string> = {
        PM: `### PM 담당 영역\n- 프로젝트 목표 및 범위 정의\n- 기능 요구사항 목록 (우선순위 포함)\n- MVP 범위 및 마일스톤 타임라인\n- 이해관계자 및 성공 지표`,
        '개발': `### 개발 담당 영역\n- 기술 스택 선정 및 근거\n- 시스템 아키텍처 설계 (컴포넌트 다이어그램)\n- API 설계 주요 엔드포인트\n- 데이터 모델 초안\n- 기술적 리스크 및 대안`,
        '리뷰어': `### 리뷰어 담당 영역\n- 코드 품질 기준 및 리뷰 체크리스트\n- 잠재적 리스크 및 병목 분석\n- 보안/성능 고려사항\n- 테스트 전략 제안`,
        '디자이너': `### 디자이너 담당 영역\n- UX 플로우 및 주요 화면 구성\n- 디자인 시스템/컴포넌트 목록\n- 사용성 고려사항\n- 접근성 요구사항`,
        DevOps: `### DevOps 담당 영역\n- 인프라 구성 및 배포 전략\n- CI/CD 파이프라인 설계\n- 모니터링/로깅 계획\n- 스케일링 전략`,
        QA: `### QA 담당 영역\n- 테스트 전략 (단위/통합/E2E)\n- 테스트 케이스 주요 시나리오\n- 품질 기준 및 수용 조건\n- 자동화 범위`,
      };
      const roleSection = roleTasks[roleInfo.label] || `### ${roleInfo.label} 담당 영역\n- ${roleInfo.focus} 관점에서 구체적 명세 작성`;
      return `## 필수 출력 형식 — 기획/명세서 (후보 제안 금지!)

이 회의는 이미 결정된 주제에 대한 **구체적 기획서/개발 명세서**를 작성하는 회의입니다.
새로운 후보를 제안하지 마세요. [CANDIDATE] 태그를 사용하지 마세요.

${roleSection}

마크다운 ## 섹션 형식으로 구조화된 명세서를 작성하세요.
구체적이고 실행 가능한 수준으로 작성하세요. 모호한 방향 제시가 아닌, 바로 개발에 착수할 수 있는 수준의 상세함이 필요합니다.`;
    })(),

    kickoff: `## 필수 출력 형식 — 프로젝트 킥오프

### 프로젝트 목표 및 비전
- 프로젝트가 해결하는 문제
- 성공의 정의

### 팀 역할 및 책임
- 각 역할별 담당 영역

### 일정 및 마일스톤
- 주요 마일스톤과 예상 일정
- 의존성 및 병목 지점

### 성공 기준 및 KPI
- 측정 가능한 성공 지표
- 모니터링 방법`,

    architecture: `## 필수 출력 형식 — 기술 아키텍처 설계

### 시스템 아키텍처
- 전체 시스템 구조 (컴포넌트별 역할)
- 데이터 흐름

### 기술 스택 선정
- 각 레이어별 기술 선택과 근거
- 대안 비교

### DB 스키마 설계
- 핵심 엔티티와 관계
- 인덱싱 전략

### API 설계
- 주요 엔드포인트
- 인증/인가 방식

### 인프라 및 배포
- 배포 환경
- CI/CD 파이프라인
- 모니터링/로깅`,

    design: `## 필수 출력 형식 — UI/UX 설계

### 사용자 페르소나
- 주요 타겟 사용자 정의

### 핵심 사용자 플로우
- 주요 시나리오별 사용자 여정

### 화면 구성
- 주요 화면별 레이아웃과 구성 요소
- 네비게이션 구조

### 디자인 시스템
- 컬러/타이포그래피/컴포넌트 가이드
- 반응형 전략`,

    'sprint-planning': `## 필수 출력 형식 — 스프린트 계획

### 스프린트 목표
- 이번 스프린트에서 달성할 핵심 목표

### 백로그 우선순위
- 태스크 목록 (우선순위순)
- 각 태스크별 스토리포인트/공수 추정

### 태스크 배분
- 팀원별 담당 태스크

### 리스크 및 의존성
- 블로커 가능성
- 외부 의존성`,

    estimation: `## 필수 출력 형식 — 공수/리소스 산정

### 기능별 공수 산정
- 각 기능/모듈별 예상 공수 (인일 기준)

### 일정 추정
- 낙관적 / 현실적 / 비관적 시나리오

### 리소스 요구사항
- 필요 인력 및 역할
- 외부 리소스 (API, 서비스 등)

### 리스크 버퍼
- 불확실성 요인
- 권장 버퍼 비율`,

    demo: `## 필수 출력 형식 — 데모/시연 리뷰

### 시연 항목 평가
- 각 시연 항목별 완성도 평가
- 목표 대비 달성률

### 피드백
- 잘된 점
- 개선이 필요한 부분

### 다음 스텝
- 우선 수정 사항
- 다음 데모까지 목표`,

    postmortem: `## 필수 출력 형식 — 포스트모템 (장애/실패 분석)

### 사건 타임라인
- 발생 시점부터 해결까지 시간순 기록

### 근본 원인 분석
- 직접 원인
- 근본 원인 (5 Whys)

### 영향 범위
- 사용자/시스템에 미친 영향

### 재발 방지 대책
- 단기 조치
- 장기 개선안
- 모니터링 강화`,

    'code-review': `## 필수 출력 형식 — 코드 리뷰

### 코드 품질
- 가독성, 구조, 네이밍 평가
- SOLID 원칙 준수 여부

### 보안
- 잠재적 보안 취약점

### 성능
- 성능 이슈 또는 최적화 포인트

### 개선 제안
- 구체적 리팩토링 제안
- 테스트 커버리지 의견`,

    daily: `## 필수 출력 형식 — 데일리 스탠드업

### 어제 완료한 일
- 주요 완료 항목

### 오늘 할 일
- 계획된 작업 목록

### 블로커/이슈
- 진행을 막는 문제
- 도움이 필요한 사항`,

    retrospective: `## 필수 출력 형식 — 회고

### 잘된 점 (Keep)
- 계속 유지할 것들

### 개선할 점 (Problem)
- 문제가 됐거나 비효율적이었던 것

### 시도할 것 (Try)
- 다음에 시도해볼 개선안
- 구체적 액션 아이템`,

    review: `## 필수 출력 형식 — 리뷰/평가

각 후보에 대해 아래 기준으로 1~10점 평가하세요:
- 실행 가능성
- 임팩트/가치
- 리스크

[SCORE] 후보명: (점수) — (한줄 평가)`,
  };

  const body = PROMPTS[character] || PROMPTS.brainstorm;
  return `${header}\n${body}\n\n반드시 한국어로 응답하세요.`;
}

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
// Track language per meeting for finalization
const meetingLangMap = new Map<string, Lang>();

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

/** Role-specific focus areas for meeting contributions (kept for backward compat) */
const ROLE_FOCUS: Record<string, { label: string; focus: string }> = getRoleFocus('ko');


/**
 * Start a collaborative planning meeting.
 * Each agent contributes their expert perspective on the topic (NOT a competing proposal).
 * When all contributions are in, a consolidated report is generated.
 */
export function startPlanningMeeting(title: string, description: string, participantIds: string[], character?: MeetingCharacter, lang: Lang = 'ko'): Meeting {
  console.log(`[meeting] startPlanningMeeting: requested ${participantIds.length} participants:`, participantIds);
  // === Hard participant count check: validate ALL agents exist before starting ===
  const validatedIds: string[] = [];
  for (const agentId of participantIds) {
    const agent = getAgent(agentId);
    if (agent) {
      validatedIds.push(agentId);
    } else {
      console.warn(`[meeting] Agent not found, skipping: ${agentId}`);
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

  console.log(`[meeting] After validation+reinforcement: ${validatedIds.length} participants:`, validatedIds);
  const meeting = createMeeting(title, description, 'planning', validatedIds, character);
  let startedContributions = 0;

  for (const agentId of validatedIds) {
    const agent = getAgent(agentId);
    if (!agent) continue; // should not happen after validation

    const roleFocus = getRoleFocus(lang);
    const roleInfo = roleFocus[agent.role] || { label: agent.role, focus: lang === 'en' ? 'General analysis' : '전반적인 분석' };
    const sessionId = `meeting-${meeting.id.slice(0, 8)}-${agent.name.toLowerCase()}-${Date.now()}`;

    const prompt = buildMeetingPrompt(agent.name, roleInfo, title, description, character || 'planning', lang);

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
  meetingLangMap.set(meeting.id, lang);
  if (startedContributions === 0) {
    pendingContributions.delete(meeting.id);
    finalizeMeeting(meeting.id, lang);
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
      const lang = meetingLangMap.get(meetingId) || 'ko';
      meetingLangMap.delete(meetingId);
      finalizeMeeting(meetingId, lang);
    }
  }
}

/**
 * Finalize meeting: generate a consolidated report from all contributions.
 * No review phase, no winner selection — just a unified summary.
 */
function finalizeMeeting(meetingId: string, lang: Lang = 'ko') {
  const meeting = getMeeting(meetingId);
  if (!meeting) return;

  meeting.status = 'completed';
  if (meeting.sourceMeetingId || meeting.character === 'review' || meeting.type === 'review') {
    const { report, decisionPacket } = buildReviewScoringReport(meeting, lang);
    meeting.report = report;
    meeting.decisionPacket = decisionPacket;
  } else {
    meeting.report = generateConsolidatedReport(meeting, lang);
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

  const reviewerScoreCards: import('@clawhq/shared').ReviewerScoreCard[] = meeting.proposals.map((proposal) => ({
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

export function buildReviewScoringReport(meeting: Meeting, lang: Lang = 'ko'): { report: string; decisionPacket: DecisionPacket | null } {
  const packet = buildReviewDecisionPacket(meeting);
  if (!meeting.sourceCandidates || meeting.sourceCandidates.length === 0 || !packet) {
    return {
      report: lang === 'en'
        ? [
            '# Review Scoring Results',
            '',
            '⚠️ No sourceCandidates found — cannot create a scoring meeting.',
            'Please generate candidates in a planning/brainstorming meeting first, then use "Start reviewer scoring".',
          ].join('\n')
        : [
            '# 리뷰 점수화 결과',
            '',
            '⚠️ sourceCandidates가 없어 점수화 미팅을 생성할 수 없습니다.',
            '기획/브레인스토밍 미팅에서 후보를 먼저 생성한 뒤, "리뷰어 점수화 시작"을 사용해주세요.',
          ].join('\n'),
      decisionPacket: null,
    };
  }

  const rec = packet.recommendation;
  const alts = packet.alternatives;

  const report = lang === 'en'
    ? [
        `# ${meeting.title} Scoring Results`,
        '',
        '## Summary',
        `- Candidates: ${meeting.sourceCandidates.length}`,
        `- Reviewers: ${packet.reviewerScoreCards.length}`,
        '- Per-candidate scorecards, totals, recommendations, and alternatives are rendered via structured data UI.',
        '',
        '## Top Recommendation',
        `- ${rec.name} (avg ${Number(rec.score || 0).toFixed(2)})`,
        `- Reason: Highest total score across reviewers, with a strong balance of feasibility and impact.`,
        '',
        '## Alternatives',
        ...(alts.length > 0
          ? alts.map((a, i) => `${i + 1}. ${a.name} (avg ${Number(a.score || 0).toFixed(2)})`)
          : ['- None']),
        '',
        '## Decision Request',
        '- Shall we finalize this recommendation, or adjust the criteria/weights?',
      ].join('\n')
    : [
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

function generateConsolidatedReport(meeting: Meeting, lang: Lang = 'ko'): string {
  const agents = listAgents();
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const roleFocus = getRoleFocus(lang);

  if (lang === 'en') {
    const date = new Date().toLocaleDateString('en-US');
    const charLabels: Record<string, string> = {
      brainstorm: '🧠 Brainstorm',
      planning: '📋 Planning Meeting',
      review: '🔍 Review Meeting',
      retrospective: '🔄 Retrospective',
    };
    const charLabel = meeting.character ? (charLabels[meeting.character] || meeting.character) : meeting.type;

    const participantLines = meeting.proposals.map(p => {
      const agent = agentMap.get(p.agentId);
      const roleInfo = roleFocus[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
      return `- ${p.agentName} (${roleInfo.label}): ${roleInfo.focus.split(',')[0].trim()} perspective`;
    }).join('\n');

    const perspectiveSections = meeting.proposals.map(p => {
      const agent = agentMap.get(p.agentId);
      const roleInfo = roleFocus[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
      const summary = p.content.length > 600
        ? p.content.slice(0, 600).replace(/\n*$/, '') + '...'
        : p.content;
      return `### ${roleInfo.label} Perspective (${p.agentName})\n\n${summary}`;
    }).join('\n\n');

    const requestedCount = meeting.participants?.length || meeting.proposals.length;
    let report = `# ${meeting.title} Meeting Results\n\n`;
    report += `**Type:** ${charLabel} | **Date:** ${date}\n\n`;
    report += `## Participants\n${participantLines}\n\n`;
    report += `## Agenda\n\n${meeting.description || '(No description)'}\n\n`;
    report += `## Key Discussion Points\n\n${perspectiveSections}\n\n`;
    report += `## Summary\n\n`;
    report += `${requestedCount} experts analyzed "${meeting.title}" from their respective perspectives. `;
    report += `Please decide on the next steps based on the above.\n`;
    return report;
  }

  // Korean (original)
  const date = new Date().toLocaleDateString('ko-KR');
  const charLabels: Record<string, string> = {
    brainstorm: '🧠 자유 토론',
    planning: '📋 기획 회의',
    review: '🔍 검토 회의',
    retrospective: '🔄 회고',
  };
  const charLabel = meeting.character ? (charLabels[meeting.character] || meeting.character) : meeting.type;

  const participantLines = meeting.proposals.map(p => {
    const agent = agentMap.get(p.agentId);
    const roleInfo = roleFocus[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
    return `- ${p.agentName} (${roleInfo.label}): ${roleInfo.focus.split(',')[0].trim()} 관점`;
  }).join('\n');

  const perspectiveSections = meeting.proposals.map(p => {
    const agent = agentMap.get(p.agentId);
    const roleInfo = roleFocus[agent?.role || ''] || { label: agent?.role || '?', focus: '' };
    const summary = p.content.length > 600
      ? p.content.slice(0, 600).replace(/\n*$/, '') + '...'
      : p.content;
    return `### ${roleInfo.label} 관점 (${p.agentName})\n\n${summary}`;
  }).join('\n\n');

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
  // Supports: [CANDIDATE] Name: desc, [CANDIDATE] Name — desc, [CANDIDATE] **Name**: desc, [CANDIDATE] **Name** — desc
  const candidateMap = new Map<string, { name: string; summary: string; count: number }>();
  // Match [CANDIDATE] **Name (with hyphens allowed)**: summary
  // Use lookahead for the separator: first **: or **: or — or – after the name
  const candidateRegex = /\[CANDIDATE\]\s*\*{0,2}([^*\n]+?)\*{0,2}\s*(?:\*{0,2}\s*[:\—\–]|:\s)\s*(.+)/gi;

  for (const proposal of meeting.proposals) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(candidateRegex.source, candidateRegex.flags);
    while ((match = regex.exec(proposal.content)) !== null) {
      const name = match[1].trim().replace(/^\*+|\*+$/g, ''); // strip leftover bold markers
      const summary = match[2].trim().slice(0, 800);
      if (!name || name.length > 200) continue; // sanity check
      const existing = candidateMap.get(name);
      if (existing) {
        existing.count++;
      } else {
        candidateMap.set(name, { name, summary, count: 1 });
      }
    }
  }

  // Only allow explicit structured candidates.
  // If no [CANDIDATE] tags were provided, treat this meeting as synthesis-only.
  // (Prevents forced "후보 평가" on discussions that produced no comparable options.)
  if (candidateMap.size === 0) return [];

  return [...candidateMap.values()].map(c => ({
    name: c.name,
    summary: c.summary,
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
  lang: Lang = 'ko',
): Meeting | null {
  const sourceMeeting = getMeeting(sourceMeetingId);
  if (!sourceMeeting || sourceMeeting.status !== 'completed') return null;

  const candidates = extractCandidatesFromMeeting(sourceMeetingId);
  if (candidates.length < 2) return null;

  const meeting = createMeeting(
    title,
    lang === 'en'
      ? `Evaluating candidates based on the "${sourceMeeting.title}" meeting results.`
      : `"${sourceMeeting.title}" 회의 결과를 기반으로 후보를 평가합니다.`,
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
    const scoreLines = candidateNames.map(name => `[SCORE] ${name} | Problem: ?/10 | Feasibility: ?/10 | Differentiation: ?/10 | Time-to-Demo: ?/10 | Risk: ?/10 | Total: ?/50`).join('\n');

    const prompt = lang === 'en'
      ? `You are ${agent.name}, an expert reviewer.

Please score the candidates from the "${sourceMeeting.title}" planning meeting.

## Candidates to Evaluate (${candidates.length})
${candidatesSummary}

## ⚠️ Important Rules
- Evaluate ONLY the ${candidates.length} candidates listed above
- Do not write general commentary, market analysis, or anything unrelated to the candidates
- Output a [SCORE] tag for every candidate without exception
- Use the exact candidate names from the list above

## Required Output Format (must follow exactly)

### Scorecard

Rate each candidate on these 5 criteria (1–10):
- Problem: Clarity and magnitude of the problem being solved
- Feasibility: How achievable with current resources
- Differentiation: Originality compared to existing solutions
- Time-to-Demo: Time to MVP (faster = higher score)
- Risk: Lower risk = higher score

**Output ALL ${candidates.length} candidates in this exact format (do not skip any):**

${scoreLines}

### Final Recommendation

[RECOMMENDATION] #1: (candidate name) | Reason: (one line) | Preconditions: (one line) | Kill Criteria: (one line)
[ALTERNATIVE] #2: (candidate name) | Reason: (one line)

### One-Line Assessment Per Candidate

Write one line per candidate covering key pros and cons. No generalities.

Respond in English. You MUST include [SCORE], [RECOMMENDATION], and [ALTERNATIVE] tags.`
      : `당신은 ${agent.name}, 전문 리뷰어입니다.

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

${scoreLines}

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
  meetingLangMap.set(meeting.id, lang);
  if (startedContributions === 0) {
    pendingContributions.delete(meeting.id);
    finalizeMeeting(meeting.id, lang);
  }

  return meeting;
}

/**
 * Get child meetings that reference a parent meeting.
 */
export function getChildMeetings(parentMeetingId: string): Meeting[] {
  return listMeetings(true).filter(m => m.parentMeetingId === parentMeetingId || m.sourceMeetingId === parentMeetingId);
}

export function deleteMeeting(meetingId: string): boolean {
  const meeting = getMeeting(meetingId);
  if (!meeting) return false;
  stmts.deleteMeetingById.run(meetingId);
  emitChange();
  return true;
}

export function deleteAllMeetings(): number {
  const meetings = listMeetings(true);
  for (const m of meetings) {
    stmts.deleteMeetingById.run(m.id);
  }
  if (meetings.length > 0) emitChange();
  return meetings.length;
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
