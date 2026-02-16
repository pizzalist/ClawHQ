import { WebSocket } from 'ws';
import fs from 'fs/promises';

const BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws';
const OUT = '/home/noah/.openclaw/workspace/company/ai-office/app/QC_REAL_LLM_10_SAMPLES.md';

const CASES = [
  { id: 'P1', category: '기획', request: '2주 내 출시 가능한 AI 회의록 SaaS MVP 기획안을 작성하고 작업으로 생성해줘. 핵심 기능/범위/리스크/일정 포함.' },
  { id: 'P2', category: '기획', request: '사내 문서 검색 챗봇 도입을 위한 비용-효과 분석 보고서를 작업으로 생성해줘. 가정, ROI, 우선순위 포함.' },
  { id: 'P3', category: '기획', request: '고객 이탈률 감소를 위한 90일 실행 로드맵을 작업으로 생성해줘. 목표지표와 실험안 포함.' },

  { id: 'D1', category: '설계', request: 'B2B 결재 시스템의 마이크로서비스 아키텍처 설계 문서를 작업으로 생성해줘. 컴포넌트, 데이터흐름, 장애대응 포함.' },
  { id: 'D2', category: '설계', request: '모바일 금융 앱 온보딩 UX 설계안(화면 흐름, 상태, 오류 처리)을 작업으로 생성해줘.' },
  { id: 'D3', category: '설계', request: '실시간 알림 플랫폼의 API 설계 초안을 작업으로 생성해줘. 엔드포인트/스키마/버전전략 포함.' },

  { id: 'DEV1', category: '개발', request: 'React + TypeScript로 다크모드 토글 가능한 간단한 TODO 앱 구현 작업을 생성해줘. 코드 리뷰까지 포함.' },
  { id: 'DEV2', category: '개발', request: 'Node.js로 입력 URL의 메타 태그(title,description) 추출기 구현 작업을 생성해줘. 테스트와 리뷰 포함.' },
  { id: 'DEV3', category: '개발', request: 'Python으로 CSV 요약 CLI(행수, 결측치, 컬럼 통계) 구현 작업을 생성해줘. 리뷰 포함.' },
  { id: 'DEV4', category: '개발', request: 'Express 기반 health/check + metrics 엔드포인트 샘플 서버 구현 작업을 생성해줘. 코드 리뷰까지 진행.' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jfetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

function connectWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function waitChiefResponse(ws, messageId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`chief_response timeout: ${messageId}`));
    }, timeoutMs);

    function onMsg(buf) {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'chief_response' && msg.payload?.messageId === messageId) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg.payload);
        }
      } catch {}
    }

    ws.on('message', onMsg);
  });
}

async function waitTaskDone(taskId, timeoutMs = 600000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const t = await jfetch(`/api/tasks/${taskId}`);
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') return t;
    await sleep(2500);
  }
  throw new Error(`task timeout: ${taskId}`);
}

function summarize(text, max = 260) {
  if (!text) return '(없음)';
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}...` : one;
}

function score(task, chiefReply) {
  const r = String(task?.result || '');
  const hasKorean = /[가-힣]/.test((chiefReply || '') + r);
  const reqMatch = (r.length > 80) ? '상' : (r.length > 30 ? '중' : '하');
  const specific = /\b(1\.|2\.|##|```|API|테스트|리스크|일정|요약)\b/i.test(r) ? '상' : '중';
  const useful = r.length > 120 ? '상' : '중';
  return {
    요구일치: reqMatch,
    구체성: specific,
    유용성: useful,
    한국어: hasKorean ? '상' : '중',
  };
}

async function run() {
  const health = await jfetch('/api/health');
  if (health.demoMode) throw new Error('demoMode=true 이므로 중단');

  await jfetch('/api/admin/reset', { method: 'POST', body: '{}' });

  const ws = await connectWS();
  const sessionId = `qc-real-llm-${Date.now()}`;

  const results = [];

  for (const c of CASES) {
    const caseStart = Date.now();
    const chat = await jfetch('/api/chief/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId, message: c.request }),
    });

    const isAsync = chat.async === true || chat.status === 'processing';
    if (!isAsync) {
      results.push({
        ...c,
        excluded: true,
        reason: 'chief chat 비동기 처리 아님 (fallback/keyword 가능성)',
      });
      continue;
    }

    const chief = await waitChiefResponse(ws, chat.messageId);
    const chiefReply = chief.reply || '';

    if (/Demo mode/i.test(chiefReply)) {
      results.push({ ...c, excluded: true, reason: 'Chief reply demo mode 문구 감지' });
      continue;
    }

    const actions = chief.actions || [];
    const idx = actions.findIndex(a => a.type === 'create_task');
    if (idx < 0) {
      results.push({ ...c, excluded: true, reason: 'create_task 액션 없음' });
      continue;
    }

    const approved = await jfetch('/api/chief/proposal/approve', {
      method: 'POST',
      body: JSON.stringify({ messageId: chief.messageId, selectedIndices: [idx] }),
    });

    const created = (approved.executedActions || [])[0]?.result?.id;
    if (!created) {
      results.push({ ...c, excluded: true, reason: 'task id 확보 실패' });
      continue;
    }

    const done = await waitTaskDone(created);
    const chain = await jfetch(`/api/tasks/${created}/chain`);

    const roles = [];
    const rootAgentId = done.assigneeId;
    if (rootAgentId) {
      const agents = await jfetch('/api/agents');
      const m = new Map(agents.map(a => [a.id, a.role]));
      const rootRole = m.get(rootAgentId);
      if (rootRole) roles.push(rootRole);
      for (const ch of chain) {
        const rr = m.get(ch.assigneeId);
        if (rr) roles.push(rr);
      }
    }

    const elapsedSec = Math.round((Date.now() - caseStart) / 1000);
    const q = score(done, chiefReply);

    results.push({
      ...c,
      excluded: false,
      chiefReply,
      task: done,
      chainRoles: roles,
      quality: q,
      elapsedSec,
    });

    await sleep(1500);
  }

  ws.close();

  const valid = results.filter(r => !r.excluded && r.task?.status === 'completed' && !/Demo mode/i.test(r.task?.result || ''));

  const byCat = {
    기획: valid.filter(v => v.category === '기획').slice(0, 3),
    설계: valid.filter(v => v.category === '설계').slice(0, 3),
    개발: valid.filter(v => v.category === '개발').slice(0, 4),
  };

  const selected = [...byCat.기획, ...byCat.설계, ...byCat.개발].slice(0, 10);

  let md = `# QC REAL LLM 10 SAMPLES\n\n`;
  md += `- 실행 시각: ${new Date().toISOString()}\n`;
  md += `- Health demoMode: ${health.demoMode}\n`;
  md += `- 총 실행: ${results.length}건\n`;
  md += `- 유효(완료+실LLM): ${valid.length}건\n`;
  md += `- 최종 선별: ${selected.length}건 (기획 ${byCat.기획.length}/3, 설계 ${byCat.설계.length}/3, 개발 ${byCat.개발.length}/4)\n\n`;

  if (selected.length < 10) {
    md += `> ⚠️ 경고: 요구한 10건을 모두 채우지 못했습니다. 제외 사유를 확인하세요.\n\n`;
  }

  let n = 1;
  for (const s of selected) {
    md += `## ${n}. [${s.category}] ${s.id}\n`;
    md += `- 요청: ${s.request}\n`;
    md += `- 실제 Chief 응답(핵심): ${summarize(s.chiefReply, 350)}\n`;
    md += `- 실제 최종 산출물 요약: ${summarize(s.task?.result, 380)}\n`;
    md += `- 체인 경로(pm/dev/reviewer): ${s.chainRoles?.join(' → ') || '(미상)'}\n`;
    md += `- 품질평가: 요구일치 ${s.quality?.요구일치}, 구체성 ${s.quality?.구체성}, 유용성 ${s.quality?.유용성}, 한국어 ${s.quality?.한국어}\n`;
    md += `- 상태/소요: ${s.task?.status}, ${s.elapsedSec}s\n\n`;
    n++;
  }

  md += `---\n\n## 제외/실패 케이스\n`;
  const excluded = results.filter(r => r.excluded || r.task?.status !== 'completed' || /Demo mode/i.test(r.task?.result || ''));
  if (excluded.length === 0) {
    md += `- 없음\n`;
  } else {
    for (const e of excluded) {
      md += `- [${e.category}] ${e.id}: ${e.reason || `status=${e.task?.status}` }\n`;
    }
  }

  await fs.writeFile(OUT, md, 'utf-8');
  console.log(JSON.stringify({ ok: true, out: OUT, total: results.length, valid: valid.length, selected: selected.length }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
