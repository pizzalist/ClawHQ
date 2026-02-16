#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';

const baseUrl = process.env.AI_OFFICE_URL || 'http://localhost:3001';
const waitMs = Number(process.env.AI_OFFICE_BOOT_WAIT_MS || 6000);
const autoInstall = process.env.AI_OFFICE_AUTO_INSTALL_OPENCLAW !== '0';

function log(msg) {
  console.log(`[demo:start] ${msg}`);
}

function hasOpenClaw() {
  const result = spawnSync('openclaw', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function installOpenClaw() {
  log('OpenClaw not found. Trying auto-install: npm install -g openclaw');
  const install = spawnSync('npm', ['install', '-g', 'openclaw'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return install.status === 0;
}

function ensureRuntime() {
  if (hasOpenClaw()) {
    log('OpenClaw detected → Full runtime mode enabled.');
    return;
  }

  if (!autoInstall) {
    log('OpenClaw not found → Running in demo mode (auto-install disabled).');
    log('To enable full mode, install OpenClaw then restart: npm install -g openclaw');
    return;
  }

  const installed = installOpenClaw();
  if (installed && hasOpenClaw()) {
    log('OpenClaw install successful → Full runtime mode enabled.');
  } else {
    log('OpenClaw install failed → Continuing in demo mode.');
    log('You can install manually later: npm install -g openclaw');
  }
}

async function isHealthy() {
  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    return res.ok;
  } catch {
    return false;
  }
}

ensureRuntime();

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
