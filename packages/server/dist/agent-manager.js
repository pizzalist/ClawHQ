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
/** Well-known QC/test agent name patterns */
const TEST_AGENT_PATTERN = /^(pm|dev|developer|reviewer|designer|devops|qa)[-_]?(qc|test|debug)/i;
function isTestAgentName(name) {
    return TEST_AGENT_PATTERN.test(name);
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
        isTest: !!row.is_test || isTestAgentName(row.name),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listAgents(includeTest = false) {
    const all = stmts.listAgents.all().map(rowToAgent);
    if (includeTest)
        return all;
    return all.filter(a => !a.isTest);
}
/** List only test/QC agents */
export function listTestAgents() {
    return stmts.listAgents.all().map(rowToAgent).filter(a => a.isTest);
}
/** Delete all test/QC agents that are not currently working */
export function cleanupTestAgents() {
    const testAgents = listTestAgents();
    let deleted = 0;
    let skipped = 0;
    for (const a of testAgents) {
        if (a.state === 'working') {
            skipped++;
            continue;
        }
        try {
            stmts.unlinkAgentTasks.run(a.id);
            stmts.deleteAgent.run(a.id);
            deleted++;
        }
        catch {
            skipped++;
        }
    }
    if (deleted > 0) {
        emitEvent('agent_created', null, null, `테스트 에이전트 ${deleted}개 정리됨`);
    }
    return { deleted, skipped };
}
export function getAgent(id) {
    const row = stmts.getAgent.get(id);
    return row ? rowToAgent(row) : null;
}
export function createAgent(name, role, model, isTest) {
    const id = uuid();
    const count = stmts.countAgents.get().count;
    stmts.insertAgent.run(id, name, role, model, count);
    // Mark as test if explicitly flagged or name matches QC pattern
    if (isTest || isTestAgentName(name)) {
        stmts.markAgentTest.run(1, id);
    }
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
export function deleteAgent(id) {
    const agent = getAgent(id);
    if (!agent)
        throw new Error(`Agent ${id} not found`);
    if (agent.state === 'working')
        throw new Error('Cannot delete a working agent — stop it first');
    // Unlink tasks referencing this agent so FK constraint doesn't block delete
    stmts.unlinkAgentTasks.run(id);
    stmts.deleteAgent.run(id);
    emitEvent('agent_created', id, null, `Agent "${agent.name}" removed`);
}
export function resetAgent(id) {
    const agent = getAgent(id);
    if (!agent)
        throw new Error(`Agent ${id} not found`);
    stmts.updateAgentState.run('idle', null, null, id);
    emitEvent('agent_state_changed', id, null, `${agent.name}: force reset → idle`);
    return getAgent(id);
}
export function deleteAllAgents() {
    const agents = listAgents();
    const working = agents.filter(a => a.state === 'working');
    if (working.length > 0)
        throw new Error('Cannot clear team while agents are working');
    stmts.deleteAllAgents.run();
    emitEvent('agent_created', null, null, 'All agents removed (team reset)');
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
