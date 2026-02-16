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

  CREATE TABLE IF NOT EXISTS decision_items (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    chosen_proposal_id TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    decision_item_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    agent_model TEXT NOT NULL,
    content TEXT NOT NULL,
    pros TEXT NOT NULL DEFAULT '[]',
    cons TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (decision_item_id) REFERENCES decision_items(id)
  );

  CREATE TABLE IF NOT EXISTS review_scores (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    reviewer_name TEXT NOT NULL,
    reviewer_role TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 5,
    key_points TEXT NOT NULL DEFAULT '[]',
    is_devils_advocate INTEGER NOT NULL DEFAULT 0,
    sentiment TEXT NOT NULL DEFAULT 'caution',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (proposal_id) REFERENCES proposals(id)
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

// Meetings table
db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'planning',
    status TEXT NOT NULL DEFAULT 'active',
    participants TEXT NOT NULL DEFAULT '[]',
    proposals TEXT NOT NULL DEFAULT '[]',
    decision TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add character and report to meetings
try {
  db.exec(`ALTER TABLE meetings ADD COLUMN character TEXT`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE meetings ADD COLUMN report TEXT`);
} catch { /* column already exists */ }

// Migration: add is_test flag to agents
try {
  db.exec(`ALTER TABLE agents ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }

// Migration: add parent_task_id if missing
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id)`);
} catch { /* column already exists */ }

// Migration: meeting lineage columns
try { db.exec(`ALTER TABLE meetings ADD COLUMN parent_meeting_id TEXT`); } catch { /* exists */ }
try { db.exec(`ALTER TABLE meetings ADD COLUMN source_meeting_id TEXT`); } catch { /* exists */ }
try { db.exec(`ALTER TABLE meetings ADD COLUMN source_candidates TEXT`); } catch { /* exists */ }
try { db.exec(`ALTER TABLE meetings ADD COLUMN decision_packet TEXT`); } catch { /* exists */ }

// Migration: add expected_deliverables if missing
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN expected_deliverables TEXT`);
} catch { /* column already exists */ }

// Migration: add is_test to tasks for production-board isolation
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }

// Migration: add batch_id for parallel task grouping
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN batch_id TEXT`);
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
  unlinkAgentTasks: db.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?'),
  deleteAllAgents: db.prepare('DELETE FROM agents'),
  findAgentByRole: db.prepare('SELECT * FROM agents WHERE role = ? AND state = \'idle\' AND is_test = 0 LIMIT 1'),
  markAgentTest: db.prepare('UPDATE agents SET is_test = ? WHERE id = ?'),

  listTasks: db.prepare('SELECT * FROM tasks WHERE is_test = 0 ORDER BY created_at DESC LIMIT 100'),
  listTasksIncludeTest: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 300'),
  getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  insertTask: db.prepare(`
    INSERT INTO tasks (id, title, description, status, parent_task_id, expected_deliverables, is_test, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET assignee_id = ?, status = ?, result = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  cancelTask: db.prepare("UPDATE tasks SET status = 'cancelled', result = 'Cancelled by Chief', updated_at = datetime('now') WHERE id = ?"),
  cancelAllPending: db.prepare("UPDATE tasks SET status = 'cancelled', result = 'Cancelled by Chief', updated_at = datetime('now') WHERE status = 'pending'"),
  pendingTasks: db.prepare("SELECT * FROM tasks WHERE status = 'pending' AND is_test = 0 ORDER BY created_at LIMIT 10"),
  activeTasks: db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in-progress' AND is_test = 0"),

  // Stats queries
  taskCounts: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
    FROM tasks
    WHERE is_test = 0
  `),
  avgCompletionTime: db.prepare(`
    SELECT AVG(
      (julianday(updated_at) - julianday(created_at)) * 86400000
    ) as avg_ms
    FROM tasks WHERE status = 'completed' AND is_test = 0
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
    WHERE t.assignee_id IS NOT NULL AND t.is_test = 0
    GROUP BY t.assignee_id
    ORDER BY completed DESC
  `),
  failedTasks: db.prepare(`
    SELECT t.id as task_id, t.title, t.description, t.assignee_id,
           a.name as agent_name, a.role as agent_role,
           t.result as error, t.updated_at as failed_at
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assignee_id
    WHERE t.status = 'failed' AND t.is_test = 0
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

  // Decision queries
  listDecisionItems: db.prepare('SELECT * FROM decision_items ORDER BY created_at DESC'),
  listPendingDecisions: db.prepare("SELECT * FROM decision_items WHERE status = 'pending' ORDER BY created_at DESC"),
  getDecisionItem: db.prepare('SELECT * FROM decision_items WHERE id = ?'),
  insertDecisionItem: db.prepare(`
    INSERT INTO decision_items (id, task_id, title, description, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
  `),
  updateDecisionStatus: db.prepare(`
    UPDATE decision_items SET status = ?, chosen_proposal_id = ?, decided_at = datetime('now') WHERE id = ?
  `),
  countPendingDecisions: db.prepare("SELECT COUNT(*) as count FROM decision_items WHERE status = 'pending'"),
  listDecisionHistory: db.prepare("SELECT * FROM decision_items WHERE status != 'pending' ORDER BY decided_at DESC LIMIT 100"),

  listProposalsByDecision: db.prepare('SELECT * FROM proposals WHERE decision_item_id = ? ORDER BY created_at'),
  insertProposal: db.prepare(`
    INSERT INTO proposals (id, decision_item_id, agent_id, agent_name, agent_role, agent_model, content, pros, cons, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `),

  listReviewsByProposal: db.prepare('SELECT * FROM review_scores WHERE proposal_id = ? ORDER BY created_at'),
  listReviewsByDecision: db.prepare(`
    SELECT rs.* FROM review_scores rs
    JOIN proposals p ON p.id = rs.proposal_id
    WHERE p.decision_item_id = ?
    ORDER BY rs.created_at
  `),
  insertReviewScore: db.prepare(`
    INSERT INTO review_scores (id, proposal_id, reviewer_name, reviewer_role, score, key_points, is_devils_advocate, sentiment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `),

  // Meetings
  listMeetings: db.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT 50'),
  getMeeting: db.prepare('SELECT * FROM meetings WHERE id = ?'),
  insertMeeting: db.prepare(`
    INSERT INTO meetings (id, title, description, type, status, participants, proposals, decision, character, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, '[]', NULL, ?, datetime('now'), datetime('now'))
  `),
  updateMeeting: db.prepare(`
    UPDATE meetings SET status = ?, proposals = ?, decision = ?, report = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  updateMeetingLineage: db.prepare(`
    UPDATE meetings SET parent_meeting_id = ?, source_meeting_id = ?, source_candidates = ?, decision_packet = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  // Admin / cleanup
  deleteAllDeliverables: db.prepare('DELETE FROM deliverables'),
  deleteAllReviewScores: db.prepare('DELETE FROM review_scores'),
  deleteAllProposals: db.prepare('DELETE FROM proposals'),
  deleteAllDecisionItems: db.prepare('DELETE FROM decision_items'),
  deleteAllTasks: db.prepare('DELETE FROM tasks'),
  listTestTasks: db.prepare('SELECT * FROM tasks WHERE is_test = 1 ORDER BY created_at DESC'),
  markTaskTestById: db.prepare('UPDATE tasks SET is_test = 1, updated_at = datetime(\'now\') WHERE id = ?'),
  deleteTestTasks: db.prepare('DELETE FROM tasks WHERE is_test = 1'),
  deleteAllMeetings: db.prepare('DELETE FROM meetings'),
  deleteAllEvents: db.prepare('DELETE FROM events'),
  listLegacyMeetings: db.prepare(`
    SELECT * FROM meetings
    WHERE lower(proposals) LIKE '%proposal%'
       OR lower(proposals) LIKE '%제안서%'
       OR lower(report) LIKE '%proposal%'
       OR lower(report) LIKE '%제안서%'
       OR lower(title) LIKE '%proposal%'
       OR lower(title) LIKE '%제안서%'
    ORDER BY created_at DESC
  `),
  deleteMeetingById: db.prepare('DELETE FROM meetings WHERE id = ?'),

  // Batch operations
  setBatchId: db.prepare('UPDATE tasks SET batch_id = ? WHERE id = ?'),
  getTasksByBatchId: db.prepare('SELECT * FROM tasks WHERE batch_id = ? ORDER BY created_at'),

  listEvents: db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200'),
  insertEvent: db.prepare(`
    INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `),
};

export default db;
