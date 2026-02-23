import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SERVER_PORT } from '@clawhq/shared';
import type { WSMessage, InitialState, TeamPlanSuggestion } from '@clawhq/shared';
import { checkOpenClaw, isDemoMode, listSessions } from './openclaw-adapter.js';
import { TEAM_PRESETS } from '@clawhq/shared';
import { listAgents, createAgent, deleteAgent, deleteAllAgents, resetAgent, seedDemoAgents, onEvent, getAgent, listTestAgents, cleanupTestAgents } from './agent-manager.js';
import { listTasks, createTask, listEvents, onTaskEvent, processQueue, stopAgentTask, getChainChildren, findRootTask, spawnChainFollowUp, syncRootTaskStates } from './task-queue.js';
import { suggestChainPlan, getChainPlan, getChainPlanForTask, listActiveChainPlans, listAllChainPlans, editChainPlan, setChainAutoExecute, confirmChainPlan, advanceChainPlan, cancelChainPlan, markChainRunning, onChainPlanChange, resetChainPlanState } from './chain-plan.js';
import { listDeliverablesByTask, getDeliverable, renderDeliverable, createDeliverablesFromResult, validateWebDeliverable } from './deliverables.js';
import { listMeetings, getMeeting, startPlanningMeeting, decideMeeting, onMeetingChange, cleanupLegacyMeetings, startReviewMeetingFromSource, extractCandidatesFromMeeting, getChildMeetings } from './meetings.js';
import { startTechSpecMeeting, suggestTechSpecAgents, rerunTechSpecRole, getTechSpecData, onTechSpecChange } from './tech-spec-meeting.js';
import { chatWithChief, applyChiefPlan, getChiefMessages, onChiefResponse, approveProposal, rejectProposal, onChiefCheckIn, onChiefNotification, handleChiefAction, chiefHandleTaskEvent, chiefHandleMeetingChange, respondToCheckIn, resetChiefState } from './chief-agent.js';
import { stmts } from './db.js';
import { commitDeliverable, commitTaskDeliverables, getCommitLog } from './git-commit.js';
import { getMockAlerts, getMockMetrics, getMockTimeSeries, getMonitoringSchemaSample, resetMonitoringState, unresetMonitoringState } from './monitoring-mock.js';

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
function broadcast(msg: WSMessage) {
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

onMeetingChange(() => {
  broadcast({ type: 'meetings_update', payload: listMeetings() });
  chiefHandleMeetingChange();
});

onTechSpecChange(() => {
  broadcast({ type: 'meetings_update', payload: listMeetings() });
});

// Forward chief LLM responses to WebSocket clients
onChiefResponse((_sessionId, response) => {
  broadcast({ type: 'chief_response', payload: response });
  broadcast({ type: 'agents_update', payload: listAgents() });
  broadcast({ type: 'tasks_update', payload: listTasks() });
  broadcast({ type: 'meetings_update', payload: listMeetings() });
});

// Forward chief proactive check-ins to WebSocket clients
onChiefCheckIn((checkIn) => {
  broadcast({ type: 'chief_checkin', payload: checkIn });
});

// Forward chief notifications (task/meeting results with inline actions)
onChiefNotification((notification) => {
  broadcast({ type: 'chief_notification', payload: notification });
});

onChainPlanChange((plan) => {
  broadcast({ type: 'chain_plan_update', payload: plan });
});

onTaskEvent((event) => {
  broadcast({ type: 'event', payload: event });
  broadcast({ type: 'tasks_update', payload: listTasks() });
  broadcast({ type: 'agents_update', payload: listAgents() });
  // Chief monitors task events for proactive check-ins
  chiefHandleTaskEvent(event);
});

// WebSocket ping/pong heartbeat — terminate unresponsive clients
const WS_PING_INTERVAL = 30_000;
const wsAliveMap = new WeakMap<WebSocket, boolean>();

const pingInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (wsAliveMap.get(client) === false) {
      console.log('[ws] Terminating unresponsive client');
      client.terminate();
      continue;
    }
    wsAliveMap.set(client, false);
    client.ping();
  }
}, WS_PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('[ws] Client connected');
  wsAliveMap.set(ws, true);
  ws.on('pong', () => wsAliveMap.set(ws, true));

  const initial: InitialState = {
    agents: listAgents(),
    tasks: listTasks(),
    events: listEvents(),
    meetings: listMeetings(),
  };
  ws.send(JSON.stringify({ type: 'initial_state', payload: initial } satisfies WSMessage));

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
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chief/chat', (req, res) => {
  const { message, sessionId, language } = req.body || {};
  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }

  const resolvedSessionId =
    typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : (req.header('x-chief-session-id') || req.ip || 'default');

  const resolvedLang = (language === 'en' || language === 'ko') ? language : 'ko';

  const result = chatWithChief(resolvedSessionId, message.trim(), resolvedLang);

  if (result.async) {
    // LLM mode: return immediately, results come via WebSocket
    res.json({ status: 'processing', messageId: result.messageId });
  } else {
    // Demo/keyword mode: return synchronous result
    res.json(result);
  }
});

app.post('/api/chief/proposal/approve', (req, res) => {
  const { messageId, selectedIndices, overrideActions, continueOnError, sessionId } = req.body || {};
  if (!messageId || typeof messageId !== 'string') {
    return res.status(400).json({ error: 'messageId is required' });
  }
  try {
    const resolvedSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : (req.header('x-chief-session-id') || undefined);
    const result = approveProposal(messageId, selectedIndices, overrideActions, {
      continueOnError: continueOnError === true,
    }, resolvedSessionId);
    // Broadcast all updated state + chief messages so chat feedback appears
    broadcast({ type: 'agents_update', payload: listAgents() });
    broadcast({ type: 'tasks_update', payload: listTasks() });
    broadcast({ type: 'meetings_update', payload: listMeetings() });
    // Send updated chief messages so approval feedback shows in chat
    broadcast({ type: 'chief_response', payload: {
      messageId: `approval-feedback-${Date.now()}`,
      reply: '',
      actions: [],
      state: result.state,
    }});
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chief/checkin/respond', (req, res) => {
  const { checkInId, optionId, comment, sessionId } = req.body || {};
  if (!checkInId || !optionId) {
    return res.status(400).json({ error: 'checkInId and optionId are required' });
  }
  try {
    const resolvedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0
        ? sessionId.trim()
        : (req.header('x-chief-session-id') || 'chief-default');
    const result = respondToCheckIn(checkInId, optionId, comment, undefined, resolvedSessionId);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chief/action', (req, res) => {
  const { notificationId, actionId, params, sessionId } = req.body || {};
  if (!notificationId || !actionId) {
    return res.status(400).json({ error: 'notificationId and actionId are required' });
  }
  const resolvedSessionId =
    typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : (req.header('x-chief-session-id') || 'chief-default');

  try {
    const result = handleChiefAction(notificationId, actionId, params, resolvedSessionId);
    // Broadcast the reply to all clients (clients filter by sessionId)
    broadcast({ type: 'chief_response', payload: {
      messageId: `action-reply-${Date.now()}`,
      reply: result.reply,
      actions: [],
      state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() },
      sessionId: result.sessionId,
    }});
    res.json({ ok: true, ...result, state: { agents: listAgents(), tasks: listTasks(), meetings: listMeetings() } });
  } catch {
    res.status(400).json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

app.post('/api/chief/proposal/reject', (req, res) => {
  const { messageId } = req.body || {};
  if (!messageId || typeof messageId !== 'string') {
    return res.status(400).json({ error: 'messageId is required' });
  }
  try {
    rejectProposal(messageId);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chief/plan/apply', (req, res) => {
  const { suggestions, sessionId } = req.body || {};
  if (!Array.isArray(suggestions)) {
    return res.status(400).json({ error: 'suggestions array is required' });
  }

  try {
    const applied = applyChiefPlan(suggestions as TeamPlanSuggestion[]);
    const resolvedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0
        ? sessionId.trim()
        : (req.header('x-chief-session-id') || req.ip || 'default');

    res.json({
      ok: true,
      ...applied,
      messages: getChiefMessages(resolvedSessionId),
    });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Live preview endpoint — extract HTML from task result
app.get('/api/tasks/:id/preview', (req, res) => {
  const row = stmts.getTask.get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Task not found' });
  const result = row.result as string | null;
  if (!result) return res.status(404).json({ error: 'No result' });

  const html = extractHtmlFromResult(result);
  if (!html) return res.status(404).json({ error: 'No previewable code found' });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractHtmlFromResult(result: string): string | null {
  // If result looks like it has escaped newlines (literal \n in text), unescape first
  if (result.includes('\\n')) {
    result = unescapeJsonString(result);
  }

  // Markdown code blocks
  const htmlBlock = result.match(/```html\s*\n([\s\S]*?)```/i);
  if (htmlBlock) return htmlBlock[1].trim();

  const jsBlock = result.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (jsBlock) {
    const js = jsBlock[1].trim();
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}canvas{display:block;max-width:100%}</style></head><body><canvas id="canvas" width="800" height="600"></canvas><script>${js}</script></body></html>`;
  }

  // Raw HTML
  if (/<html[\s>]/i.test(result) || /<!DOCTYPE\s+html/i.test(result)) {
    const start = result.indexOf('<');
    const end = result.lastIndexOf('>');
    if (start !== -1 && end > start) return result.slice(start, end + 1);
  }

  if (/<(?:script|canvas|style|body|head)[\s>]/i.test(result) && /<\/(?:script|body|html)>/i.test(result)) {
    const start = result.indexOf('<');
    const end = result.lastIndexOf('>');
    if (start !== -1 && end > start) return result.slice(start, end + 1);
  }

  return null;
}

function roleOfTask(taskId: string): string | null {
  const row = stmts.getTask.get(taskId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const assigneeId = row.assignee_id as string | null;
  if (!assigneeId) return null;
  return getAgent(assigneeId)?.role || null;
}

function getThreadSummary(taskId: string) {
  const root = findRootTask(taskId);
  const children = getChainChildren(root.id);
  const threadTasks = [root, ...children];
  const threadTaskIds = threadTasks.map(t => t.id);

  const allDeliverables = threadTaskIds.flatMap(id => listDeliverablesByTask(id));
  const sorted = [...allDeliverables].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const byRole = {
    draft: sorted.filter(d => roleOfTask(d.taskId) === 'pm'),
    qa: sorted.filter(d => {
      const role = roleOfTask(d.taskId);
      return role === 'qa' || role === 'reviewer';
    }),
    final: sorted.filter(d => roleOfTask(d.taskId) === 'developer'),
  };

  const latestDeliverableByThread = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const finalPreferred = byRole.final.length > 0
    ? byRole.final[byRole.final.length - 1]
    : latestDeliverableByThread;

  return {
    rootTaskId: root.id,
    taskIds: threadTaskIds,
    finalDeliverableId: finalPreferred?.id || null,
    latestDeliverableByThread: latestDeliverableByThread?.id || null,
    draftDeliverableId: byRole.draft[byRole.draft.length - 1]?.id || null,
    qaDeliverableId: byRole.qa[byRole.qa.length - 1]?.id || null,
    allDeliverables: sorted,
  };
}

app.get('/api/tasks/:id', (req, res) => {
  syncRootTaskStates();
  const row = stmts.getTask.get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Task not found' });
  const task = {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    assigneeId: (row.assignee_id as string) ?? null,
    status: row.status as string,
    result: (row.result as string) ?? null,
    parentTaskId: (row.parent_task_id as string) ?? null,
    isTest: !!(row.is_test as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
  res.json(task);
});

app.get('/api/tasks/:id/chain', (req, res) => {
  const children = getChainChildren(req.params.id);
  res.json(children);
});

app.get('/api/tasks/:id/thread-summary', (req, res) => {
  try {
    const summary = getThreadSummary(req.params.id);
    res.json(summary);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function allowIncludeTestQuery(query: Record<string, unknown>): boolean {
  const includeTest = query.includeTest === '1' || query.includeTest === 'true';
  if (!includeTest) return false;
  const isAdminOrDebug = query.admin === '1' || query.admin === 'true' || query.debug === '1' || query.debug === 'true';
  return isAdminOrDebug;
}

app.get('/api/tasks', (req, res) => {
  syncRootTaskStates();
  const { assigneeId } = req.query;
  const includeTest = allowIncludeTestQuery(req.query as Record<string, unknown>);
  const tasks = listTasks(includeTest);
  if (typeof assigneeId === 'string') {
    return res.json(tasks.filter((t) => t.assigneeId === assigneeId));
  }
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  unresetMonitoringState();
  const { title, description, assigneeId, expectedDeliverables } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const task = createTask(title, description || '', assigneeId || null, null, expectedDeliverables || undefined, { isTest: false });
    res.status(201).json(task);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Deliverables API
app.get('/api/deliverables', (req, res) => {
  const { taskId } = req.query;
  if (typeof taskId !== 'string') {
    return res.status(400).json({ error: 'taskId query param required' });
  }
  res.json(listDeliverablesByTask(taskId));
});

app.get('/api/deliverables/:id', (req, res) => {
  const d = getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: 'Deliverable not found' });
  res.json(d);
});

app.get('/api/deliverables/:id/render', (req, res) => {
  const d = getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: 'Deliverable not found' });
  const { contentType, body } = renderDeliverable(d);
  res.setHeader('Content-Type', contentType);
  res.send(body);
});

app.get('/api/deliverables/:id/validate', (req, res) => {
  const d = getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: 'Deliverable not found' });
  if (d.type !== 'web') return res.json({ valid: true, issues: [], type: d.type });
  const result = validateWebDeliverable(d.content);
  res.json(result);
});

app.get('/api/deliverables/:id/download', (req, res) => {
  const d = getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: 'Deliverable not found' });
  const extMap: Record<string, string> = {
    web: 'html', report: 'md', code: d.language || 'txt',
    data: d.format || 'json', document: 'txt', api: 'json', design: 'txt',
  };
  const ext = extMap[d.type] || 'txt';
  const filename = `${d.title.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(d.content);
});

// --- AI Commit ---
app.post('/api/deliverables/:id/commit', (req, res) => {
  try {
    const { message } = req.body || {};
    const sanitizedMsg = typeof message === 'string' ? message.slice(0, 500) : undefined;
    const result = commitDeliverable(req.params.id, sanitizedMsg);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

app.post('/api/tasks/:id/commit', (req, res) => {
  try {
    const { message } = req.body || {};
    const sanitizedMsg = typeof message === 'string' ? message.slice(0, 500) : undefined;
    const result = commitTaskDeliverables(req.params.id, sanitizedMsg);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

app.get('/api/commits', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  res.json(getCommitLog(limit));
});

// Presets
app.get('/api/presets', (_req, res) => {
  res.json(TEAM_PRESETS);
});

app.post('/api/presets/apply', (req, res) => {
  const { presetId } = req.body;
  const preset = TEAM_PRESETS.find(p => p.id === presetId);
  if (!preset) {
    return res.status(400).json({ error: `Unknown preset: ${presetId}` });
  }
  try {
    deleteAllAgents();
    const created = preset.agents.map(a => createAgent(a.name, a.role, a.model));
    broadcast({ type: 'agents_update', payload: listAgents() });
    res.json({ ok: true, agents: created });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Agent control endpoints
app.post('/api/agents/:id/stop', (req, res) => {
  try {
    stopAgentTask(req.params.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/agents/:id/reset', (req, res) => {
  try {
    const agent = resetAgent(req.params.id);
    res.json(agent);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/agents/:id', (req, res) => {
  try {
    deleteAgent(req.params.id);
    broadcast({ type: 'agents_update', payload: listAgents() });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/events', (_req, res) => {
  res.json(listEvents());
});

// Stats & Failures
app.get('/api/stats', (_req, res) => {
  const counts = stmts.taskCounts.get() as Record<string, number>;
  const avgRow = stmts.avgCompletionTime.get() as { avg_ms: number | null };
  const perAgent = (stmts.perAgentStats.all() as Record<string, unknown>[]).map((r) => ({
    agentId: r.agent_id as string,
    agentName: r.agent_name as string,
    role: r.agent_role as string,
    completed: (r.completed as number) || 0,
    failed: (r.failed as number) || 0,
    avgTimeMs: (r.avg_time_ms as number) || 0,
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
  const rows = stmts.failedTasks.all() as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    taskId: r.task_id as string,
    title: r.title as string,
    description: r.description as string,
    agentId: r.assignee_id as string | null,
    agentName: r.agent_name as string | null,
    agentRole: r.agent_role as string | null,
    error: (r.error as string) || 'Unknown error',
    failedAt: r.failed_at as string,
  })));
});

// Monitoring API (mock data): metrics / timeseries / alerts
app.get('/api/monitoring/metrics', (req, res) => {
  const window = typeof req.query.window === 'string' ? req.query.window : undefined;
  res.json(getMockMetrics(window));
});

app.get('/api/monitoring/timeseries', (req, res) => {
  const metric = typeof req.query.metric === 'string' ? req.query.metric : undefined;
  const window = typeof req.query.window === 'string' ? req.query.window : undefined;
  const interval = typeof req.query.interval === 'string' ? req.query.interval : undefined;
  res.json(getMockTimeSeries(metric, window, interval));
});

app.get('/api/monitoring/alerts', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(getMockAlerts(status));
});

app.get('/api/monitoring/schema-sample', (_req, res) => {
  res.json(getMonitoringSchemaSample());
});

// Export endpoints
app.get('/api/export/json', (_req, res) => {
  const agents = listAgents();
  const tasks = listTasks();
  const events = listEvents();
  const counts = stmts.taskCounts.get() as Record<string, number>;
  const avgRow = stmts.avgCompletionTime.get() as { avg_ms: number | null };
  const perAgent = stmts.perAgentStats.all();
  res.setHeader('Content-Disposition', 'attachment; filename="clawhq-export.json"');
  res.json({ exportedAt: new Date().toISOString(), agents, tasks, events, stats: { ...counts, avgCompletionMs: avgRow.avg_ms || 0, perAgent } });
});

app.get('/api/export/markdown', (_req, res) => {
  const agents = listAgents();
  const tasks = listTasks();
  const counts = stmts.taskCounts.get() as Record<string, number>;
  const avgRow = stmts.avgCompletionTime.get() as { avg_ms: number | null };
  const perAgent = (stmts.perAgentStats.all() as Record<string, unknown>[]);
  const total = (counts.total as number) || 0;
  const completed = (counts.completed as number) || 0;
  const failed = (counts.failed as number) || 0;
  const pending = (counts.pending as number) || 0;

  let md = `# ClawHQ Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Tasks | ${total} |\n`;
  md += `| Completed | ${completed} |\n`;
  md += `| Failed | ${failed} |\n`;
  md += `| Pending | ${pending} |\n`;
  md += `| Success Rate | ${total > 0 ? ((completed / total) * 100).toFixed(1) : 0}% |\n`;
  md += `| Avg Completion | ${((avgRow.avg_ms || 0) / 1000).toFixed(1)}s |\n\n`;

  md += `## Agents (${agents.length})\n\n`;
  for (const a of agents) {
    md += `- **${a.name}** — ${a.role} (${a.state})\n`;
  }

  md += `\n## Agent Performance\n\n`;
  md += `| Agent | Role | Completed | Failed | Avg Time |\n|-------|------|-----------|--------|----------|\n`;
  for (const r of perAgent) {
    const avg = ((r as any).avg_time_ms || 0) / 1000;
    md += `| ${(r as any).agent_name} | ${(r as any).agent_role} | ${(r as any).completed || 0} | ${(r as any).failed || 0} | ${avg.toFixed(1)}s |\n`;
  }

  md += `\n## Tasks\n\n`;
  for (const t of tasks) {
    md += `### ${t.title}\n- Status: ${t.status}\n`;
    if (t.result) md += `- Result: ${(t.result as string).slice(0, 200)}\n`;
    md += `\n`;
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clawhq-report.md"');
  res.send(md);
});

app.get('/api/export/csv', (_req, res) => {
  const tasks = listTasks();
  const agents = listAgents();
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
  let csv = 'id,title,status,assignee,created_at,updated_at,result_preview\n';
  for (const t of tasks) {
    const agent = t.assigneeId ? agentMap.get(t.assigneeId) : null;
    csv += `${t.id},${escape(t.title)},${t.status},${escape(agent?.name || '')},${t.createdAt},${t.updatedAt},${escape(((t.result as string) || '').slice(0, 100))}\n`;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clawhq-tasks.csv"');
  res.send(csv);
});

// ---- Decision API ----
import { randomUUID } from 'crypto';
import type { DecisionItem, Proposal, ReviewScore } from '@clawhq/shared';

function hydrateDecisionItem(row: Record<string, unknown>): DecisionItem {
  const id = row.id as string;
  const proposalRows = stmts.listProposalsByDecision.all(id) as Record<string, unknown>[];
  const reviewRows = stmts.listReviewsByDecision.all(id) as Record<string, unknown>[];
  const proposals: Proposal[] = proposalRows.map((p) => ({
    id: p.id as string,
    decisionItemId: p.decision_item_id as string,
    agentId: p.agent_id as string,
    agentName: p.agent_name as string,
    agentRole: p.agent_role as string as any,
    agentModel: p.agent_model as string as any,
    content: p.content as string,
    pros: JSON.parse((p.pros as string) || '[]'),
    cons: JSON.parse((p.cons as string) || '[]'),
    createdAt: p.created_at as string,
  }));
  const reviews: ReviewScore[] = reviewRows.map((r) => ({
    id: r.id as string,
    proposalId: r.proposal_id as string,
    reviewerName: r.reviewer_name as string,
    reviewerRole: r.reviewer_role as string,
    score: r.score as number,
    keyPoints: JSON.parse((r.key_points as string) || '[]'),
    isDevilsAdvocate: !!(r.is_devils_advocate as number),
    sentiment: r.sentiment as any,
    createdAt: r.created_at as string,
  }));
  return {
    id,
    taskId: row.task_id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    priority: (row.priority as any) || 'medium',
    status: (row.status as any) || 'pending',
    proposals,
    reviews,
    chosenProposalId: (row.chosen_proposal_id as string) || null,
    decidedAt: (row.decided_at as string) || null,
    createdAt: row.created_at as string,
  };
}

app.get('/api/decisions', (_req, res) => {
  const rows = stmts.listDecisionItems.all() as Record<string, unknown>[];
  res.json(rows.map(hydrateDecisionItem));
});

app.get('/api/decisions/pending', (_req, res) => {
  const rows = stmts.listPendingDecisions.all() as Record<string, unknown>[];
  res.json(rows.map(hydrateDecisionItem));
});

app.get('/api/decisions/pending/count', (_req, res) => {
  const row = stmts.countPendingDecisions.get() as { count: number };
  res.json({ count: row.count });
});

app.get('/api/decisions/history', (_req, res) => {
  const rows = stmts.listDecisionHistory.all() as Record<string, unknown>[];
  res.json(rows.map(hydrateDecisionItem));
});

app.get('/api/decisions/:id', (req, res) => {
  const row = stmts.getDecisionItem.get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Decision item not found' });
  res.json(hydrateDecisionItem(row));
});

app.post('/api/decisions', (req, res) => {
  const { taskId, title, description, priority } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = randomUUID();
  stmts.insertDecisionItem.run(id, taskId || '', title, description || '', priority || 'medium');
  const row = stmts.getDecisionItem.get(id) as Record<string, unknown>;
  res.status(201).json(hydrateDecisionItem(row));
});

app.post('/api/decisions/:id/proposals', (req, res) => {
  const { agentId, agentName, agentRole, agentModel, content, pros, cons } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const id = randomUUID();
  stmts.insertProposal.run(
    id, req.params.id, agentId || '', agentName || 'Unknown',
    agentRole || 'pm', agentModel || 'claude-sonnet-4',
    content, JSON.stringify(pros || []), JSON.stringify(cons || [])
  );
  res.status(201).json({ id });
});

app.post('/api/decisions/:id/reviews', (req, res) => {
  const { proposalId, reviewerName, reviewerRole, score, keyPoints, isDevilsAdvocate, sentiment } = req.body;
  if (!proposalId) return res.status(400).json({ error: 'proposalId is required' });
  const id = randomUUID();
  stmts.insertReviewScore.run(
    id, proposalId, reviewerName || 'Reviewer', reviewerRole || 'reviewer',
    score ?? 5, JSON.stringify(keyPoints || []),
    isDevilsAdvocate ? 1 : 0, sentiment || 'caution'
  );
  res.status(201).json({ id });
});

app.post('/api/decisions/:id/decide', (req, res) => {
  const { action, chosenProposalId } = req.body;
  if (!action || !['approved', 'revised', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'action must be approved, revised, or rejected' });
  }
  stmts.updateDecisionStatus.run(action, chosenProposalId || null, req.params.id);
  broadcast({ type: 'tasks_update', payload: listTasks() });
  const row = stmts.getDecisionItem.get(req.params.id) as Record<string, unknown>;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(hydrateDecisionItem(row));
});

// Seed demo decisions from completed tasks
app.post('/api/decisions/seed-from-tasks', (_req, res) => {
  const tasks = listTasks().filter(t => t.status === 'completed' && t.result);
  const agents = listAgents();
  let created = 0;
  for (const task of tasks) {
    // Check if decision already exists for this task
    const existing = (stmts.listDecisionItems.all() as Record<string, unknown>[])
      .find(d => d.task_id === task.id);
    if (existing) continue;

    const id = randomUUID();
    const priority = ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 3)] as string;
    stmts.insertDecisionItem.run(id, task.id, task.title, task.description || '', priority);

    // Create proposals from agent results
    const assignee = agents.find(a => a.id === task.assigneeId);
    if (assignee) {
      const p1Id = randomUUID();
      stmts.insertProposal.run(
        p1Id, id, assignee.id, assignee.name, assignee.role, assignee.model,
        task.result || 'No content', JSON.stringify(['Completed on time', 'Follows requirements']),
        JSON.stringify(['Needs testing'])
      );
      // Add reviews
      const reviewers = agents.filter(a => a.role === 'reviewer');
      for (const reviewer of reviewers) {
        const score = 5 + Math.floor(Math.random() * 5);
        const isDA = reviewer.name.includes('깐깐이') || reviewer.name.includes('Diana');
        stmts.insertReviewScore.run(
          randomUUID(), p1Id, reviewer.name, reviewer.role,
          score, JSON.stringify(isDA ? ['Needs more error handling', 'Edge cases not covered'] : ['Good structure', 'Clean code']),
          isDA ? 1 : 0, score >= 7 ? 'positive' : score >= 5 ? 'caution' : 'critical'
        );
      }
    }
    created++;
  }
  res.json({ created });
});

// Meetings API
app.get('/api/meetings', (req, res) => {
  const includeLegacy = req.query.includeLegacy === '1' || req.query.includeLegacy === 'true';
  res.json(listMeetings(includeLegacy));
});

// Test/QC agent management
app.get('/api/admin/test-agents', (_req, res) => {
  res.json(listTestAgents());
});

app.post('/api/admin/cleanup-test-agents', (_req, res) => {
  const result = cleanupTestAgents();
  broadcast({ type: 'agents_update', payload: listAgents() });
  res.json({ ok: true, ...result });
});

app.post('/api/admin/cleanup-test-tasks', (_req, res) => {
  const deleted = (stmts.deleteTestTasks.run() as { changes: number }).changes || 0;
  broadcast({ type: 'tasks_update', payload: listTasks() });
  res.json({ ok: true, deleted });
});

app.post('/api/admin/cleanup-legacy-meetings', (_req, res) => {
  const result = cleanupLegacyMeetings();
  broadcast({ type: 'meetings_update', payload: listMeetings() });
  res.json({ ok: true, ...result });
});

// Alias for frontend reset button
app.post('/api/reset-all', (_req, res) => {
  stmts.deleteAllReviewScores.run();
  stmts.deleteAllProposals.run();
  stmts.deleteAllDecisionItems.run();
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllMeetings.run();
  stmts.deleteAllEvents.run();
  resetChiefState();
  resetChainPlanState();
  resetMonitoringState();

  // Fix #5: Reset all agents to idle so they don't stay stuck in 'done'/'working' state
  const agents = listAgents();
  for (const agent of agents) {
    if (agent.state !== 'idle') {
      stmts.updateAgentState.run('idle', null, null, agent.id);
    }
  }

  broadcast({ type: 'tasks_update', payload: listTasks() });
  broadcast({ type: 'meetings_update', payload: listMeetings() });
  broadcast({ type: 'agents_update', payload: listAgents() });
  broadcast({ type: 'chief_update' as any, payload: { messages: [] } });

  res.json({ ok: true, reset: ['tasks', 'meetings', 'events', 'deliverables', 'decisions', 'chief', 'agents'] });
});

app.post('/api/admin/reset', (_req, res) => {
  // Order matters due to foreign-key references
  stmts.deleteAllReviewScores.run();
  stmts.deleteAllProposals.run();
  stmts.deleteAllDecisionItems.run();
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllMeetings.run();
  stmts.deleteAllEvents.run();

  broadcast({ type: 'tasks_update', payload: listTasks() });
  broadcast({ type: 'meetings_update', payload: listMeetings() });
  broadcast({ type: 'agents_update', payload: listAgents() });

  res.json({ ok: true, reset: ['tasks', 'meetings', 'events', 'deliverables', 'decisions'] });
});

app.get('/api/meetings/:id', (req, res) => {
  const meeting = getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json(meeting);
});

app.post('/api/meetings', (req, res) => {
  const { title, description, type, participantIds, character } = req.body;
  if (!title || !participantIds || !Array.isArray(participantIds) || participantIds.length < 2) {
    return res.status(400).json({ error: 'title and at least 2 participantIds required' });
  }
  try {
    const meeting = startPlanningMeeting(title, description || '', participantIds, character);
    res.status(201).json(meeting);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/meetings/:id/report', (req, res) => {
  const meeting = getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (!meeting.report) return res.status(404).json({ error: 'No report available yet' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(meeting.report);
});

app.post('/api/meetings/:id/decide', (req, res) => {
  const { winnerId, feedback } = req.body;
  if (!winnerId) return res.status(400).json({ error: 'winnerId required' });
  try {
    const meeting = decideMeeting(req.params.id, winnerId, feedback || '');
    res.json(meeting);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Tech Spec Meeting API ----
app.get('/api/tech-spec/suggest-agents', (_req, res) => {
  res.json(suggestTechSpecAgents());
});

app.post('/api/tech-spec/start', (req, res) => {
  const { title, description, assignments } = req.body;
  if (!title || !assignments || !Array.isArray(assignments)) {
    return res.status(400).json({ error: 'title and assignments array required' });
  }
  try {
    const meeting = startTechSpecMeeting(title, description || '', assignments);
    res.status(201).json(meeting);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/tech-spec/:id', (req, res) => {
  const data = getTechSpecData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Tech spec data not found' });
  res.json(data);
});

app.post('/api/tech-spec/:id/rerun', (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'role required' });
  try {
    rerunTechSpecRole(req.params.id, role);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Chain Plan API ----
app.get('/api/chain-plans', (_req, res) => {
  res.json(listAllChainPlans());
});

app.get('/api/chain-plans/active', (_req, res) => {
  res.json(listActiveChainPlans());
});

app.get('/api/chain-plans/:id', (req, res) => {
  const plan = getChainPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  res.json(plan);
});

app.get('/api/chain-plans/by-task/:taskId', (req, res) => {
  const plan = getChainPlanForTask(req.params.taskId);
  if (!plan) return res.status(404).json({ error: 'No plan for this task' });
  res.json(plan);
});

app.post('/api/chain-plans/suggest', (req, res) => {
  const { taskId, taskTitle, taskDescription, startRole, expectedDeliverables } = req.body;
  if (!taskId || !taskTitle || !startRole) {
    return res.status(400).json({ error: 'taskId, taskTitle, startRole required' });
  }
  const plan = suggestChainPlan(taskId, taskTitle, taskDescription || '', startRole, expectedDeliverables);
  res.json(plan);
});

app.put('/api/chain-plans/:id/steps', (req, res) => {
  const { steps } = req.body;
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'steps array required (min 1)' });
  }
  try {
    const plan = editChainPlan(req.params.id, steps);
    res.json(plan);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/chain-plans/:id/auto-execute', (req, res) => {
  const { autoExecute } = req.body;
  if (typeof autoExecute !== 'boolean') {
    return res.status(400).json({ error: 'autoExecute (boolean) required' });
  }
  try {
    const plan = setChainAutoExecute(req.params.id, autoExecute);
    res.json(plan);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chain-plans/:id/confirm', (req, res) => {
  try {
    const plan = confirmChainPlan(req.params.id);
    markChainRunning(plan.id);

    // Fix: If the current step's task is already completed, advance immediately
    const rootTask = listTasks().find(t => t.id === plan.taskId);
    if (rootTask && rootTask.status === 'completed' && plan.autoExecute) {
      const { nextStep } = advanceChainPlan(plan.id);
      if (nextStep && rootTask.assigneeId) {
        spawnChainFollowUp(rootTask.assigneeId, plan.taskId, plan.taskTitle, rootTask.result || '');
      }
    }

    processQueue();
    broadcast({ type: 'tasks_update', payload: listTasks() });
    res.json(plan);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chain-plans/:id/advance', (req, res) => {
  try {
    const { nextStep, plan } = advanceChainPlan(req.params.id);
    if (nextStep) {
      // Find the latest completed task for this plan's task to chain from
      const children = getChainChildren(plan.taskId);
      const lastCompleted = children.length > 0
        ? children.filter(t => t.status === 'completed').pop()
        : null;
      const sourceTaskId = lastCompleted?.id || plan.taskId;
      const sourceTask = lastCompleted || listTasks().find(t => t.id === plan.taskId);

      if (sourceTask && sourceTask.assigneeId) {
        spawnChainFollowUp(sourceTask.assigneeId, sourceTaskId, plan.taskTitle, sourceTask.result || '');
      }
      processQueue();
    }
    broadcast({ type: 'tasks_update', payload: listTasks() });
    res.json({ nextStep, plan });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/chain-plans/:id/cancel', (req, res) => {
  try {
    const plan = cancelChainPlan(req.params.id);
    res.json(plan);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
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

// Recover stuck tasks/agents on startup (e.g. after server restart killed running processes)
function recoverStuckState() {
  const agents = listAgents();
  const tasks = listTasks();
  let recovered = 0;

  // Reset agents that are "working" but have no running process
  for (const agent of agents) {
    if (agent.state === 'working' || agent.state === 'reviewing') {
      resetAgent(agent.id);
      recovered++;
      console.log(`[recovery] Reset stuck agent: ${agent.name} (was ${agent.state})`);
    }
  }

  // Re-queue tasks stuck in "in-progress" so they can be retried
  for (const task of tasks) {
    if (task.status === 'in-progress') {
      stmts.updateTask.run(task.assigneeId, 'pending', task.result, task.id);
      recovered++;
      console.log(`[recovery] Re-queued stuck task: ${task.title}`);
    }
  }

  if (recovered > 0) {
    console.log(`[recovery] Recovered ${recovered} stuck items`);
    broadcast({ type: 'agents_update', payload: listAgents() });
    broadcast({ type: 'tasks_update', payload: listTasks() });
  }
}

// Start
async function main() {
  await checkOpenClaw();
  seedDemoAgents();
  recoverStuckState();
  // Process any pending tasks left from before restart
  setTimeout(() => processQueue(), 2000);

  server.listen(SERVER_PORT, () => {
    console.log(`[server] ClawHQ server running on http://localhost:${SERVER_PORT}`);
    console.log(`[server] WebSocket available at ws://localhost:${SERVER_PORT}/ws`);
  });
}

main().catch(console.error);
