import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = {
  blankScreen: { pass: true, failures: [] },
  chiefPersistence: { pass: false, details: '' },
  criticalAlertRender: { pass: false, details: '' },
  pageErrors: [],
};

function nonEmpty(text) {
  return !!text && text.replace(/\s+/g, '').length > 20;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', (err) => {
  results.pageErrors.push(String(err?.message || err));
});

try {
  // 1) Blank-screen reproduction 10x => 0
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  for (let i = 1; i <= 10; i++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const appText = await page.locator('#root').innerText().catch(() => '');
    const hasMain = await page.locator('main').count();
    if (!nonEmpty(appText) || hasMain === 0) {
      results.blankScreen.pass = false;
      results.blankScreen.failures.push({ round: i, appTextLen: (appText || '').length, hasMain });
    }
  }

  // 2) Chief message persistence across refresh
  await page.getByRole('button', { name: /🧠\s*Chief/i }).first().click();
  const input = page.getByPlaceholder('총괄자에게 지시하세요...');
  const marker = `QC_PERSIST_${Date.now()}`;
  await input.fill(marker);
  await page.getByRole('button', { name: '전송' }).click();

  await page.waitForFunction((mk) => {
    return document.body.innerText.includes(mk);
  }, marker, { timeout: 15000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const persisted = await page.evaluate((mk) => document.body.innerText.includes(mk), marker);
  results.chiefPersistence.pass = !!persisted;
  results.chiefPersistence.details = persisted ? 'marker found after refresh' : 'marker missing after refresh';

  // 3) Critical Alert render-tree stability
  await page.getByRole('button', { name: /📊\s*Dashboard/i }).first().click();
  await page.waitForTimeout(2000);

  const dashboardVisible = await page.locator('text=운영 모니터링 대시보드').count();
  const rootText = await page.locator('#root').innerText().catch(() => '');
  const hasCriticalWord = /critical/i.test(rootText);

  // Keep dashboard open through a few auto-refresh cycles to detect render tree collapse.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(5500);
    const textNow = await page.locator('#root').innerText().catch(() => '');
    if (!nonEmpty(textNow) || !/운영 모니터링 대시보드/.test(textNow)) {
      results.criticalAlertRender.pass = false;
      results.criticalAlertRender.details = `collapsed at cycle=${i + 1}, len=${textNow.length}`;
      break;
    }
  }

  if (!results.criticalAlertRender.details) {
    const hasRenderTree = nonEmpty(rootText) && dashboardVisible > 0;
    results.criticalAlertRender.pass = hasRenderTree && hasCriticalWord;
    results.criticalAlertRender.details = `dashboardVisible=${dashboardVisible}, hasCriticalWord=${hasCriticalWord}, rootLen=${rootText.length}`;
  }
} finally {
  await browser.close();
}

const overallPass = results.blankScreen.pass && results.chiefPersistence.pass && results.criticalAlertRender.pass && results.pageErrors.length === 0;
console.log(JSON.stringify({ overallPass, ...results }, null, 2));
if (!overallPass) process.exit(1);
