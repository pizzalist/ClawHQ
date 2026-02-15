import { v4 as uuid } from 'uuid';
import type { Agent, AgentRole, AgentModel, AgentState, AppEvent } from '@ai-office/shared';
import { STATE_TRANSITIONS } from '@ai-office/shared';
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
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listAgents(): Agent[] {
  return (stmts.listAgents.all() as Record<string, unknown>[]).map(rowToAgent);
}

export function getAgent(id: string): Agent | null {
  const row = stmts.getAgent.get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function createAgent(name: string, role: AgentRole, model: AgentModel): Agent {
  const id = uuid();
  const count = (stmts.countAgents.get() as { count: number }).count;
  stmts.insertAgent.run(id, name, role, model, count);
  const agent = getAgent(id)!;
  emitEvent('agent_created', id, null, `Agent "${name}" created as ${role}`);
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
  // Can't delete a working agent
  if (agent.state === 'working') throw new Error('Cannot delete a working agent — stop it first');
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
