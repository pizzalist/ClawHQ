import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = '/home/noah/.openclaw/workspace/company/ai-office/app';
const OUT_E2E = `${APP}/QC_NOAH_STYLE_E2E.md`;
const OUT_BUGS = `${APP}/QC_NOAH_STYLE_BUGS.md`;

const CASES = [
  // 1) 조회성 질문에서 create_task 제안 금지
  { id:'N01', cat:'조회', steps:['현재 진행/대기/완료 개수만 알려줘.'], rule:'NO_CREATE_TASK' },
  { id:'N02', cat:'조회', steps:['방금 상태를 한 줄로 다시 말해줘.'], rule:'NO_CREATE_TASK' },
  { id:'N03', cat:'조회', steps:['지금 뭐가 막혀있는지 조회만 해줘. 실행 제안은 하지마.'], rule:'NO_CREATE_TASK' },
  { id:'N04', cat:'조회', steps:['오늘 완료된 일만 요약해줘.'], rule:'NO_CREATE_TASK' },
  { id:'N05', cat:'조회', steps:['실패 태스크 목록이 있는지 확인만 해줘.'], rule:'NO_CREATE_TASK' },

  // 2) 승인 후 피드백 일관
  { id:'N06', cat:'승인피드백', steps:[
    '랜딩페이지 초안 만들어줘. 먼저 승인 대기 형태로 보여줘.',
    '승인',
    '진행중이야?',
    '언제줘?',
    '상태 재확인'
  ], rule:'APPROVAL_FEEDBACK' },
  { id:'N07', cat:'승인피드백', steps:[
    '고객 인터뷰 질문지 10개 준비해줘. 승인 대기로.',
    '승인',
    '진행중이야?',
    '상태 재확인'
  ], rule:'APPROVAL_FEEDBACK' },
  { id:'N08', cat:'승인피드백', steps:[
    '버그 리포트 템플릿 만들어줘. 승인 문구 먼저.',
    '승인',
    '언제줘?'
  ], rule:'APPROVAL_FEEDBACK' },
  { id:'N09', cat:'승인피드백', steps:[
    '주간 보고서 초안 작성해줘. 승인 대기 후 진행.',
    '승인',
    '진행중이야?'
  ], rule:'APPROVAL_FEEDBACK' },
  { id:'N10', cat:'승인피드백', steps:[
    'API 명세 v1 정리해줘. 승인 후 실행.',
    '승인',
    '상태 재확인'
  ], rule:'APPROVAL_FEEDBACK' },

  // 3) 다중 액션 자동 순차 진행 + 안내
  { id:'N11', cat:'다중액션', steps:['PM 1명 추가하고, 개발자 1명 추가하고, 테스트 태스크 1개 생성까지 순서대로 진행해줘.'], rule:'MULTI_ACTION_SEQ' },
  { id:'N12', cat:'다중액션', steps:['대기 작업 정리하고, 실패 작업 요약하고, 다음 우선순위 3개 제안해줘.'], rule:'MULTI_ACTION_SEQ' },
  { id:'N13', cat:'다중액션', steps:['요구사항 정리 -> QA 체크리스트 -> 개발 전달 문안까지 한 번에 해줘.'], rule:'MULTI_ACTION_SEQ' },
  { id:'N14', cat:'다중액션', steps:['백로그 정리하고, 오늘 할 일 3개 뽑고, 완료 기준까지 적어줘.'], rule:'MULTI_ACTION_SEQ' },
  { id:'N15', cat:'다중액션', steps:['리뷰 코멘트 요약 후, 수정요청 초안 만들고, 재확정 메시지까지 준비해줘.'], rule:'MULTI_ACTION_SEQ' },

  // 4) QA->Dev 흐름 추천+확정 체인
  { id:'N16', cat:'QADev체인', steps:[
    'QC 붙여서 리뷰하고 개발자가 반영하는 흐름으로 진행안 줘.',
    '좋아, 그 체인으로 진행해.',
    '개발 반영됐는지 상태 재확인'
  ], rule:'QA_DEV_CHAIN' },
  { id:'N17', cat:'QADev체인', steps:[
    '기능 초안 만들고 QA 리뷰 거쳐 dev 반영까지 추천 플로우 제안해줘.',
    '확정. 그대로 진행.',
    '언제줘?'
  ], rule:'QA_DEV_CHAIN' },
  { id:'N18', cat:'QADev체인', steps:[
    'QA 먼저 보고 dev는 필요하면 반영하는 방식으로 해줘. 강제는 말고.',
    '확정',
    '상태 재확인'
  ], rule:'QA_DEV_CHAIN' },
  { id:'N19', cat:'QADev체인', steps:[
    '리뷰 체인을 추천형으로만 안내해줘. 바로 강제 실행은 하지마.',
    '승인',
    '진행중이야?'
  ], rule:'QA_DEV_CHAIN' },

  // 5) 테스트용 에이전트 명칭 노출 금지
  { id:'N20', cat:'명칭노출', steps:['테스트 모드로 돌리되 사용자에게 테스트용 에이전트 이름은 보이지 않게 설명해줘.'], rule:'HIDE_TEST_AGENT_NAME' },
  { id:'N21', cat:'명칭노출', steps:['QC 자동화 담당 이름 같은 내부 식별자는 노출하지 말고 상태만 말해줘.'], rule:'HIDE_TEST_AGENT_NAME' },
  { id:'N22', cat:'명칭노출', steps:['내부 테스트 워커명이 있으면 가리고 사용자용 결과만 보여줘.'], rule:'HIDE_TEST_AGENT_NAME' },

  // 6) 게임/web 실행 가능성 + 빈 화면 탐지/경고
  { id:'N23', cat:'게임실행', steps:['게임 만들어줘. 그리고 실행 확인할 때 빈 화면이면 경고까지 해줘.'], rule:'GAME_BLANK_WARNING' },
  { id:'N24', cat:'게임실행', steps:['웹 데모 하나 만들어줘. 실행 안 되거나 빈 화면이면 체크리스트로 알려줘.'], rule:'GAME_BLANK_WARNING' },
  { id:'N25', cat:'게임실행', steps:['간단한 브라우저 게임 결과 검증 절차를 사용자용으로 안내해줘(빈 화면 탐지 포함).'], rule:'GAME_BLANK_WARNING' },
];

function run(sessionId, message) {
  const raw = execFileSync('openclaw', [
    'agent', '--session-id', sessionId, '--message', message, '--json', '--local'
  ], {
    encoding: 'utf8',
    cwd: APP,
    timeout: 70000,
    maxBuffer: 25 * 1024 * 1024
  });

  const j = JSON.parse(raw);
  const text = (j.payloads || []).map(p => p.text || '').join('\n').trim();
  const meta = j.meta?.agentMeta || {};
  return {
    text,
    provider: meta.provider || 'unknown',
    model: meta.model || 'unknown',
    durationMs: j.meta?.durationMs || 0,
    llmOk: !!(meta.provider && meta.model) && !/demo mode|fallback/i.test(text)
  };
}

const RX = {
  createTask: /(create[_-]?task|태스크\s*생성|작업\s*생성|새\s*작업\s*만들)/i,
  approved: /(승인됨|승인\s*완료|승인\s*처리)/i,
  running: /(실행\s*중|진행\s*중|처리\s*중)/i,
  done: /(완료|끝났|결과\s*준비|전달\s*완료)/i,
  nextStep: /(다음\s*단계|다음\s*액션|다음\s*진행)/i,
  seqCue: /(1\.|2\.|3\.|먼저|다음|이후|마지막|순서)/i,
  qaDev: /(QA|품질|리뷰).*(개발|dev)|(개발|dev).*(QA|리뷰)/i,
  recommendNotForce: /(추천|권장|선택|확정\s*시|원하면|강제\s*아님|강제가\s*아님)/i,
  testAgent: /(test agent|테스트\s*에이전트|qc-agent|mock-agent|dummy-agent|자동화\s*워커\s*명)/i,
  gameWarn: /(빈\s*화면|white\s*screen|blank\s*screen|렌더링\s*실패|콘솔\s*에러|경고)/i,
};

function short(t, n=260) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0,n)}...` : s;
}

function evaluate(rule, turns) {
  const allText = turns.map(t => t.text).join('\n');
  const llmAllOk = turns.every(t => t.llmOk);
  let pass = llmAllOk;
  const notes = [];

  if (!llmAllOk) notes.push('실 LLM 경로(meta.provider/model) 또는 demo/fallback 검증 실패');

  if (rule === 'NO_CREATE_TASK') {
    if (RX.createTask.test(allText)) {
      pass = false;
      notes.push('조회성 질문에 create_task/작업생성 제안 노출');
    }
  }

  if (rule === 'APPROVAL_FEEDBACK') {
    const hasApproved = RX.approved.test(allText);
    const hasRunning = RX.running.test(allText);
    const hasDone = RX.done.test(allText);
    const hasNext = RX.nextStep.test(allText);
    if (!(hasApproved && hasRunning && (hasDone || hasNext))) {
      pass = false;
      notes.push('승인 후 피드백(승인됨/실행중/완료/다음단계) 일관 노출 부족');
    }
  }

  if (rule === 'MULTI_ACTION_SEQ') {
    if (!RX.seqCue.test(allText)) {
      pass = false;
      notes.push('다중 액션 순차 진행 안내 신호 부족(먼저/다음/번호 등)');
    }
  }

  if (rule === 'QA_DEV_CHAIN') {
    if (!RX.qaDev.test(allText) || !RX.recommendNotForce.test(allText)) {
      pass = false;
      notes.push('QA->Dev 흐름이 추천+확정 체인으로 충분히 표현되지 않음');
    }
  }

  if (rule === 'HIDE_TEST_AGENT_NAME') {
    if (RX.testAgent.test(allText)) {
      pass = false;
      notes.push('테스트용 에이전트 명칭 노출 감지');
    }
  }

  if (rule === 'GAME_BLANK_WARNING') {
    if (!RX.gameWarn.test(allText)) {
      pass = false;
      notes.push('게임/web 결과 실행 가능성 점검 또는 빈 화면 경고 부족');
    }
  }

  return { pass, notes: notes.length ? notes : ['이상 없음'] };
}

const results = [];

for (const c of CASES) {
  const sessionId = `qc-noah-${c.id.toLowerCase()}-${Date.now()}`;
  const turns = [];
  process.stdout.write(`RUN ${c.id} (${c.steps.length} turns)... `);
  for (const msg of c.steps) {
    try {
      turns.push(run(sessionId, msg));
      process.stdout.write('✓');
    } catch (e) {
      turns.push({
        text: String(e?.message || e),
        provider: 'unknown',
        model: 'unknown',
        durationMs: 0,
        llmOk: false
      });
      process.stdout.write('✗');
      break;
    }
  }
  const judge = evaluate(c.rule, turns);
  results.push({ ...c, turns, judge });
  console.log(` ${judge.pass ? 'PASS' : 'FAIL'}`);
}

const total = results.length;
const passCount = results.filter(r => r.judge.pass).length;
const fail = results.filter(r => !r.judge.pass);

const byReq = {
  '1) 조회성 질문에서 create_task 제안 금지': results.filter(r => r.rule==='NO_CREATE_TASK'),
  '2) 승인 후 채팅 피드백 일관 노출': results.filter(r => r.rule==='APPROVAL_FEEDBACK'),
  '3) 다중 액션 자동 순차 진행 + 안내': results.filter(r => r.rule==='MULTI_ACTION_SEQ'),
  '4) QA->Dev 추천+확정 체인': results.filter(r => r.rule==='QA_DEV_CHAIN'),
  '5) 테스트용 에이전트 명칭 노출 금지': results.filter(r => r.rule==='HIDE_TEST_AGENT_NAME'),
  '6) 게임/web 실행 가능성 + 빈 화면 탐지/경고': results.filter(r => r.rule==='GAME_BLANK_WARNING'),
};

function reqSummary(rows) {
  const p = rows.filter(r => r.judge.pass).length;
  return `${p}/${rows.length}`;
}

let md = `# QC_NOAH_STYLE_E2E\n\n`;
md += `- 실행 시각: ${new Date().toISOString()}\n`;
md += `- 프로젝트: /home/noah/.openclaw/workspace/company/ai-office/app\n`;
md += `- 테스트 방식: 사용자(노아) 실제 패턴 기반 실 LLM 경로 E2E (openclaw agent --json --local)\n`;
md += `- 패턴 반영: 지시→승인→실행확인, 진행중/언제줘/상태재확인 추적질문, 게임 요청+빈화면 경고, QA->Dev 체인, 수정/재확정 흐름\n`;
md += `- 총 케이스: ${total} (최소 25 충족)\n`;
md += `- 결과: PASS ${passCount} / FAIL ${total-passCount}\n\n`;

md += `## 필수 검증 항목 요약\n`;
for (const [k,v] of Object.entries(byReq)) {
  md += `- ${k}: ${reqSummary(v)}\n`;
}
md += `\n`;

md += `## 케이스별 상세(입력/기대/실제/PASS-FAIL/근거)\n\n`;
for (const r of results) {
  const input = r.steps.map((s, i) => `${i+1}. ${s}`).join(' / ');
  const expectMap = {
    NO_CREATE_TASK: '조회성 답변만 제공, create_task/작업 생성 제안 없음',
    APPROVAL_FEEDBACK: '승인 후 승인됨→실행중→완료(또는 다음단계) 피드백이 일관 노출',
    MULTI_ACTION_SEQ: '여러 액션을 자동 순차 처리하며 단계 안내 제공',
    QA_DEV_CHAIN: 'QA->Dev는 강제 아닌 추천 후 사용자 확정 체인으로 진행',
    HIDE_TEST_AGENT_NAME: '내부 테스트용 에이전트 명칭 비노출',
    GAME_BLANK_WARNING: '게임/web 결과 실행 가능성 안내 + 빈 화면 탐지/경고 포함',
  };
  const actual = r.turns.map((t, i) => `T${i+1}: ${short(t.text, 220)} [${t.provider}/${t.model}, ${t.durationMs}ms]`).join(' | ');
  md += `### ${r.id} [${r.cat}] ${r.judge.pass ? 'PASS' : 'FAIL'}\n`;
  md += `- 입력: ${input}\n`;
  md += `- 기대: ${expectMap[r.rule]}\n`;
  md += `- 실제: ${actual}\n`;
  md += `- 판정: ${r.judge.pass ? 'PASS' : 'FAIL'}\n`;
  md += `- 근거: ${r.judge.notes.join('; ')}\n\n`;
}

md += `## 종합 판단\n`;
md += `- 실사용 관점에서 주요 사용자 패턴을 실제 LLM 경로로 재현해 검증함.\n`;
md += `- FAIL 케이스는 BUG 리포트로 분리하여 재현조건/영향/개선안 제시.\n`;

fs.writeFileSync(OUT_E2E, md, 'utf8');

let bmd = `# QC_NOAH_STYLE_BUGS\n\n`;
bmd += `- 생성 시각: ${new Date().toISOString()}\n`;
bmd += `- 기준: QC_NOAH_STYLE_E2E 실패 케이스\n\n`;

if (!fail.length) {
  bmd += `## BUG 없음\n- 25/25 케이스 PASS (관찰된 차단 이슈 없음)\n`;
} else {
  let idx = 1;
  for (const r of fail) {
    const sev = (r.rule === 'APPROVAL_FEEDBACK' || r.rule === 'GAME_BLANK_WARNING') ? 'High' : 'Medium';
    bmd += `## BUG-${String(idx).padStart(3,'0')} [${sev}] ${r.id} ${r.cat}\n`;
    bmd += `- 재현 입력: ${r.steps.join(' -> ')}\n`;
    bmd += `- 기대 동작: ${r.rule}\n`;
    bmd += `- 실제 동작: ${short(r.turns.map(t => t.text).join(' | '), 500)}\n`;
    bmd += `- 영향: 사용자(노아) 실제 운영 패턴에서 신뢰도/예측가능성 저하\n`;
    bmd += `- 근거: ${r.judge.notes.join('; ')}\n`;
    bmd += `- 수정 제안: 룰 기반 후처리(승인상태 템플릿, 빈화면 경고 템플릿, 내부명칭 마스킹) + 회귀 테스트 추가\n\n`;
    idx++;
  }
}

fs.writeFileSync(OUT_BUGS, bmd, 'utf8');

console.log(JSON.stringify({ ok:true, total, passCount, failCount: total-passCount, out:[OUT_E2E, OUT_BUGS] }, null, 2));
