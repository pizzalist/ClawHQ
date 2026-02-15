import { v4 as uuid } from 'uuid';
import { MAX_CONCURRENT_TASKS } from '@ai-office/shared';
import { stmts } from './db.js';
import { listAgents, getAgent, transitionAgent } from './agent-manager.js';
import { spawnAgentSession, parseAgentOutput, cleanupRun } from './openclaw-adapter.js';
const listeners = [];
export function onTaskEvent(fn) {
    listeners.push(fn);
}
function emitTaskEvent(type, agentId, taskId, message) {
    const event = {
        id: uuid(),
        type,
        agentId,
        taskId,
        message,
        metadata: {},
        createdAt: new Date().toISOString(),
    };
    stmts.insertEvent.run(event.id, event.type, event.agentId, event.taskId, event.message, '{}');
    for (const fn of listeners)
        fn(event);
}
function rowToTask(row) {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        assigneeId: row.assignee_id ?? null,
        status: row.status,
        result: row.result ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listTasks() {
    return stmts.listTasks.all().map(rowToTask);
}
export function createTask(title, description) {
    const id = uuid();
    stmts.insertTask.run(id, title, description);
    emitTaskEvent('task_created', null, id, `Task created: ${title}`);
    // Schedule queue processing async so the response returns immediately
    setTimeout(() => processQueue(), 100);
    return rowToTask(stmts.getTask.get(id));
}
/**
 * Process the task queue: assign pending tasks to idle agents.
 * For real mode, spawns OpenClaw agent sessions.
 * For demo mode, uses simulated timers.
 */
export function processQueue() {
    const activeCount = stmts.activeTasks.get().count;
    if (activeCount >= MAX_CONCURRENT_TASKS)
        return;
    const pending = stmts.pendingTasks.all();
    if (pending.length === 0)
        return;
    const idleAgents = listAgents().filter(a => a.state === 'idle');
    if (idleAgents.length === 0)
        return;
    const slots = Math.min(MAX_CONCURRENT_TASKS - activeCount, pending.length, idleAgents.length);
    for (let i = 0; i < slots; i++) {
        const task = rowToTask(pending[i]);
        const agent = idleAgents[i];
        assignTask(agent.id, task);
    }
}
function assignTask(agentId, task) {
    const agent = getAgent(agentId);
    if (!agent)
        return;
    const sessionId = `ai-office-${agent.name.toLowerCase()}-${task.id.slice(0, 8)}-${Date.now()}`;
    // Mark task in-progress and agent working
    stmts.updateTask.run(agent.id, 'in-progress', null, task.id);
    transitionAgent(agent.id, 'working', task.id, sessionId);
    emitTaskEvent('task_assigned', agent.id, task.id, `Task "${task.title}" assigned to ${agent.name}`);
    const prompt = buildPrompt(agent.name, agent.role, task);
    spawnAgentSession({
        sessionId,
        agentName: agent.name,
        role: agent.role,
        model: agent.model,
        prompt,
        onComplete: (run) => handleRunComplete(agent.id, task.id, task.title, run),
    });
}
function buildPrompt(name, role, task) {
    return [
        `You are ${name}, a ${role} in the AI Office.`,
        `Complete this task concisely and report what you did.`,
        ``,
        `## Task: ${task.title}`,
        task.description ? `\n${task.description}` : '',
        ``,
        `Respond with a clear summary of what you accomplished.`,
    ].join('\n');
}
function handleRunComplete(agentId, taskId, title, run) {
    try {
        const success = run.exitCode === 0;
        const result = success
            ? parseAgentOutput(run.stdout)
            : `Error (exit ${run.exitCode}): ${run.stderr.slice(0, 2000) || run.stdout.slice(0, 2000) || 'Unknown error'}`;
        if (success) {
            // working → reviewing → done → idle
            try {
                transitionAgent(agentId, 'reviewing', taskId);
            }
            catch { /* skip if invalid */ }
            emitTaskEvent('message', agentId, taskId, `${getAgent(agentId)?.name ?? 'Agent'} is reviewing results...`);
            setTimeout(() => {
                try {
                    transitionAgent(agentId, 'done', taskId);
                    stmts.updateTask.run(agentId, 'completed', result, taskId);
                    emitTaskEvent('task_completed', agentId, taskId, `Task "${title}" completed`);
                    // Return to idle after brief pause
                    setTimeout(() => {
                        try {
                            transitionAgent(agentId, 'idle', null, null);
                            cleanupRun(run.sessionId);
                            processQueue(); // pick up next task
                        }
                        catch { /* already transitioned */ }
                    }, 2000);
                }
                catch { /* already transitioned */ }
            }, 1500);
        }
        else {
            transitionAgent(agentId, 'error', taskId);
            stmts.updateTask.run(agentId, 'failed', result, taskId);
            emitTaskEvent('task_failed', agentId, taskId, `Task "${title}" failed: ${result.slice(0, 200)}`);
            // Recover to idle after delay
            setTimeout(() => {
                try {
                    transitionAgent(agentId, 'idle', null, null);
                    cleanupRun(run.sessionId);
                    processQueue();
                }
                catch { /* already transitioned */ }
            }, 5000);
        }
    }
    catch (err) {
        console.error(`[task-queue] Error handling completion for task ${taskId}:`, err);
    }
}
export function listEvents() {
    return stmts.listEvents.all().map(row => ({
        id: row.id,
        type: row.type,
        agentId: row.agent_id ?? null,
        taskId: row.task_id ?? null,
        message: row.message,
        metadata: JSON.parse(row.metadata || '{}'),
        createdAt: row.created_at,
    }));
}
