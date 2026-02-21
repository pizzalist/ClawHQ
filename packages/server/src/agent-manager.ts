import { v4 as uuid } from 'uuid';
import type { Agent, AgentRole, AgentModel, AgentState, AppEvent } from '@clawhq/shared';
import { STATE_TRANSITIONS } from '@clawhq/shared';
import { stmts } from './db.js';

type Listener = (event: AppEvent) => void;
const listeners: Listener[] = [];

export function onEvent(fn: Listener) {
  listeners.push(fn);
}

function emit(event: AppEvent) {
  for (const fn of listeners) fn(event);
}

function emitEvent(type: AppEvent['type'], agentId: string | null, taskId: string | null, message: string, metadata: Record<string, unknown> = {}) {
  const event: AppEvent = {
    id: uuid(),
    type,
    agentId,
    taskId,
    message,
    metadata,
    createdAt: new Date().toISOString(),
  };
  stmts.insertEvent.run(event.id, event.type, event.agentId, event.taskId, event.message, JSON.stringify(event.metadata));
  emit(event);
  return event;
}

/** Well-known QC/test agent name patterns */
const TEST_AGENT_PATTERN = /(?:^|[-_\s])(qc|test|debug)(?:$|[-_\s])/i;

const FRIENDLY_ROLE_PREFIX: Record<AgentRole, string> = {
  pm: 'PM',
  developer: 'DEV',
  reviewer: 'REV',
  designer: 'DES',
  devops: 'OPS',
  qa: 'QA',
};

function isTestAgentName(name: string): boolean {
  return TEST_AGENT_PATTERN.test(name);
}

export function suggestFriendlyAgentName(role: AgentRole): string {
  const all = (stmts.listAgents.all() as Record<string, unknown>[])
    .map((r) => (r.name as string) || '')
    .filter(Boolean);
  const prefix = FRIENDLY_ROLE_PREFIX[role] || role.toUpperCase();
  const used = new Set<number>();
  const re = new RegExp(`^${prefix}-(\\d{2})$`, 'i');
  for (const n of all) {
    const m = n.match(re);
    if (m) used.add(parseInt(m[1], 10));
  }
  let idx = 1;
  while (used.has(idx)) idx += 1;
  return `${prefix}-${String(idx).padStart(2, '0')}`;
}

function normalizeAgentName(name: string, role: AgentRole, isTest = false): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return suggestFriendlyAgentName(role);
  if (!isTest && isTestAgentName(trimmed)) return suggestFriendlyAgentName(role);
  return trimmed;
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as AgentRole,
    model: row.model as AgentModel,
    state: row.state as AgentState,
    currentTaskId: (row.current_task_id as string) ?? null,
    sessionId: (row.session_id as string) ?? null,
    deskIndex: row.desk_index as number,
    isTest: !!(row.is_test as number) || isTestAgentName(row.name as string), // keep legacy name-based hiding
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listAgents(includeTest = false): Agent[] {
  const all = (stmts.listAgents.all() as Record<string, unknown>[]).map(rowToAgent);
  if (includeTest) return all;
  return all.filter(a => !a.isTest);
}

/** List only test/QC agents */
export function listTestAgents(): Agent[] {
  return (stmts.listAgents.all() as Record<string, unknown>[]).map(rowToAgent).filter(a => a.isTest);
}

/** Delete all test/QC agents that are not currently working */
export function cleanupTestAgents(): { deleted: number; skipped: number } {
  const testAgents = listTestAgents();
  let deleted = 0;
  let skipped = 0;
  for (const a of testAgents) {
    if (a.state === 'working') { skipped++; continue; }
    try {
      stmts.unlinkAgentTasks.run(a.id);
      stmts.deleteAgent.run(a.id);
      deleted++;
    } catch { skipped++; }
  }
  if (deleted > 0) {
    emitEvent('agent_created', null, null, `테스트 에이전트 ${deleted}개 정리됨`);
  }
  return { deleted, skipped };
}

export function getAgent(id: string): Agent | null {
  const row = stmts.getAgent.get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function createAgent(name: string, role: AgentRole, model: AgentModel, isTest?: boolean): Agent {
  const id = uuid();
  const count = (stmts.countAgents.get() as { count: number }).count;
  const safeName = normalizeAgentName(name, role, !!isTest);
  stmts.insertAgent.run(id, safeName, role, model, count);
  // Test visibility is controlled by explicit flag only.
  if (isTest) {
    stmts.markAgentTest.run(1, id);
  }
  const agent = getAgent(id)!;
  emitEvent('agent_created', id, null, `Agent "${safeName}" created as ${role}`);
  return agent;
}

export function transitionAgent(id: string, newState: AgentState, taskId?: string | null, sessionId?: string | null): Agent {
  const agent = getAgent(id);
  if (!agent) throw new Error(`Agent ${id} not found`);

  const allowed = STATE_TRANSITIONS[agent.state];
  if (!allowed.includes(newState)) {
    throw new Error(`Invalid transition: ${agent.state} → ${newState}`);
  }

  stmts.updateAgentState.run(
    newState,
    taskId !== undefined ? taskId : agent.currentTaskId,
    sessionId !== undefined ? sessionId : agent.sessionId,
    id,
  );

  emitEvent('agent_state_changed', id, taskId ?? agent.currentTaskId, `${agent.name}: ${agent.state} → ${newState}`);
  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  const agent = getAgent(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  if (agent.state === 'working') throw new Error('Cannot delete a working agent — stop it first');
  // Unlink tasks referencing this agent so FK constraint doesn't block delete
  stmts.unlinkAgentTasks.run(id);
  stmts.deleteAgent.run(id);
  emitEvent('agent_created', id, null, `Agent "${agent.name}" removed`);
}

export function resetAgent(id: string): Agent {
  const agent = getAgent(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  stmts.updateAgentState.run('idle', null, null, id);
  emitEvent('agent_state_changed', id, null, `${agent.name}: force reset → idle`);
  return getAgent(id)!;
}

export function deleteAllAgents(): void {
  const agents = listAgents();
  const working = agents.filter(a => a.state === 'working');
  if (working.length > 0) throw new Error('Cannot clear team while agents are working');
  stmts.deleteAllAgents.run();
  emitEvent('agent_created', null, null, 'All agents removed (team reset)');
}

// Seed demo agents if DB is empty
export function seedDemoAgents() {
  const count = (stmts.countAgents.get() as { count: number }).count;
  if (count > 0) return;

  const demos: Array<[string, AgentRole, AgentModel]> = [
    ['Alice', 'pm', 'claude-opus-4-6'],
    ['Bob', 'developer', 'claude-sonnet-4'],
    ['Charlie', 'developer', 'openai-codex/o3'],
    ['Diana', 'reviewer', 'claude-opus-4-6'],
    ['Eve', 'designer', 'claude-sonnet-4'],
    ['Frank', 'devops', 'openai-codex/gpt-5.3-codex'],
  ];

  for (const [name, role, model] of demos) {
    createAgent(name, role, model);
  }
  console.log('[agent-manager] Seeded 6 demo agents');
}
