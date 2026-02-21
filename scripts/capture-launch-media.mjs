#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const baseUrl = process.env.CLAWHQ_URL || 'http://localhost:3001';
const mediaDir = 'docs/media';
const framesDir = `${mediaDir}/frames`;

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(mediaDir, { recursive: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 980 } });

let frame = 0;
const snap = async () => {
  await page.screenshot({ path: `${framesDir}/frame-${String(frame).padStart(2, '0')}.png`, fullPage: true });
  frame += 1;
};

const chat = async (text) => {
  const input = page.getByPlaceholder('총괄자에게 지시하세요...');
  await input.click();
  await input.fill(text);

  const sendBtnKo = page.getByRole('button', { name: '전송' });
  const sendBtnEn = page.getByRole('button', { name: 'Send' });

  if (await sendBtnKo.count()) {
    await sendBtnKo.first().click();
  } else if (await sendBtnEn.count()) {
    await sendBtnEn.first().click();
  } else {
    await input.press('Enter');
  }
};

const waitForTaskState = async (targetStates = ['in-progress', 'completed'], timeoutMs = 90000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matched = await page.evaluate(async (states) => {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      return tasks.some((t) => states.includes(t.status));
    }, targetStates);
    if (matched) return true;
    await page.waitForTimeout(1500);
  }
  return false;
};

// Clean demo state first (for deterministic flow)
await page.request.post(`${baseUrl}/api/admin/reset`);
await page.request.post(`${baseUrl}/api/presets/apply`, {
  data: { presetId: 'full-stack' },
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// main hero screenshot
await page.screenshot({ path: `${mediaDir}/main-dashboard.png`, fullPage: true });

// Frame 0: clean initial office
await snap();

// Frame 1: command input
await chat('노트앱 MVP 기획서 만들어줘');
await page.waitForTimeout(1200);
await snap();

// Frame 2: approve
await chat('응');
await page.waitForTimeout(1200);
await snap();

// Frame 3~4: running/completed progression
await waitForTaskState(['in-progress', 'completed'], 45000);
await page.waitForTimeout(1000);
await snap();
await page.waitForTimeout(3000);
await snap();

// Frame 5: confirm
await chat('확정');
await page.waitForTimeout(1500);
await snap();

// Frame 6: switch to Tasks tab for evidence
const tasksTab = page.getByRole('button', { name: 'Tasks' });
if (await tasksTab.count()) {
  await tasksTab.first().click();
  await page.waitForTimeout(1000);
}
await snap();

// Frame 7: dashboard/monitoring snapshot
const dashboardTab = page.getByRole('button', { name: 'Dashboard' });
if (await dashboardTab.count()) {
  await dashboardTab.first().click();
  await page.waitForTimeout(1000);
}
await snap();

await browser.close();
console.log(`[capture] wrote screenshot + ${frame} flow frames into ${mediaDir}`);
