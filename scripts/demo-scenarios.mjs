#!/usr/bin/env node

const baseUrl = process.env.AI_OFFICE_URL || 'http://localhost:3001';
const sessionId = process.env.AI_OFFICE_DEMO_SESSION || `demo-scenarios-${Date.now()}`;

const scenarios = [
  { name: 'MVP planning chain', prompt: 'B2B SaaS MVP 기획서 만들어줘' },
  { name: 'Payment architecture chain', prompt: 'PG 연동 결제 시스템 아키텍처 설계해줘' },
  { name: 'Bugfix workflow', prompt: '로그인 세션 만료 후 자동 로그아웃 안 되는 버그 수정해줘' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, method = 'GET', body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function log(msg) {
  console.log(`[demo:scenarios] ${msg}`);
}

async function chat(message) {
  return call('/api/chief/chat', 'POST', { message, sessionId });
}

async function listTasks() {
  return call('/api/tasks');
}

async function activeCount() {
  const tasks = await listTasks();
  return tasks.filter((t) => t.status === 'pending' || t.status === 'in-progress').length;
}

async function waitForIdle(maxSeconds = 240) {
  const maxLoops = Math.ceil(maxSeconds / 5);
  for (let i = 0; i < maxLoops; i += 1) {
    const active = await activeCount();
    if (active === 0) return true;
    if ((i + 1) % 6 === 0) log(`waiting... active=${active}`);
    await sleep(5000);
  }
  return false;
}

const RUN_TIMEOUT_SECONDS = Number(process.env.AI_OFFICE_SCENARIO_TIMEOUT_SEC || 120);

async function runScenario(index, scenario) {
  const before = await listTasks();
  const beforeIds = new Set(before.map((t) => t.id));

  log(`(${index + 1}/${scenarios.length}) ${scenario.name}`);
  log(`prompt: ${scenario.prompt}`);
  await chat(scenario.prompt);
  await sleep(12000);

  await chat('응');
  const idle1 = await waitForIdle(RUN_TIMEOUT_SECONDS);
  if (!idle1) {
    log(`result: ⚠️ timeout while waiting first phase`);
  }

  await chat('확정');
  const idle2 = await waitForIdle(RUN_TIMEOUT_SECONDS);
  if (!idle2) {
    log(`result: ⚠️ timeout while waiting confirm phase`);
  }

  const after = await listTasks();
  const created = after.filter((t) => !beforeIds.has(t.id));
  const latest = created.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];

  if (!latest) {
    log(`result: ⚠️ no new task detected`);
    return { ok: false, scenario: scenario.name, detail: 'no task created' };
  }

  const len = (latest.result || '').length;
  const ok = latest.status === 'completed' && len > 300;
  log(`result: ${ok ? '✅' : '⚠️'} ${latest.status} | ${latest.id.slice(0, 8)} | ${len} chars`);
  return { ok, scenario: scenario.name, taskId: latest.id, status: latest.status, length: len };
}

try {
  log(`Starting scenarios on ${baseUrl}`);
  log(`sessionId=${sessionId}`);

  const results = [];
  for (let i = 0; i < scenarios.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runScenario(i, scenarios[i]);
    results.push(r);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== Demo scenario summary ===');
  for (const r of results) {
    console.log(`- ${r.ok ? 'PASS' : 'FAIL'} | ${r.scenario} | ${r.status || '-'} | ${r.length || 0} chars`);
  }
  console.log(`TOTAL: ${results.length}, PASS: ${pass}, FAIL: ${fail}`);

  if (fail > 0) process.exit(1);
} catch (error) {
  console.error(`[demo:scenarios] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
