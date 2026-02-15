import { v4 as uuid } from 'uuid';
import { MAX_CONCURRENT_TASKS, CHAIN_NEXT_ROLE, CHAIN_STEP_LABELS } from '@ai-office/shared';
import { stmts } from './db.js';
import { listAgents, getAgent, transitionAgent, resetAgent } from './agent-manager.js';
import { spawnAgentSession, parseAgentOutput, cleanupRun, killAgentRun } from './openclaw-adapter.js';
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
        parentTaskId: row.parent_task_id ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listTasks() {
    return stmts.listTasks.all().map(rowToTask);
}
export function createTask(title, description, assigneeId, parentTaskId) {
    const id = uuid();
    stmts.insertTask.run(id, title, description, parentTaskId || null);
    // If specific assignee requested, set it on the task
    if (assigneeId) {
        stmts.updateTask.run(assigneeId, 'pending', null, id);
    }
    emitTaskEvent('task_created', assigneeId || null, id, `Task created: ${title}`);
    // Schedule queue processing async so the response returns immediately
    setTimeout(() => processQueue(), 100);
    return rowToTask(stmts.getTask.get(id));
}
export function stopAgentTask(agentId) {
    const agent = getAgent(agentId);
    if (!agent)
        throw new Error(`Agent ${agentId} not found`);
    if (agent.state !== 'working')
        throw new Error(`Agent is not working (state: ${agent.state})`);
    // Kill the running session
    if (agent.sessionId) {
        killAgentRun(agent.sessionId);
        cleanupRun(agent.sessionId);
    }
    // Cancel the task
    if (agent.currentTaskId) {
        stmts.updateTask.run(agentId, 'cancelled', 'Stopped by user', agent.currentTaskId);
        emitTaskEvent('task_failed', agentId, agent.currentTaskId, `Task stopped by user`);
    }
    // Reset agent to idle
    resetAgent(agentId);
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
    const pending = stmts.pendingTasks.all().map(rowToTask);
    if (pending.length === 0)
        return;
    const idleAgents = listAgents().filter(a => a.state === 'idle');
    if (idleAgents.length === 0)
        return;
    let slotsLeft = MAX_CONCURRENT_TASKS - activeCount;
    const usedAgents = new Set();
    for (const task of pending) {
        if (slotsLeft <= 0)
            break;
        // If task has a preferred assignee, try them first
        let agent;
        if (task.assigneeId) {
            agent = idleAgents.find(a => a.id === task.assigneeId && !usedAgents.has(a.id));
            if (!agent)
                continue; // preferred agent not idle, skip for now
        }
        else {
            agent = idleAgents.find(a => !usedAgents.has(a.id));
            if (!agent)
                break;
        }
        usedAgents.add(agent.id);
        assignTask(agent.id, task);
        slotsLeft--;
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
                    // Auto-chain: spawn next step based on agent role
                    spawnChainFollowUp(agentId, taskId, title, result);
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
function spawnChainFollowUp(agentId, taskId, title, result) {
    try {
        const agent = getAgent(agentId);
        if (!agent)
            return;
        const nextRole = CHAIN_NEXT_ROLE[agent.role];
        if (!nextRole)
            return; // No next step (e.g. reviewer is terminal)
        // Find an agent with the next role
        const nextAgentRow = stmts.findAgentByRole.get(nextRole);
        if (!nextAgentRow)
            return; // No agent with that role exists
        const nextAgentId = nextAgentRow.id;
        const nextAgentName = nextAgentRow.name;
        const stepLabel = CHAIN_STEP_LABELS[nextRole] || nextRole;
        const prevStepLabel = CHAIN_STEP_LABELS[agent.role] || agent.role;
        const chainTitle = `[${stepLabel}] ${title}`;
        const chainDesc = `Auto-chained from ${agent.name}'s ${prevStepLabel} step.\n\nPrevious result:\n${result.slice(0, 1000)}`;
        const newTask = createTask(chainTitle, chainDesc, nextAgentId, taskId);
        emitTaskEvent('chain_spawned', nextAgentId, newTask.id, `🔗 Chain: ${agent.name} (${prevStepLabel}) → ${nextAgentName} (${stepLabel})`);
    }
    catch (err) {
        console.error('[task-queue] Chain follow-up error:', err);
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
