import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'ai-office.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle',
    current_task_id TEXT,
    session_id TEXT,
    desk_index INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assignee_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    parent_task_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (assignee_id) REFERENCES agents(id),
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS deliverables (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT,
    format TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    agent_id TEXT,
    task_id TEXT,
    message TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add parent_task_id if missing
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id)`);
} catch { /* column already exists */ }

// Migration: add expected_deliverables if missing
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN expected_deliverables TEXT`);
} catch { /* column already exists */ }

// Prepared statements
export const stmts = {
  listAgents: db.prepare('SELECT * FROM agents ORDER BY desk_index'),
  getAgent: db.prepare('SELECT * FROM agents WHERE id = ?'),
  insertAgent: db.prepare(`
    INSERT INTO agents (id, name, role, model, state, desk_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?, datetime('now'), datetime('now'))
  `),
  updateAgentState: db.prepare(`
    UPDATE agents SET state = ?, current_task_id = ?, session_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  countAgents: db.prepare('SELECT COUNT(*) as count FROM agents'),
  deleteAgent: db.prepare('DELETE FROM agents WHERE id = ?'),
  deleteAllAgents: db.prepare('DELETE FROM agents'),
  findAgentByRole: db.prepare('SELECT * FROM agents WHERE role = ? AND state = \'idle\' LIMIT 1'),

  listTasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100'),
  getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  insertTask: db.prepare(`
    INSERT INTO tasks (id, title, description, status, parent_task_id, expected_deliverables, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET assignee_id = ?, status = ?, result = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  pendingTasks: db.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 10"),
  activeTasks: db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in-progress'"),

  // Stats queries
  taskCounts: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
    FROM tasks
  `),
  avgCompletionTime: db.prepare(`
    SELECT AVG(
      (julianday(updated_at) - julianday(created_at)) * 86400000
    ) as avg_ms
    FROM tasks WHERE status = 'completed'
  `),
  perAgentStats: db.prepare(`
    SELECT
      t.assignee_id as agent_id,
      a.name as agent_name,
      a.role as agent_role,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(CASE WHEN t.status = 'completed'
        THEN (julianday(t.updated_at) - julianday(t.created_at)) * 86400000
        ELSE NULL END) as avg_time_ms
    FROM tasks t
    JOIN agents a ON a.id = t.assignee_id
    WHERE t.assignee_id IS NOT NULL
    GROUP BY t.assignee_id
    ORDER BY completed DESC
  `),
  failedTasks: db.prepare(`
    SELECT t.id as task_id, t.title, t.description, t.assignee_id,
           a.name as agent_name, a.role as agent_role,
           t.result as error, t.updated_at as failed_at
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assignee_id
    WHERE t.status = 'failed'
    ORDER BY t.updated_at DESC
    LIMIT 100
  `),

  // Deliverables
  insertDeliverable: db.prepare(`
    INSERT INTO deliverables (id, task_id, type, title, content, language, format, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `),
  listDeliverablesByTask: db.prepare('SELECT * FROM deliverables WHERE task_id = ? ORDER BY created_at'),
  getDeliverable: db.prepare('SELECT * FROM deliverables WHERE id = ?'),
  deleteDeliverablesByTask: db.prepare('DELETE FROM deliverables WHERE task_id = ?'),

  listEvents: db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200'),
  insertEvent: db.prepare(`
    INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `),
};

export default db;
