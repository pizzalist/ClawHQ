#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tab(page, name) {
  // Use the top nav tabs only (the ones in the view tab bar, not mobile or activity log)
  return page.locator('.shrink-0 > button', { hasText: name }).first();
}

(async () => {
  console.log('🎬 Starting demo recording...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: '/tmp/clawhq-video/', size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();

  // 1. Open ClawHQ
  console.log('📍 Opening ClawHQ...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(3000);

  // 2. Send task to Chief
  console.log('🧠 Sending task to Chief...');
  const chiefInput = page.locator('input[placeholder*="Chief"], input[placeholder*="instructions"]').first();
  await chiefInput.click();
  await chiefInput.fill('Build a real-time chat application. Start with a planning meeting with all team members, create tech specs, then develop it.');
  await sleep(500);
  
  const sendBtn = page.locator('button:has-text("Send")').first();
  await sendBtn.click();
  console.log('📤 Task sent!');
  await sleep(8000);

  // 3. Approve if prompted
  const approveBtn = page.locator('button:has-text("Approve")').first();
  if (await approveBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    console.log('✅ Approving...');
    await approveBtn.click();
    await sleep(5000);
  }

  // Wait for some agent activity
  console.log('⏳ Waiting for agents...');
  await sleep(10000);

  // 4. Tour the tabs
  const tabs = ['Meetings', 'Decisions', 'Tasks', 'Dashboard', 'Workflow', 'Failures', 'History', 'Office'];
  for (const name of tabs) {
    console.log(`📍 → ${name}`);
    await tab(page, name).click();
    await sleep(3000);
  }

  // Final pause on office
  await sleep(3000);

  // Save video
  console.log('💾 Saving video...');
  const video = page.video();
  await page.close();
  
  if (video) {
    const videoPath = await video.path();
    const { copyFileSync } = await import('node:fs');
    copyFileSync(videoPath, '/tmp/clawhq-demo-raw.webm');
    console.log(`📹 Saved to /tmp/clawhq-demo-raw.webm`);
  }
  
  await context.close();
  await browser.close();
  console.log('🎬 Done!');
})().catch(e => { console.error('Error:', e); process.exit(1); });
