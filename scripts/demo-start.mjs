#!/usr/bin/env node

import { spawn } from 'node:child_process';

const baseUrl = process.env.AI_OFFICE_URL || 'http://localhost:3001';
const waitMs = Number(process.env.AI_OFFICE_BOOT_WAIT_MS || 6000);

function log(msg) {
  console.log(`[demo:start] ${msg}`);
}

async function isHealthy() {
  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    return res.ok;
  } catch {
    return false;
  }
}

if (await isHealthy()) {
  log(`Server already running at ${baseUrl}`);
  log('Run `npm run healthcheck` to verify all core endpoints.');
  process.exit(0);
}

log('Starting AI Office dev environment...');
log('This runs server + web in parallel and streams logs below.');
log('Press Ctrl+C to stop.');

const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

setTimeout(async () => {
  const healthy = await isHealthy();
  if (healthy) {
    log(`Booted successfully at ${baseUrl}`);
    log('Next: run `npm run healthcheck` in another terminal.');
  } else {
    log(`Still booting (or failed). Check logs above. Expected URL: ${baseUrl}`);
  }
}, waitMs);

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
