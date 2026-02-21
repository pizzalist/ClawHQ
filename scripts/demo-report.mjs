#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.CLAWHQ_URL || 'http://localhost:3001';
const outPath = process.env.CLAWHQ_REPORT_PATH || 'docs/demo-latest-report.md';

async function call(path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  return res.json();
}

function fmt(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

try {
  const [health, stats, agents, tasks, meetings] = await Promise.all([
    call('/api/health'),
    call('/api/stats'),
    call('/api/agents'),
    call('/api/tasks'),
    call('/api/meetings'),
  ]);

  const now = new Date();
  const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in-progress');
  const latestTasks = [...tasks]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12);

  const byState = agents.reduce((acc, a) => {
    acc[a.state] = (acc[a.state] || 0) + 1;
    return acc;
  }, {});

  const lines = [];
  lines.push('# Demo Latest Report');
  lines.push('');
  lines.push(`- Generated: ${now.toISOString()}`);
  lines.push(`- Base URL: ${baseUrl}`);
  const healthOk = health?.ok === true || health?.status === 'ok';
  lines.push(`- Health: ${healthOk ? 'OK' : 'NOT_OK'}`);
  lines.push('');
  lines.push('## System Summary');
  lines.push('');
  lines.push(`- Agents: ${agents.length}`);
  lines.push(`- Tasks: ${tasks.length}`);
  lines.push(`- Meetings: ${meetings.length}`);
  lines.push(`- Active Tasks: ${activeTasks.length}`);
  lines.push(`- Task Success Rate: ${stats?.successRate ?? 'n/a'}%`);
  lines.push(`- Avg Task Duration: ${stats?.avgDurationSec ?? 'n/a'} sec`);
  lines.push('');
  lines.push('## Agent States');
  lines.push('');
  for (const [k, v] of Object.entries(byState)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('## Latest Tasks');
  lines.push('');
  lines.push('| id | status | title | result chars |');
  lines.push('|---|---|---|---:|');
  for (const t of latestTasks) {
    lines.push(`| ${fmt(t.id).slice(0, 8)} | ${fmt(t.status)} | ${fmt(t.title).slice(0, 70)} | ${(t.result || '').length} |`);
  }
  lines.push('');
  lines.push('## Go / No-Go (Demo Readiness)');
  lines.push('');
  lines.push(`- Health endpoint: ${healthOk ? 'PASS' : 'FAIL'}`);
  lines.push(`- Active task backlog: ${activeTasks.length === 0 ? 'PASS' : 'CHECK NEEDED'}`);
  lines.push(`- Completed tasks available: ${tasks.some((t) => t.status === 'completed') ? 'PASS' : 'FAIL'}`);

  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[demo:report] Wrote ${outPath}`);
} catch (error) {
  console.error(`[demo:report] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
