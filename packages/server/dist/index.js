import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SERVER_PORT } from '@ai-office/shared';
import { checkOpenClaw, isDemoMode, listSessions } from './openclaw-adapter.js';
import { listAgents, createAgent, deleteAgent, resetAgent, seedDemoAgents, onEvent } from './agent-manager.js';
import { listTasks, createTask, listEvents, onTaskEvent, processQueue, stopAgentTask } from './task-queue.js';
import { stmts } from './db.js';
const app = express();
app.use(cors());
app.use(express.json());
// Serve built web app when available (faster than tunneling Vite dev server)
const webDistPath = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
}
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
// Broadcast to all connected clients
function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}
// Forward events to WebSocket clients
onEvent((event) => {
    broadcast({ type: 'event', payload: event });
    broadcast({ type: 'agents_update', payload: listAgents() });
});
onTaskEvent((event) => {
    broadcast({ type: 'event', payload: event });
    broadcast({ type: 'tasks_update', payload: listTasks() });
    broadcast({ type: 'agents_update', payload: listAgents() });
});
// WebSocket connection
wss.on('connection', (ws) => {
    console.log('[ws] Client connected');
    const initial = {
        agents: listAgents(),
        tasks: listTasks(),
        events: listEvents(),
    };
    ws.send(JSON.stringify({ type: 'initial_state', payload: initial }));
    ws.on('close', () => console.log('[ws] Client disconnected'));
});
// REST API
app.get('/api/agents', (_req, res) => {
    res.json(listAgents());
});
app.post('/api/agents', (req, res) => {
    const { name, role, model } = req.body;
    if (!name || !role || !model) {
        return res.status(400).json({ error: 'name, role, and model are required' });
    }
    try {
        const agent = createAgent(name, role, model);
        res.status(201).json(agent);
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.get('/api/tasks', (req, res) => {
    const { assigneeId } = req.query;
    const tasks = listTasks();
    if (typeof assigneeId === 'string') {
        return res.json(tasks.filter((t) => t.assigneeId === assigneeId));
    }
    res.json(tasks);
});
app.post('/api/tasks', (req, res) => {
    const { title, description, assigneeId } = req.body;
    if (!title) {
        return res.status(400).json({ error: 'title is required' });
    }
    try {
        const task = createTask(title, description || '', assigneeId || null);
        res.status(201).json(task);
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
// Agent control endpoints
app.post('/api/agents/:id/stop', (req, res) => {
    try {
        stopAgentTask(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post('/api/agents/:id/reset', (req, res) => {
    try {
        const agent = resetAgent(req.params.id);
        res.json(agent);
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.delete('/api/agents/:id', (req, res) => {
    try {
        deleteAgent(req.params.id);
        broadcast({ type: 'agents_update', payload: listAgents() });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.get('/api/events', (_req, res) => {
    res.json(listEvents());
});
// Stats & Failures
app.get('/api/stats', (_req, res) => {
    const counts = stmts.taskCounts.get();
    const avgRow = stmts.avgCompletionTime.get();
    const perAgent = stmts.perAgentStats.all().map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        role: r.agent_role,
        completed: r.completed || 0,
        failed: r.failed || 0,
        avgTimeMs: r.avg_time_ms || 0,
    }));
    const total = counts.total || 0;
    const completed = counts.completed || 0;
    const failed = counts.failed || 0;
    res.json({
        total,
        completed,
        failed,
        pending: counts.pending || 0,
        inProgress: counts.in_progress || 0,
        avgCompletionMs: avgRow.avg_ms || 0,
        successRate: total > 0 ? (completed / total) * 100 : 0,
        perAgent,
    });
});
app.get('/api/failures', (_req, res) => {
    const rows = stmts.failedTasks.all();
    res.json(rows.map((r) => ({
        taskId: r.task_id,
        title: r.title,
        description: r.description,
        agentId: r.assignee_id,
        agentName: r.agent_name,
        agentRole: r.agent_role,
        error: r.error || 'Unknown error',
        failedAt: r.failed_at,
    })));
});
// Health check
app.get('/api/health', async (_req, res) => {
    const sessions = await listSessions();
    res.json({
        status: 'ok',
        demoMode: isDemoMode(),
        agents: listAgents().length,
        tasks: listTasks().length,
        activeSessions: sessions.length,
    });
});
// Retry queue processing
app.post('/api/tasks/process', (_req, res) => {
    processQueue();
    res.json({ ok: true });
});
// SPA fallback for built frontend
if (existsSync(webDistPath)) {
    app.get('*', (_req, res) => {
        res.sendFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)));
    });
}
// Start
async function main() {
    await checkOpenClaw();
    seedDemoAgents();
    server.listen(SERVER_PORT, () => {
        console.log(`[server] AI Office server running on http://localhost:${SERVER_PORT}`);
        console.log(`[server] WebSocket available at ws://localhost:${SERVER_PORT}/ws`);
    });
}
main().catch(console.error);
