#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const baseUrl = process.env.AI_OFFICE_URL || 'http://localhost:3001';
const waitMs = Number(process.env.AI_OFFICE_BOOT_WAIT_MS || 6000);
const autoInstall = process.env.AI_OFFICE_AUTO_INSTALL_OPENCLAW !== '0';

function log(msg) {
  console.log(`[demo:start] ${msg}`);
}

function getGlobalBinDir() {
  // npm v10+: `npm prefix -g` is stable; bin is <prefix>/bin on unix.
  const result = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const prefix = (result.stdout || '').trim();
  if (!prefix) return null;
  return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function withGlobalBinInPath(baseEnv = process.env) {
  const currentPath = baseEnv.PATH || '';
  const globalBin = getGlobalBinDir();
  if (!globalBin) return { ...baseEnv };

  const parts = currentPath.split(path.delimiter).filter(Boolean);
  if (!parts.includes(globalBin)) parts.unshift(globalBin);

  return {
    ...baseEnv,
    PATH: parts.join(path.delimiter),
  };
}

function hasOpenClaw(env = process.env) {
  const result = spawnSync('openclaw', ['--version'], { encoding: 'utf8', env });
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
  const envWithGlobalBin = withGlobalBinInPath();

  if (hasOpenClaw(envWithGlobalBin)) {
    log('OpenClaw detected → Full runtime mode enabled.');
    return envWithGlobalBin;
  }

  if (!autoInstall) {
    log('OpenClaw not found → Running in demo mode (auto-install disabled).');
    log('To enable full mode, install OpenClaw then restart: npm install -g openclaw');
    return envWithGlobalBin;
  }

  const installed = installOpenClaw();
  const envAfterInstall = withGlobalBinInPath();

  if (installed && hasOpenClaw(envAfterInstall)) {
    log('OpenClaw install successful → Full runtime mode enabled.');
    return envAfterInstall;
  }

  log('OpenClaw install failed (or PATH not refreshed) → Continuing in demo mode.');
  log('Tip: restart terminal or run `export PATH="$(npm prefix -g)/bin:$PATH"` then retry.');
  log('Manual install command: npm install -g openclaw');
  return envAfterInstall;
}

async function isHealthy() {
  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    return res.ok;
  } catch {
    return false;
  }
}

const runtimeEnv = ensureRuntime();

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
  env: runtimeEnv,
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
