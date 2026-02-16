#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.AI_OFFICE_URL || 'http://localhost:3001';
const mediaDir = 'docs/media';

mkdirSync(mediaDir, { recursive: true });
mkdirSync(`${mediaDir}/frames`, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 980 } });

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Main screenshot
await page.screenshot({ path: `${mediaDir}/main-dashboard.png`, fullPage: true });

// Create some motion frames by navigating tabs if available
const tabs = ['Dashboard', 'Workflow', 'Meetings', 'Chief'];
let frame = 0;
for (const tab of tabs) {
  const btn = page.locator('button', { hasText: tab }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${mediaDir}/frames/frame-${String(frame).padStart(2, '0')}.png`, fullPage: true });
  frame += 1;
}

// extra idle frames for smooth loop
for (let i = 0; i < 4; i += 1) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${mediaDir}/frames/frame-${String(frame).padStart(2, '0')}.png`, fullPage: true });
  frame += 1;
}

await browser.close();
console.log(`[capture] wrote screenshot + ${frame} frames into ${mediaDir}`);
