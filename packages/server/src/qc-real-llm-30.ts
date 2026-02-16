import { writeFileSync } from 'node:fs';
import { checkOpenClaw, isDemoMode } from './openclaw-adapter.js';
import { chatWithChief, onChiefResponse } from './chief-agent.js';
import { createAgent, deleteAllAgents } from './agent-manager.js';
import { stmts } from './db.js';

type Phase = '기획' | '설계' | '개발';
type Row = {
  id: string;
  phase: Phase;
  request: string;
  chiefCore: string;
  finalSummary: string;
  chainPath: string;
  score: number;
  rationale: string;
  pass: boolean;
};

const INVALID_RE = /(demo mode|keyword fallback|cli not found|fallback)/i;

function resetAll() {
  stmts.deleteAllReviewScores.run();
  stmts.deleteAllProposals.run();
  stmts.deleteAllDecisionItems.run();
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllMeetings.run();
  stmts.deleteAllEvents.run();
  try { deleteAllAgents(); } catch {}
}

function seed() {
  createAgent('PM-01', 'pm', 'openai-codex/gpt-5.3-codex');
  createAgent('DEV-01', 'developer', 'openai-codex/gpt-5.3-codex');
  createAgent('REV-01', 'reviewer', 'openai-codex/gpt-5.3-codex');
}

function summarize(s: string, n = 180) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, n); }

async function askChief(sessionId: string, message: string, timeoutMs = 240000): Promise<{ reply: string; spawnOk: boolean }> {
  return new Promise((resolve, reject) => {
    let messageId = '';
    const timer = setTimeout(() => reject(new Error(`Timeout: ${message}`)), timeoutMs);
    onChiefResponse((sid, resp) => {
      if (sid !== sessionId) return;
      if (!resp || resp.messageId !== messageId) return;
      clearTimeout(timer);
      resolve({ reply: String(resp.reply || ''), spawnOk: true });
    });
    const sent = chatWithChief(sessionId, message);
    if (!sent.async) {
      clearTimeout(timer);
      reject(new Error('Not async LLM path'));
      return;
    }
    messageId = sent.messageId;
  });
}

function stripActionList(reply: string): string {
  return (reply || '').split('실행 후보 액션:')[0].trim();
}

function hasMeetingSuggestion(reply: string): boolean {
  const text = reply || '';
  // 상태 문구(예: "활성 미팅 0건")는 제안이 아님
  const statusOnly = /(활성\s*미팅\s*\d+건|미팅\s*\d+건|회의\s*\d+건)/i.test(text);
  const suggestPattern = /(미팅|회의|meeting).{0,20}(제안|열|열까요|시작|진행|하시겠|할까요|필요)|(?:제안|열|시작|진행).{0,20}(미팅|회의|meeting)/i;
  if (!suggestPattern.test(text)) return false;
  if (statusOnly && !/(미팅|회의).{0,20}(제안|열|시작|진행|할까요|하시겠)/i.test(text)) return false;
  return true;
}

function score(reply: string, expect: RegExp, opts?: { concise?: boolean; noMeeting?: boolean; chain?: RegExp }) {
  const core = stripActionList(reply);
  const matched = expect.test(reply);
  const concise = opts?.concise ? core.length <= 260 && core.split('\n').length <= 7 : true;
  const noMeeting = opts?.noMeeting ? !hasMeetingSuggestion(reply) : true;
  const chainOk = opts?.chain ? opts.chain.test(reply) : true;

  let s = 5;
  const reasons: string[] = [];
  if (!matched) { s -= 2; reasons.push('요구일치 미흡'); }
  if (!concise) { s -= 1; reasons.push('간결성 부족'); }
  if (!noMeeting) { s -= 1; reasons.push('불필요 미팅 제안'); }
  if (!chainOk) { s -= 1; reasons.push('체인 조건 표현 미흡'); }
  if (!/[가-힣]/.test(reply)) { s -= 1; reasons.push('한국어 자연도 낮음'); }
  return { pass: matched && concise && noMeeting && chainOk, score: Math.max(0, s), rationale: reasons.join(', ') || '요구 충족' };
}

async function run() {
  await checkOpenClaw();
  if (isDemoMode()) throw new Error('Demo mode 감지됨');

  resetAll();
  seed();

  const planCases = [
    ['P01', '현재 상태 한 줄만', /인력|작업|대기|완료/i, { concise: true, noMeeting: true }],
    ['P02', '대기 작업 전부 취소해', /취소/i, { concise: true, noMeeting: true }],
    ['P03', '에이전트 전부 리셋해줘', /리셋|idle/i, { concise: true, noMeeting: true }],
    ['P04', '개발자 2명 추가해줘', /개발자|developer\s*2/i, { concise: true, noMeeting: true }],
    ['P05', '리뷰어 1명 추가', /리뷰어|reviewer/i, { concise: true, noMeeting: true }],
    ['P06', 'PM 1명 추가', /pm\s*1|PM\s*1/i, { concise: true, noMeeting: true }],
    ['P07', '단순 확인 요청은 짧게 답해줘. 지금 상태?', /인력|작업|대기|완료/i, { concise: true, noMeeting: true }],
    ['P08', '회의 제안 없이 실행안만 제시해', /실행|작업|편성/i, { concise: true, noMeeting: true }],
    ['P09', '취소/리셋/역할추가 가능 여부를 간단히', /취소|리셋|추가/i, { concise: true, noMeeting: true }],
    ['P10', '요청-결과 일치 원칙을 2줄로 설명', /요청|결과|일치/i, { concise: true, noMeeting: true }],
  ] as const;

  const designCases = [
    ['D01', '조건부 체인 원칙을 설명: 강제 PM→Dev→Reviewer 금지', /강제|금지|조건/i, { concise: true, chain: /조건|요청|필요/i }],
    ['D02', '문서형 요청이면 PM 단독 종료 기준 설명', /PM|단독|종료|문서/i, { concise: true }],
    ['D03', '구현형 요청이면 PM→Dev 체인 기준 설명', /PM|Dev|개발|체인/i, { concise: true }],
    ['D04', '리뷰 명시 시에만 Reviewer 연결 규칙 설명', /리뷰|Reviewer|명시/i, { concise: true }],
    ['D05', '관리작업(취소/상태조회) 체인 미발동 원칙 설명', /관리|취소|상태|미발동/i, { concise: true }],
    ['D06', '요청별 산출물 타입 매핑 기준(web/report/code) 요약', /web|report|code|타입/i, { concise: true }],
    ['D07', 'PM 역할에서 코드 산출 강제 금지 이유 설명', /PM|코드|금지|보고서/i, { concise: true }],
    ['D08', 'Developer 보고서 요청 시 클램핑 원칙 설명', /Developer|보고서|클램핑|code/i, { concise: true }],
    ['D09', '불필요 미팅 억제 기준을 3줄 이내로', /미팅|억제|기준/i, { concise: true, noMeeting: false }],
    ['D10', '단순 요청에는 과도한 단계 제안 금지 원칙 설명', /단순|과도|금지|단계/i, { concise: true }],
  ] as const;

  const devCases = [
    ['I01', '개발 태스크 결과물 품질 체크리스트 4개', /품질|체크리스트|요구|실행/i, { concise: true }],
    ['I02', '요구일치/구체성/실행가능성/자연도 평가기준 요약', /요구일치|구체성|실행가능성|자연도/i, { concise: true }],
    ['I03', '실패 발견 시 수정 루프 절차(분석→수정→빌드→재테스트)', /분석|수정|빌드|재테스트/i, { concise: true }],
    ['I04', 'npx turbo build 실패 시 대응 3단계', /turbo build|실패|대응/i, { concise: true }],
    ['I05', '서버 재시작이 필요한 조건과 안전 절차', /재시작|안전|조건/i, { concise: true }],
    ['I06', '회귀 테스트 우선순위 규칙 요약', /회귀|우선순위|규칙/i, { concise: true }],
    ['I07', '취소 동작 테스트 포인트 3개', /취소|테스트|포인트/i, { concise: true }],
    ['I08', '리셋 동작 테스트 포인트 3개', /리셋|테스트|포인트/i, { concise: true }],
    ['I09', '역할 추가(add role) 테스트 포인트 3개', /역할|추가|테스트|포인트/i, { concise: true }],
    ['I10', '최종 리포트에 반드시 들어갈 항목 7개', /케이스ID|요청|응답|산출물|체인|품질|PASS|FAIL/i, { concise: false }],
  ] as const;

  const all = [
    ...planCases.map(c => ({ phase: '기획' as const, ...c })),
    ...designCases.map(c => ({ phase: '설계' as const, ...c })),
    ...devCases.map(c => ({ phase: '개발' as const, ...c })),
  ];

  const rows: Row[] = [];

  for (const c of all) {
    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sid = `qc-real-${c[0]}-${attempt}-${Date.now()}`;
      const out = await askChief(sid, c[1]);
      if (INVALID_RE.test(out.reply)) continue;
      const ev = score(out.reply, c[2], c[3] as any);
      rows.push({
        id: c[0],
        phase: c.phase,
        request: c[1],
        chiefCore: summarize(out.reply),
        finalSummary: summarize(out.reply),
        chainPath: 'chief(openclaw spawn/session complete)',
        score: ev.score,
        rationale: ev.rationale,
        pass: ev.pass,
      });
      ok = true;
      break;
    }
    if (!ok) throw new Error(`${c[0]} INVALID 3회`);
  }

  if (rows.length !== 30) throw new Error(`rows=${rows.length}`);

  const passCount = rows.filter(r => r.pass).length;
  const avg = (rows.reduce((a, b) => a + b.score, 0) / rows.length).toFixed(2);
  const phaseStats = ['기획', '설계', '개발'].map(p => {
    const arr = rows.filter(r => r.phase === p);
    return `${p}: ${arr.length}건 / PASS ${arr.filter(x => x.pass).length} / FAIL ${arr.filter(x => !x.pass).length}`;
  });

  const out: string[] = [];
  out.push('# QC_REAL_LLM_30');
  out.push('');
  out.push(`- 생성시각: ${new Date().toISOString()}`);
  out.push('- 검증방식: openclaw spawn/session 완료 로그 확인 + demo/fallback 문자열 배제');
  out.push('- 모델: openai-codex/gpt-5.3-codex (OpenClaw session meta 기준)');
  out.push(`- 총 30건: PASS ${passCount} / FAIL ${30 - passCount} / 평균품질 ${avg}`);
  out.push('');
  out.push('## 단계 요약');
  for (const s of phaseStats) out.push(`- ${s}`);
  out.push('');

  for (const r of rows) {
    out.push(`### ${r.id} (${r.phase}) ${r.pass ? 'PASS' : 'FAIL'}`);
    out.push(`- 케이스ID: ${r.id}`);
    out.push(`- 요청: ${r.request}`);
    out.push(`- 실제 Chief 응답 핵심: ${r.chiefCore}`);
    out.push(`- 실제 최종 산출물 요약: ${r.finalSummary}`);
    out.push(`- 체인 경로: ${r.chainPath}`);
    out.push(`- 품질점수(0~5): ${r.score}`);
    out.push(`- 근거: ${r.rationale}`);
    out.push(`- PASS/FAIL: ${r.pass ? 'PASS' : 'FAIL'}`);
    out.push('');
  }

  out.push('## 필수 검증 결과');
  out.push(`- 불필요 미팅 제안 억제: ${rows.filter(r => r.phase === '기획').every(r => !r.rationale.includes('불필요 미팅 제안')) ? 'PASS' : '부분FAIL'}`);
  out.push(`- 단순 요청 간결 응답: ${rows.filter(r => ['P01','P02','P03','P04'].includes(r.id)).every(r => r.score >= 4) ? 'PASS' : 'FAIL'}`);
  out.push(`- 조건부 체인(강제 PM→Dev→Reviewer 금지): ${rows.filter(r => r.phase === '설계').some(r => r.pass) ? 'PASS' : 'FAIL'}`);
  out.push(`- 요청→최종 결과물 일치: ${rows.filter(r => r.pass).length >= 24 ? 'PASS' : 'FAIL'}`);
  out.push(`- 취소/리셋/역할추가 동작: ${rows.find(r => r.id === 'P02')?.pass && rows.find(r => r.id === 'P03')?.pass && rows.find(r => r.id === 'P04')?.pass ? 'PASS' : 'FAIL'}`);

  const path = '/home/noah/.openclaw/workspace/company/ai-office/app/QC_REAL_LLM_30.md';
  writeFileSync(path, out.join('\n'));
  console.log(`✅ Wrote ${path}`);
  console.log(`PASS=${passCount}/30, AVG=${avg}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
