import { v4 as uuid } from 'uuid';
import { STATE_TRANSITIONS } from '@ai-office/shared';
import { stmts } from './db.js';
const listeners = [];
export function onEvent(fn) {
    listeners.push(fn);
}
function emit(event) {
    for (const fn of listeners)
        fn(event);
}
function emitEvent(type, agentId, taskId, message, metadata = {}) {
    const event = {
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
function rowToAgent(row) {
    return {
        id: row.id,
        name: row.name,
        role: row.role,
        model: row.model,
        state: row.state,
        currentTaskId: row.current_task_id ?? null,
        sessionId: row.session_id ?? null,
        deskIndex: row.desk_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listAgents() {
    return stmts.listAgents.all().map(rowToAgent);
}
export function getAgent(id) {
    const row = stmts.getAgent.get(id);
    return row ? rowToAgent(row) : null;
}
export function createAgent(name, role, model) {
    const id = uuid();
    const count = stmts.countAgents.get().count;
    stmts.insertAgent.run(id, name, role, model, count);
    const agent = getAgent(id);
    emitEvent('agent_created', id, null, `Agent "${name}" created as ${role}`);
    return agent;
}
export function transitionAgent(id, newState, taskId, sessionId) {
    const agent = getAgent(id);
    if (!agent)
        throw new Error(`Agent ${id} not found`);
    const allowed = STATE_TRANSITIONS[agent.state];
    if (!allowed.includes(newState)) {
        throw new Error(`Invalid transition: ${agent.state} → ${newState}`);
    }
    stmts.updateAgentState.run(newState, taskId !== undefined ? taskId : agent.currentTaskId, sessionId !== undefined ? sessionId : agent.sessionId, id);
    emitEvent('agent_state_changed', id, taskId ?? agent.currentTaskId, `${agent.name}: ${agent.state} → ${newState}`);
    return getAgent(id);
}
// Seed demo agents if DB is empty
export function seedDemoAgents() {
    const count = stmts.countAgents.get().count;
    if (count > 0)
        return;
    const demos = [
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
