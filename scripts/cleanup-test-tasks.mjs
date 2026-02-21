#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'packages', 'server', 'data', 'clawhq.db');
const dryRun = process.argv.includes('--dry-run');

const db = new Database(DB_PATH);

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

try {
  const hasTaskIsTest = hasColumn('tasks', 'is_test');
  const hasAgentIsTest = hasColumn('agents', 'is_test');

  if (!hasTaskIsTest) {
    db.exec("ALTER TABLE tasks ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
  }

  const likeClauses = [
    'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?',
    'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?', 'lower(t.title) LIKE ?',
    'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?',
    'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?', 'lower(t.description) LIKE ?',
  ];
  const patterns = [
    '%qc%', '%qa%', '%test%', '%테스트%', '%자동 검증%', '%auto validation%', '%내부 핫픽스%', '%internal hotfix%',
  ];

  const agentTestClause = hasAgentIsTest ? ' OR COALESCE(a.is_test, 0) = 1 ' : '';

  const sql = `
    SELECT t.id
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assignee_id
    WHERE COALESCE(t.is_test, 0) = 1
      ${agentTestClause}
      OR ${likeClauses.join(' OR ')}
  `;

  const rows = db.prepare(sql).all(...patterns, ...patterns);
  const ids = Array.from(new Set(rows.map((r) => r.id)));

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, matched: ids.length }, null, 2));
    process.exit(0);
  }

  const tx = db.transaction((taskIds) => {
    const delDeliverables = db.prepare('DELETE FROM deliverables WHERE task_id = ?');
    const delEvents = db.prepare('DELETE FROM events WHERE task_id = ?');
    const delTask = db.prepare('DELETE FROM tasks WHERE id = ?');
    for (const id of taskIds) {
      delDeliverables.run(id);
      delEvents.run(id);
      delTask.run(id);
    }
  });

  tx(ids);
  console.log(JSON.stringify({ dryRun: false, cleaned: ids.length }, null, 2));
} finally {
  db.close();
}
