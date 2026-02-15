import { v4 as uuid } from 'uuid';
import type { AgentRole, AgentModel, ChiefChatMessage, ChiefAction, ChiefResponse, Meeting, TeamPlanSuggestion } from '@ai-office/shared';
import { listAgents, createAgent, getAgent } from './agent-manager.js';
import { listTasks, createTask } from './task-queue.js';
import { listMeetings, startPlanningMeeting } from './meetings.js';
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

// Callbacks for async chief responses (set by index.ts)
type ChiefResponseCallback = (sessionId: string, response: ChiefResponse) => void;
let responseCallback: ChiefResponseCallback | null = null;
export function onChiefResponse(cb: ChiefResponseCallback) { responseCallback = cb; }

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
  return `당신은 AI 오피스의 총괄자(Chief)입니다. 한국어로 응답하세요.

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

## 지침
- 사용자의 요청을 분석하고, 적절한 팀 구성과 작업 계획을 **제안**하세요
- 제안의 이유를 자연스럽게 설명하세요
- ACTION 블록은 반드시 응답에 포함하세요 — 사용자가 확인 후 승인합니다
- 불확실한 경우 사용자에게 질문하세요
- 이미 있는 에이전트를 활용할 수 있으면 새로 만들지 마세요`;
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

  return {
    executedActions,
    state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
  };
}

/** Reject / discard a pending proposal */
export function rejectProposal(messageId: string): void {
  pendingProposals.delete(messageId);
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

        const reply = cleanText || '처리가 완료되었습니다.';
        pushMessage(sessionId, { id: messageId, role: 'chief', content: reply, createdAt: new Date().toISOString() });

        // Store proposed actions for approval — do NOT execute yet
        if (proposedActions.length > 0) {
          pendingProposals.set(messageId, proposedActions);
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
