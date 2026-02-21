/**
 * Post-deployment QA revalidation script.
 *
 * Usage:
 *   npm run qa:post-deploy -w @clawhq/server
 *   QA_BASE_URL=http://localhost:3001 npm run qa:post-deploy -w @clawhq/server
 *   QA_OUT=./POST_DEPLOY_QA_REPORT.md npm run qa:post-deploy -w @clawhq/server
 */
import { writeFile } from 'node:fs/promises';

type CheckResult = {
  id: string;
  title: string;
  ok: boolean;
  durationMs: number;
  detail: string;
};

type AnyJson = Record<string, unknown>;

const baseUrl = (process.env.QA_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const outPath = process.env.QA_OUT || './POST_DEPLOY_QA_REPORT.md';

async function runCheck(
  id: string,
  title: string,
  fn: () => Promise<string>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, ok: true, durationMs: Date.now() - start, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, title, ok: false, durationMs: Date.now() - start, detail: message };
  }
}

async function getJson(path: string): Promise<AnyJson> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as AnyJson;
}

async function getJsonArray(path: string): Promise<AnyJson[]> {
  const data = await getJson(path);
  if (!Array.isArray(data)) {
    throw new Error(`${path} -> expected array response`);
  }
  return data as AnyJson[];
}

async function postJson(path: string, body: AnyJson): Promise<AnyJson> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as AnyJson;
}

async function deleteReq(path: string): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const startedAt = new Date().toISOString();

  const results: CheckResult[] = [];

  results.push(
    await runCheck('D01', 'Health endpoint', async () => {
      const health = await getJson('/api/health');
      assert(health.status === 'ok', 'health.status must be ok');
      assert(typeof health.demoMode === 'boolean', 'health.demoMode must be boolean');
      assert(typeof health.agents === 'number', 'health.agents must be number');
      return `status=${health.status}, demoMode=${String(health.demoMode)}, agents=${String(health.agents)}`;
    }),
  );

  results.push(
    await runCheck('D02', 'Core list endpoints', async () => {
      const [agents, tasks, meetings, events] = await Promise.all([
        getJsonArray('/api/agents'),
        getJsonArray('/api/tasks'),
        getJsonArray('/api/meetings'),
        getJsonArray('/api/events'),
      ]);

      return `agents=${agents.length}, tasks=${tasks.length}, meetings=${meetings.length}, events=${events.length}`;
    }),
  );

  results.push(
    await runCheck('D03', 'Monitoring endpoints', async () => {
      const [metrics, alertsPayload, timeseries] = await Promise.all([
        getJson('/api/monitoring/metrics'),
        getJson('/api/monitoring/alerts'),
        getJson('/api/monitoring/timeseries?metric=task_success_rate&window=24h&interval=1h'),
      ]);

      assert(typeof metrics === 'object' && metrics !== null, 'metrics payload must be object');
      const alerts = (alertsPayload as AnyJson).alerts;
      assert(Array.isArray(alerts), 'monitoring.alerts payload must include alerts array');
      assert(Array.isArray((timeseries as AnyJson).points), 'timeseries.points must be array');
      return `alerts=${(alerts as unknown[]).length}, timeseries.points=${((timeseries as AnyJson).points as unknown[]).length}`;
    }),
  );

  results.push(
    await runCheck('D04', 'Chief chat smoke test', async () => {
      const payload = await postJson('/api/chief/chat', {
        message: '현재 상태 알려줘',
        sessionId: `qa-recheck-${Date.now()}`,
      });

      // demo mode => synchronous { reply }, llm mode => { status: 'processing' }
      const hasSyncReply = typeof payload.reply === 'string';
      const hasAsyncAck = payload.status === 'processing';
      assert(hasSyncReply || hasAsyncAck, 'expected sync reply or async processing ack');
      return hasSyncReply ? 'sync-reply' : 'async-processing';
    }),
  );

  results.push(
    await runCheck('D05', 'Agent create/delete round-trip', async () => {
      const created = await postJson('/api/agents', {
        name: `qa-recheck-dev-${Date.now()}`,
        role: 'developer',
        model: 'claude-sonnet-4',
      });

      const createdId = created.id;
      assert(typeof createdId === 'string' && createdId.length > 0, 'created agent id missing');

      await deleteReq(`/api/agents/${createdId}`);
      return `created-and-deleted=${createdId}`;
    }),
  );

  const endedAt = new Date().toISOString();
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;

  const report = [
    '# QA 재검증 보고서 (배포 후 검증)',
    '',
    '## 1) 실행 개요',
    `- 시작 시각: ${startedAt}`,
    `- 종료 시각: ${endedAt}`,
    `- 대상 서버: ${baseUrl}`,
    `- 총 점검 수: ${results.length}`,
    `- PASS: ${passCount}`,
    `- FAIL: ${failCount}`,
    '',
    '## 2) 점검 결과',
    '| ID | 항목 | 결과 | 소요(ms) | 상세 |',
    '|---|---|---|---:|---|',
    ...results.map((r) => `| ${r.id} | ${r.title} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.durationMs} | ${r.detail.replace(/\|/g, '\\|')} |`),
    '',
    '## 3) 판정',
    failCount === 0
      ? '- ✅ 배포 후 핵심 API/기능 재검증을 통과했습니다.'
      : '- ❌ 일부 점검 항목에서 실패가 발생했습니다. 상세 로그를 확인하고 재배포/핫픽스를 권장합니다.',
    '',
    '## 4) 후속 권장 작업',
    '- 실패 항목이 있으면 동일 스크립트를 수정 없이 재실행하여 회귀 여부를 확인하세요.',
    '- 운영 배포 파이프라인에 본 스크립트를 붙여 post-deploy gate로 사용하세요.',
    '- 필요 시 WebSocket 이벤트 수신 검증(브라우저/Playwright) 케이스를 추가하세요.',
    '',
  ].join('\n');

  console.log(report);
  await writeFile(outPath, report, 'utf8');
  console.log(`\n[qa] report saved: ${outPath}`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[qa] fatal:', error);
  process.exit(1);
});
