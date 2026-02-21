#!/usr/bin/env node

const baseUrl = process.env.CLAWHQ_URL || 'http://localhost:3001';
const presetId = process.env.CLAWHQ_PRESET || 'full-stack';

async function call(path, method = 'GET', body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed: HTTP ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function log(msg) {
  console.log(`[demo:fixture] ${msg}`);
}

try {
  log(`Resetting demo data at ${baseUrl} ...`);
  const reset = await call('/api/admin/reset', 'POST');
  log(`Reset complete: ${Array.isArray(reset.reset) ? reset.reset.join(', ') : 'ok'}`);

  log(`Applying team preset: ${presetId}`);
  const preset = await call('/api/presets/apply', 'POST', { presetId });
  log(`Preset applied: ${preset.agents?.length ?? 0} agents`);

  await call('/api/admin/cleanup-legacy-meetings', 'POST');

  const [agents, tasks, meetings] = await Promise.all([
    call('/api/agents'),
    call('/api/tasks'),
    call('/api/meetings'),
  ]);

  log(`Ready: agents=${agents.length}, tasks=${tasks.length}, meetings=${meetings.length}`);
  log('Fixture seeded successfully. Next run: npm run demo:scenarios');
} catch (error) {
  console.error(`[demo:fixture] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
