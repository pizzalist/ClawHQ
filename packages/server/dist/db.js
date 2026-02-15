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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (assignee_id) REFERENCES agents(id)
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
    listTasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100'),
    getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    insertTask: db.prepare(`
    INSERT INTO tasks (id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))
  `),
    updateTask: db.prepare(`
    UPDATE tasks SET assignee_id = ?, status = ?, result = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
    pendingTasks: db.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 10"),
    activeTasks: db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in-progress'"),
    listEvents: db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200'),
    insertEvent: db.prepare(`
    INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `),
};
export default db;
