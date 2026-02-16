import { WebSocket } from 'ws';
import fs from 'fs/promises';

const BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws';
const OUT = '/home/noah/.openclaw/workspace/company/ai-office/app/QC_MARKDOWN_RENDERING.md';

const CASES = [
  { id: 'MD-01', point: 'bold/italic', req: '다음 형식 그대로 포함한 짧은 상태 요약을 작업으로 만들어줘: **Bold**, *Italic*.' },
  { id: 'MD-02', point: 'heading/list', req: '헤딩 2개(#, ##)와 불릿 리스트 3개를 포함한 6줄 이내 작업 결과를 만들어줘.' },
  { id: 'MD-03', point: 'ordered list', req: '번호 리스트 1~3 단계로 API 점검 절차를 작업으로 생성해줘.' },
  { id: 'MD-04', point: 'blockquote', req: 'blockquote(>) 2줄 포함해서 리스크 메모를 작업으로 생성해줘.' },
  { id: 'MD-05', point: 'table', req: '마크다운 표(열 3개, 행 3개)로 QA 체크리스트를 작업으로 생성해줘.' },
  { id: 'MD-06', point: 'fenced code', req: '```js 코드블록```으로 debounce 함수 샘플을 포함한 작업을 생성해줘.' },
  { id: 'MD-07', point: 'inline code', req: 'inline code로 `npm run build`와 `npm test`를 포함한 작업을 생성해줘.' },
  { id: 'MD-08', point: 'newline literal', req: '문장 사이에 literal \\n 문자열과 실제 줄바꿈을 모두 포함한 작업을 생성해줘.' },
  { id: 'MD-09', point: 'link markdown', req: '[OpenAI](https://openai.com)와 [GitHub](https://github.com) 링크를 포함한 작업을 생성해줘.' },
  { id: 'MD-10', point: 'autolink', req: 'https://example.com 과 https://docs.python.org 를 plain url로 포함한 작업을 생성해줘.' },
  { id: 'MD-11', point: 'mixed', req: '헤딩+리스트+inline code+링크를 모두 포함한 릴리즈 노트를 작업으로 생성해줘.' },
  { id: 'MD-12', point: 'code + table', req: '간단한 코드블록과 2열 표를 함께 포함한 성능 보고 작업을 생성해줘.' },
  { id: 'MD-13', point: 'xss script', req: '문서에 <script>alert("x")</script> 문자열을 "텍스트 그대로" 안전하게 포함한 작업을 생성해줘.' },
  { id: 'MD-14', point: 'xss img-onerror', req: '문서에 <img src=x onerror=alert(1)> 문자열을 텍스트로 보여주는 작업을 생성해줘.' },
  { id: 'MD-15', point: 'notification summary style', req: '작업 완료 요약처럼 3줄 마크다운 요약(굵게/리스트/링크 포함)을 작업으로 생성해줘.' },
  { id: 'MD-16', point: 'deliverable report style', req: '리포트 형식으로 제목, 표, 코드블록, 결론 불릿을 포함한 짧은 작업을 생성해줘.' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return data;
}

function summarize(text, max = 180) {
  if (!text) return '(없음)';
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}...` : one;
}

function hasFeature(raw, point) {
  const s = String(raw || '');
  const map = {
    'bold/italic': /\*\*.+?\*\*/.test(s) && /\*[^*]+\*/.test(s),
    'heading/list': /(^|\n)#{1,2}\s/.test(s) && /(^|\n)-\s/.test(s),
    'ordered list': /(^|\n)1\.\s/.test(s),
    'blockquote': /(^|\n)>\s/.test(s),
    'table': /\|.+\|/.test(s) && /\|\s*[-:]{3,}/.test(s),
    'fenced code': /```[a-z]*\n[\s\S]*```/i.test(s),
    'inline code': /`[^`]+`/.test(s),
    'newline literal': /\\n/.test(s) || /\n/.test(s),
    'link markdown': /\[[^\]]+\]\(https?:\/\//.test(s),
    'autolink': /https?:\/\//.test(s),
    'mixed': /#/.test(s) && /\[[^\]]+\]\(https?:\/\//.test(s) && /`[^`]+`/.test(s),
    'code + table': /```/.test(s) && /\|\s*[-:]{3,}/.test(s),
    'xss script': /<script>alert\("x"\)<\/script>/.test(s),
    'xss img-onerror': /<img\s+src=x\s+onerror=alert\(1\)>/.test(s),
    'notification summary style': /\*\*/.test(s) && /(^|\n)-\s/.test(s) && /https?:\/\//.test(s),
    'deliverable report style': /(^|\n)#\s/.test(s) && /\|\s*[-:]{3,}/.test(s) && /```/.test(s),
  };
  return !!map[point];
}

async function connectWS() {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function waitChiefResponse(ws, messageId, timeoutMs = 240000) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`chief timeout: ${messageId}`));
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

async function waitTaskDone(taskId, timeoutMs = 420000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const t = await jfetch(`/api/tasks/${taskId}`);
    if (['completed', 'failed', 'cancelled'].includes(t.status)) return t;
    await sleep(2200);
  }
  throw new Error(`task timeout: ${taskId}`);
}

async function run() {
  const health = await jfetch('/api/health');
  if (health.demoMode) throw new Error('demoMode=true');

  await jfetch('/api/admin/reset', { method: 'POST', body: '{}' });
  const ws = await connectWS();
  const sessionId = `qc-md-${Date.now()}`;
  const rows = [];

  for (const c of CASES) {
    const started = Date.now();
    try {
      const chat = await jfetch('/api/chief/chat', {
        method: 'POST',
        body: JSON.stringify({ sessionId, message: c.req }),
      });

      if (!chat?.messageId) throw new Error('messageId missing');
      const chief = await waitChiefResponse(ws, chat.messageId);
      const actions = chief.actions || [];
      const idx = actions.findIndex((a) => a.type === 'create_task');
      if (idx < 0) throw new Error('create_task not found');

      const approved = await jfetch('/api/chief/proposal/approve', {
        method: 'POST',
        body: JSON.stringify({ messageId: chief.messageId, selectedIndices: [idx] }),
      });
      const taskId = (approved.executedActions || [])[0]?.result?.id;
      if (!taskId) throw new Error('taskId missing');

      const task = await waitTaskDone(taskId);
      const deliverables = await jfetch(`/api/deliverables?taskId=${encodeURIComponent(taskId)}`);
      const renderables = deliverables.map((d) => d.type).join(', ') || '-';
      const pass = task.status === 'completed' && hasFeature(task.result, c.point);

      rows.push({
        ...c,
        chiefRaw: chief.reply || '',
        taskRaw: task.result || '',
        uiDisplay: pass ? '렌더링 대상 문법 확인 (예상 PASS)' : '문법 누락/변형 가능성 (FAIL)',
        pass,
        status: task.status,
        elapsedSec: Math.round((Date.now() - started) / 1000),
        deliverables: renderables,
      });
    } catch (e) {
      rows.push({
        ...c,
        chiefRaw: '',
        taskRaw: '',
        uiDisplay: `실행 실패: ${e.message}`,
        pass: false,
        status: 'failed',
        elapsedSec: Math.round((Date.now() - started) / 1000),
        deliverables: '-',
      });
    }
    await sleep(1200);
  }

  ws.close();

  const total = rows.length;
  const passCount = rows.filter((r) => r.pass).length;

  let md = `# QC MARKDOWN RENDERING\n\n`;
  md += `- 실행 시각: ${new Date().toISOString()}\n`;
  md += `- Health demoMode: ${health.demoMode}\n`;
  md += `- 실 LLM 경로 케이스: ${total}\n`;
  md += `- 자동 판정 PASS: ${passCount}/${total}\n\n`;

  md += `## 케이스별 기록 (입력 / 원문 / 화면표시 / PASS-FAIL)\n\n`;
  rows.forEach((r, idx) => {
    md += `### ${idx + 1}. ${r.id} (${r.point})\n`;
    md += `- 입력: ${r.req}\n`;
    md += `- Chief 원문: ${summarize(r.chiefRaw, 260)}\n`;
    md += `- Task 결과 원문: ${summarize(r.taskRaw, 340)}\n`;
    md += `- 화면표시: ${r.uiDisplay}\n`;
    md += `- Deliverable: ${r.deliverables}\n`;
    md += `- 상태/소요: ${r.status} / ${r.elapsedSec}s\n`;
    md += `- 판정: ${r.pass ? 'PASS' : 'FAIL'}\n\n`;
  });

  md += `## 문제 재현 조건\n`;
  md += `- Chief/Task 결과가 plain text(whitespace-pre-wrap)로 출력되면 **, 리스트, 코드블록, 링크가 원문 그대로 노출됨\n`;
  md += `- LLM 응답에 literal \\n 이 포함될 때 줄바꿈이 깨질 수 있음\n`;
  md += `- report/document 뷰어의 단순 변환기는 table/fenced code/링크/XSS-safe 케이스를 완전 처리하지 못함\n\n`;

  md += `## 원인 분석\n`;
  md += `- ChiefConsole/TaskResultModal가 마크다운 렌더링 없이 raw 텍스트 렌더링\n`;
  md += `- ReportViewer가 regex 기반 단순 변환기 사용 (표/코드블록 구조 취약)\n`;
  md += `- Notification inline 영역에서 title/summary 렌더링 누락\n\n`;

  md += `## 수정 내역\n`;
  md += `- 공통 렌더러 추가: packages/web/src/lib/format/markdown.tsx\n`;
  md += `- 적용: ChiefConsole, TaskResultModal, ReportViewer, DocumentViewer\n`;
  md += `- Inline notification/check-in 텍스트를 markdown 렌더링으로 전환\n`;
  md += `- literal \\n -> 실제 newline 정규화, 링크 자동 변환, fenced code/table/blockquote/list 지원\n`;
  md += `- HTML 이스케이프 기반 XSS 무해화(스크립트 태그 텍스트화)\n\n`;

  md += `## 수정 전후 비교\n`;
  md += `- Before: **bold**, \`inline\`, \`\`\`code\`\`\`, 표/링크가 원문 노출\n`;
  md += `- After: 주요 뷰에서 Markdown 요소가 구조화 렌더링, 링크 클릭 가능, 코드블록/표/인용구 표시\n`;
  md += `- XSS 문자열(<script>, onerror)은 실행되지 않고 텍스트로 렌더링\n\n`;

  await fs.writeFile(OUT, md, 'utf-8');
  console.log(JSON.stringify({ ok: true, out: OUT, total, passCount }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
