import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';
const OUT_OFFICE =
  process.env.OUT_OFFICE ?? '/home/noah/.openclaw/workspace/company/ai-office/app/naruto-ref-pass1-office.png';
const OUT_ACTION =
  process.env.OUT_ACTION ?? '/home/noah/.openclaw/workspace/company/ai-office/app/naruto-ref-pass1-action.png';

const POLL_MS = 250;
const WORKING_TIMEOUT_MS = 20_000;
const RESET_TIMEOUT_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(page, path) {
  return page.evaluate(async (p) => {
    const res = await fetch(p);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${p} -> ${res.status} ${JSON.stringify(body)}`);
    return body;
  }, path);
}

async function apiPost(page, path, body = undefined) {
  return page.evaluate(async ({ p, b }) => {
    const res = await fetch(p, {
      method: 'POST',
      headers: b === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${p} -> ${res.status} ${JSON.stringify(payload)}`);
    return payload;
  }, { p: path, b: body });
}

async function waitFor(page, predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for ${label} (${timeoutMs}ms)`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 980 } });

let pmId;

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await sleep(1200);
  await page.screenshot({ path: OUT_OFFICE, fullPage: true });

  const agents = await apiGet(page, '/api/agents');
  const pm = agents.find((a) => a.role === 'pm');
  if (!pm) throw new Error('PM agent not found');

  if (pm.state !== 'idle') {
    throw new Error(`PM must be idle before capture (current state: ${pm.state})`);
  }

  pmId = pm.id;

  const tempTask = await apiPost(page, '/api/tasks', {
    title: `Sprite Action Validation (${new Date().toISOString()})`,
    description: 'Trigger PM working animation for sprite capture',
    assigneeId: pm.id,
  });

  await apiPost(page, '/api/tasks/process');

  // Require a stable working state across consecutive polls.
  let stableWorkingCount = 0;
  await waitFor(
    page,
    async () => {
      const refreshed = await apiGet(page, '/api/agents');
      const currentPm = refreshed.find((a) => a.id === pm.id);
      const isWorkingOnNewTask = currentPm?.state === 'working' && currentPm?.currentTaskId === tempTask.id;

      if (isWorkingOnNewTask) {
        stableWorkingCount += 1;
      } else {
        stableWorkingCount = 0;
      }

      return stableWorkingCount >= 2;
    },
    WORKING_TIMEOUT_MS,
    'PM working animation state'
  );

  // Give renderer a frame or two after state validation.
  await sleep(350);
  await page.screenshot({ path: OUT_ACTION, fullPage: true });

  console.log(`✅ Captured office: ${OUT_OFFICE}`);
  console.log(`✅ Captured PM working action: ${OUT_ACTION}`);
} finally {
  // Clean exit: stop/reset PM so we do not leave it in working state.
  if (pmId) {
    try {
      await apiPost(page, `/api/agents/${pmId}/stop`);
    } catch {
      // ignore best-effort stop
    }

    try {
      await waitFor(
        page,
        async () => {
          const agents = await apiGet(page, '/api/agents');
          const pm = agents.find((a) => a.id === pmId);
          return pm && pm.state !== 'working';
        },
        RESET_TIMEOUT_MS,
        'PM to exit working state'
      );
    } catch {
      // fallback to reset regardless
    }

    try {
      await apiPost(page, `/api/agents/${pmId}/reset`);
    } catch {
      // ignore best-effort reset
    }
  }

  await browser.close();
}
