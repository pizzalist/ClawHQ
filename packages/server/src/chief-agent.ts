import type { AgentRole, ChiefChatMessage, Meeting, TeamPlanSuggestion } from '@ai-office/shared';
import { listAgents, createAgent } from './agent-manager.js';
import { listTasks } from './task-queue.js';
import { listMeetings } from './meetings.js';

const MAX_HISTORY = 50;
const MAX_COUNT_PER_ROLE = 5;
const MAX_TOTAL_ADDITIONAL = 10;

const DEFAULT_MODEL_BY_ROLE: Record<AgentRole, 'claude-opus-4-6' | 'claude-sonnet-4' | 'openai-codex/o3' | 'openai-codex/gpt-5.3-codex'> = {
  pm: 'claude-opus-4-6',
  developer: 'openai-codex/gpt-5.3-codex',
  reviewer: 'claude-opus-4-6',
  designer: 'claude-sonnet-4',
  devops: 'openai-codex/o3',
  qa: 'claude-sonnet-4',
};

const sessionMessages = new Map<string, ChiefChatMessage[]>();

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

export function summarizeOfficeState(): string {
  const agents = listAgents();
  const tasks = listTasks();
  const meetings = listMeetings();

  const idle = agents.filter((a) => a.state === 'idle').length;
  const working = agents.filter((a) => a.state === 'working' || a.state === 'reviewing').length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const activeTasks = tasks.filter((t) => t.status === 'in-progress').length;
  const activeMeetings = meetings.filter((m: Meeting) => m.status !== 'completed').length;

  return `현재 인력 ${agents.length}명(가용 ${idle}, 작업중 ${working}), 작업 ${tasks.length}건(대기 ${pendingTasks}, 진행 ${activeTasks}), 미팅 ${meetings.length}건(활성 ${activeMeetings})입니다.`;
}

/** Role aliases for Korean/English parsing */
const ROLE_ALIASES: Record<string, AgentRole> = {
  pm: 'pm', 'project manager': 'pm', '피엠': 'pm', '기획': 'pm', '기획자': 'pm', '매니저': 'pm',
  dev: 'developer', developer: 'developer', '개발': 'developer', '개발자': 'developer', '프론트': 'developer', '백엔드': 'developer',
  '리뷰어': 'reviewer', '코드리뷰': 'reviewer', reviewer: 'reviewer', review: 'reviewer', '리뷰': 'reviewer', '검토': 'reviewer',
  designer: 'designer', design: 'designer', '디자이너': 'designer', '디자인': 'designer',
  devops: 'devops', '데브옵스': 'devops', '인프라': 'devops', '운영': 'devops',
  qa: 'qa', '큐에이': 'qa', '테스터': 'qa', '테스트': 'qa', '품질': 'qa',
};

/**
 * Parse explicit role+count requests from user text.
 * Supports patterns like: "pm 2명", "리뷰어3명", "developer 1", "pm2 리뷰어3"
 */
function parseExplicitRoleCounts(text: string): Record<AgentRole, number> | null {
  const result: Partial<Record<AgentRole, number>> = {};
  let found = false;

  // Sort aliases by length descending to match longer aliases first (e.g. "리뷰어" before "리뷰")
  const sortedAliases = Object.entries(ROLE_ALIASES).sort((a, b) => b[0].length - a[0].length);

  // Pattern: role name followed by number (with optional 명/명으로/명으로)
  // e.g. "pm 2명", "pm2명", "리뷰어 3명", "developer 1"
  for (const [alias, role] of sortedAliases) {
    // Escaped alias for regex
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s*(\\d+)\\s*명?`, 'i'),
      new RegExp(`(\\d+)\\s*명?\\s*의?\\s*${escaped}`, 'i'),
    ];
    if (result[role] !== undefined) continue; // Already matched this role via another alias
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const count = parseInt(match[1], 10);
        if (count > 0) {
          result[role] = count;
          found = true;
          break;
        }
      }
    }
  }

  if (!found) return null;

  // Deduplicate: return only roles with counts
  const plan: Record<AgentRole, number> = { pm: 0, developer: 0, reviewer: 0, designer: 0, devops: 0, qa: 0 };
  for (const [role, count] of Object.entries(result)) {
    plan[role as AgentRole] = Math.max(plan[role as AgentRole], count);
  }
  return plan;
}

export function generatePlanFromPrompt(userText: string): TeamPlanSuggestion[] {
  const text = userText.toLowerCase();

  // First: try to parse explicit role+count requests
  const explicit = parseExplicitRoleCounts(text);
  if (explicit) {
    return clampSuggestions(
      (Object.keys(explicit) as AgentRole[])
        .filter(role => explicit[role] > 0)
        .map(role => ({ role, count: explicit[role] }))
    );
  }

  // Fallback: keyword-based heuristic
  const plan: Record<AgentRole, number> = {
    pm: 1,
    developer: 2,
    reviewer: 1,
    designer: 0,
    devops: 0,
    qa: 0,
  };

  if (/(긴급|빠르|즉시|asap|hotfix|급함)/i.test(text)) {
    plan.pm += 1;
    plan.developer += 1;
  }

  if (/(디자인|ui|ux|브랜딩|랜딩)/i.test(text)) {
    plan.designer += 1;
  }

  if (/(배포|인프라|운영|devops|서버|클라우드)/i.test(text)) {
    plan.devops += 1;
  }

  if (/(qa|테스트|품질|검증|안정성)/i.test(text)) {
    plan.qa += 1;
    plan.reviewer += 1;
  }

  if (/(간단|작은|소규모|빠른 확인|프로토타입)/i.test(text)) {
    plan.developer = Math.max(1, plan.developer - 1);
    plan.pm = Math.max(1, plan.pm - 1);
  }

  return clampSuggestions(
    (Object.keys(plan) as AgentRole[]).map((role) => ({ role, count: plan[role] }))
  );
}

export function getChiefMessages(sessionId: string): ChiefChatMessage[] {
  return [...getSessionMessages(sessionId)];
}

export function chatWithChief(sessionId: string, userMessage: string) {
  const now = new Date().toISOString();
  pushMessage(sessionId, {
    id: `user-${Date.now()}`,
    role: 'user',
    content: userMessage,
    createdAt: now,
  });

  const stateSummary = summarizeOfficeState();
  const suggestions = generatePlanFromPrompt(userMessage);
  const suggestionText = suggestions.length > 0
    ? suggestions.map((s) => `${s.role} ${s.count}명`).join(', ')
    : '현재 추가 편성 없이 진행 가능';

  // Check if user explicitly requested specific composition
  const isExplicitRequest = parseExplicitRoleCounts(userMessage) !== null;

  const reply = isExplicitRequest
    ? [
        `상황 보고: ${stateSummary}`,
        `요청 편성: ${suggestionText}`,
        '요청하신 구성으로 팀을 생성할까요? 승인하시면 바로 적용합니다.',
      ].join('\n\n')
    : [
        `상황 보고: ${stateSummary}`,
        `제안 편성: ${suggestionText}`,
        '이 구성으로 팀을 생성할까요? 승인하시면 바로 적용하고, 이어서 킥오프 미팅까지 시작할 수 있습니다.',
      ].join('\n\n');

  pushMessage(sessionId, {
    id: `chief-${Date.now()}`,
    role: 'chief',
    content: reply,
    createdAt: new Date().toISOString(),
  });

  return {
    reply,
    suggestions,
    messages: getChiefMessages(sessionId),
  };
}

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
