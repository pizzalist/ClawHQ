import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1720,height:980}});
await page.goto('http://localhost:3001',{waitUntil:'networkidle'});
await page.waitForTimeout(1200);
await page.screenshot({path:'/home/noah/.openclaw/workspace/company/ai-office/app/report-office-now.png',fullPage:true});
const chiefBtn = page.locator('button', { hasText: 'Chief' }).first();
if (await chiefBtn.count()) {
  await chiefBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({path:'/home/noah/.openclaw/workspace/company/ai-office/app/report-chief-now.png',fullPage:true});
}
await browser.close();
