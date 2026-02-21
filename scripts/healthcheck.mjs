#!/usr/bin/env node

const baseUrl = process.env.CLAWHQ_URL || 'http://localhost:3001';

const checks = [
  { name: 'GET /api/agents', method: 'GET', path: '/api/agents' },
  { name: 'GET /api/tasks', method: 'GET', path: '/api/tasks' },
  { name: 'GET /api/events', method: 'GET', path: '/api/events' },
  { name: 'GET /api/stats', method: 'GET', path: '/api/stats' },
  {
    name: 'POST /api/chief/chat',
    method: 'POST',
    path: '/api/chief/chat',
    body: { message: '상태 확인', sessionId: `healthcheck-${Date.now()}` },
  },
];

let failed = 0;

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: check.method,
      headers: check.body ? { 'Content-Type': 'application/json' } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
    });

    const elapsed = Date.now() - startedAt;

    if (!response.ok) {
      failed += 1;
      console.log(`❌ ${check.name} -> HTTP ${response.status} (${elapsed}ms)`);
      continue;
    }

    let validJson = true;
    try {
      await response.json();
    } catch {
      validJson = false;
    }

    if (!validJson) {
      failed += 1;
      console.log(`❌ ${check.name} -> invalid JSON (${elapsed}ms)`);
      continue;
    }

    console.log(`✅ ${check.name} -> OK (${elapsed}ms)`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${check.name} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.log(`\nHealthcheck failed: ${failed} check(s) failed.`);
  process.exit(1);
}

console.log('\nHealthcheck passed: all checks are healthy.');
