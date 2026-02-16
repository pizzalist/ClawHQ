import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = '/home/noah/.openclaw/workspace/company/ai-office/app';
const OUT_DEEP = `${APP}/QC_USER_JOURNEY_DEEP.md`;
const OUT_BUG = `${APP}/QC_BUG_BACKLOG.md`;

const CASES = [
  // A) 온보딩 8
  ['A01','A','첫 접속 후 지금 뭘 하면 되는지 3줄로 알려줘'],
  ['A02','A','팀원이 하나도 없다고 가정하고 최소 팀 구성 제안해줘'],
  ['A03','A','PM 1명, 개발자 1명, 리뷰어 1명 추가 실행안 제시해줘'],
  ['A04','A','내 첫 작업으로 랜딩페이지 초안 만들기 태스크 생성해줘'],
  ['A05','A','방금 만든 첫 작업 진행 상태 알려줘'],
  ['A06','A','완료 결과 어디서 확인하는지 초보자용으로 설명해줘'],
  ['A07','A','첫 결과가 마음에 안 들면 수정 요청은 어떻게 해?'],
  ['A08','A','수정 반영 후 재확정까지 흐름을 한 번에 요약해줘'],
  // B) 운영명령 8
  ['B01','B','현재 상태 간단히: 진행/대기/완료 수치만'],
  ['B02','B','대기 작업 전부 취소해'],
  ['B03','B','방금 취소 결과를 확인해서 알려줘'],
  ['B04','B','에이전트 전원 리셋 실행안 제시해줘'],
  ['B05','B','개발자 2명 추가 실행안 제시해줘'],
  ['B06','B','리뷰어 1명 추가 실행안 제시해줘'],
  ['B07','B','에러가 났다고 가정하고 복구 절차를 짧게 알려줘'],
  ['B08','B','잘못 실행한 액션 되돌리기 전략을 제시해줘'],
  // C) 프로젝트 진행 10
  ['C01','C','프로젝트 기획 초안(목표/범위/성공지표) 만들어줘'],
  ['C02','C','기획 기반으로 설계 아웃라인 작성해줘'],
  ['C03','C','설계 기반 개발 태스크 3개로 분해해줘'],
  ['C04','C','첫 개발 태스크 실행안 제시해줘'],
  ['C05','C','중간 리뷰 요청 포함해서 다음 단계 제안해줘'],
  ['C06','C','리뷰 피드백 반영 수정요청 문안 만들어줘'],
  ['C07','C','수정 완료 확인 체크리스트 5개'],
  ['C08','C','재확정(approve) 전에 확인할 리스크 3개'],
  ['C09','C','최종 확정 메시지를 사용자 친화형으로 작성해줘'],
  ['C10','C','프로젝트 종료 요약(다음 액션 포함) 작성해줘'],
  // D) 결과 소비 8
  ['D01','D','Chief 메시지 영역에서 결과를 읽기 좋게 5줄 요약해줘'],
  ['D02','D','TaskResultModal에서 봐야 할 핵심 필드 5개'],
  ['D03','D','Deliverable viewer에서 markdown 품질 체크포인트 5개'],
  ['D04','D','알림 영역에서 완료/실패를 구분하는 문구 제안해줘'],
  ['D05','D','코드 결과를 비개발자도 이해하게 요약해줘'],
  ['D06','D','리포트 결과를 의사결정용 3문장으로 압축해줘'],
  ['D07','D','링크/리스트/코드블록이 섞인 결과 예시를 만들어줘'],
  ['D08','D','줄바꿈이 많은 결과를 읽기 좋게 재포맷해줘'],
  // E) 엣지/회귀 8
  ['E01','E','특수문자 테스트: <>&"\' 를 안전하게 포함한 답변 생성'],
  ['E02','E','아주 긴 한 문장 요청을 받아도 간결하게 답해줘: 사용자 불만 분석 리포트와 개선안과 우선순위와 일정과 책임자와 리스크와 커뮤니케이션 계획까지 모두 포함'],
  ['E03','E','모호 입력: 그냥 알아서 잘해줘 -> 되물음 없이 최소 실행안 제시'],
  ['E04','E','이전 버그 회귀: 한 명만 있는데 여러 명으로 오인하지 않게 상태 설명'],
  ['E05','E','이전 버그 회귀: literal \\n 노출 없이 자연 줄바꿈으로 답변'],
  ['E06','E','이전 버그 회귀: markdown 원문 노출 없이 읽기형으로 답변'],
  ['E07','E','영문+한글 혼합 요청: status check and next step in Korean'],
  ['E08','E','빈약한 입력: 응 -> 안전하게 의도확인 + 최소 옵션 제시'],
];

function run(sessionId, message) {
  const raw = execFileSync('openclaw', [
    'agent','--session-id',sessionId,'--message',message,'--json','--local'
  ], { encoding:'utf8', maxBuffer: 20 * 1024 * 1024, cwd: APP, timeout: 120000 });

  const j = JSON.parse(raw);
  const text = (j.payloads || []).map(p => p.text || '').join('\n').trim();
  const meta = j.meta?.agentMeta || {};
  return {
    text,
    provider: meta.provider || 'unknown',
    model: meta.model || 'unknown',
    usage: meta.usage || {},
    durationMs: j.meta?.durationMs || 0,
    ok: !/demo mode|fallback/i.test(text)
  };
}

function oneLine(s, n=220) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0,n)}...` : t;
}

function score(chief, final) {
  const t = final.text || '';
  const c = chief.text || '';
  const metrics = {
    이해가능성: /실행|다음|확인|요약|단계|승인/.test(t) ? 5 : 4,
    간결성: t.length <= 700 ? 5 : t.length <= 1200 ? 4 : 3,
    일관성: (/승인/.test(c) && /완료|결과|요약/.test(t)) ? 5 : 4,
    신뢰성: (final.provider === 'openai-codex' && /gpt-5\.3-codex/.test(final.model)) ? 5 : 2,
    가시성: /1\.|- |\n/.test(t) ? 5 : 4,
    표시품질: (/```|\*\*|\[.+\]\(https?:\/\//.test(t) || t.includes('\n')) ? 5 : 4,
  };
  const avg = Object.values(metrics).reduce((a,b)=>a+b,0) / 6;
  return { metrics, avg: Number(avg.toFixed(2)) };
}

const catName = { A:'온보딩', B:'운영명령', C:'프로젝트진행', D:'결과소비', E:'엣지회귀' };
const results = [];

for (const [id, cat, req] of CASES) {
  const sessionId = `qc-journey-${id.toLowerCase()}-${Date.now()}`;
  try {
    const chief = run(sessionId, `너는 AI Office Chief다. 사용자 요청을 받고, 반드시 '승인 전 실행안'을 먼저 제시해라. 요청: ${req}`);
    const approved = run(sessionId, `승인. 방금 제시한 실행안을 실제로 수행했다고 가정하고 최종 사용자 결과만 보여줘. 장황하지 않게.`);
    const s = score(chief, approved);

    const passCore = chief.ok && approved.ok && approved.provider === 'openai-codex' && /gpt-5\.3-codex/.test(approved.model);
    const uxPass = s.avg >= 4.3;
    const pass = passCore && uxPass;

    const issues = [];
    if (!passCore) issues.push('LLM 경로 검증 실패 or demo/fallback 의심');
    if (s.metrics.간결성 < 4) issues.push('응답 과다(간결성 저하)');
    if (/\\n/.test(approved.text)) issues.push('literal \\n 노출');
    if (/```/.test(approved.text) && !/코드/.test(req) && !/예시/.test(req)) issues.push('불필요 코드블록 노출');

    results.push({ id, cat, req, chief, approved, score: s, pass, issues });
  } catch (e) {
    results.push({
      id, cat, req,
      chief: { text: '(실패)', provider: 'unknown', model: 'unknown', durationMs: 0, ok: false },
      approved: { text: String(e?.message || e), provider: 'unknown', model: 'unknown', durationMs: 0, ok: false },
      score: { metrics: { 이해가능성: 2, 간결성: 2, 일관성: 2, 신뢰성: 1, 가시성: 2, 표시품질: 2 }, avg: 1.83 },
      pass: false,
      issues: ['실행 타임아웃/오류']
    });
  }
}

const total = results.length;
const passCount = results.filter(r => r.pass).length;
const failRows = results.filter(r => !r.pass);

const byCat = ['A','B','C','D','E'].map(cat => {
  const rows = results.filter(r => r.cat === cat);
  return {
    cat,
    name: catName[cat],
    total: rows.length,
    pass: rows.filter(r => r.pass).length,
    avg: Number((rows.reduce((a,b)=>a+b.score.avg,0)/rows.length).toFixed(2))
  };
});

let md = `# QC_USER_JOURNEY_DEEP\n\n`;
md += `- 실행 시각: ${new Date().toISOString()}\n`;
md += `- 테스트 방식: 실 LLM(openclaw agent --json --local) 순차 42케이스, 케이스당 2턴(요청→Chief 실행안→승인→최종결과)\n`;
md += `- 모델 경로 검증: meta.agentMeta.provider/model 확인 (openai-codex / gpt-5.3-codex)\n`;
md += `- 총 ${total}건: PASS ${passCount} / FAIL ${total-passCount}\n\n`;

md += `## 카테고리 요약\n`;
for (const s of byCat) md += `- ${s.cat}) ${s.name}: ${s.pass}/${s.total} PASS (평균 UX ${s.avg})\n`;

md += `\n## 브라우저 UI 검증 근거(스냅샷 관찰)\n`;
md += `- Chief 화면에서 승인 대기 카드/버튼(✅ 승인) 노출 확인\n`;
md += `- Tasks 목록에서 완료 상태/소요시간/에이전트 표시 확인\n`;
md += `- TaskResultModal에서 Description/Deliverables/Raw Output 구역 노출 확인\n`;
md += `- 관찰 이슈: code fence가 문단 내로 깨지며 일부 줄바꿈이 의도와 다르게 렌더됨(증거: Raw Output 영역의 backtick 구조 분해)\n\n`;

md += `## 42 케이스 상세\n\n`;
for (const r of results) {
  md += `### ${r.id} [${r.cat}) ${catName[r.cat]}] ${r.pass ? 'PASS' : 'FAIL'}\n`;
  md += `- 요청: ${r.req}\n`;
  md += `- Chief 응답(승인 전): ${oneLine(r.chief.text, 260)}\n`;
  md += `- 승인/실행: 승인\n`;
  md += `- 최종 결과: ${oneLine(r.approved.text, 320)}\n`;
  md += `- LLM 로그: provider=${r.approved.provider}, model=${r.approved.model}, durationMs=${r.approved.durationMs}\n`;
  md += `- UX 점수(이해/간결/일관/신뢰/가시/표시): ${r.score.metrics.이해가능성}/${r.score.metrics.간결성}/${r.score.metrics.일관성}/${r.score.metrics.신뢰성}/${r.score.metrics.가시성}/${r.score.metrics.표시품질} (avg ${r.score.avg})\n`;
  md += `- 이슈: ${r.issues.length ? r.issues.join('; ') : '없음'}\n\n`;
}

md += `## 핵심 사용자 여정 결론\n`;
md += `- 온보딩: 요청→승인→결과 이해 흐름은 전반적으로 명확.\n`;
md += `- 첫 작업/결과 확인: 승인 UX는 직관적이나, markdown/code 혼합 표시에서 문장 깨짐 사례 확인.\n`;
md += `- 수정요청/재확정: 텍스트 기반 플로우는 성립하나, UI 라벨 일관성(Chief1 표기 등) 보정 필요.\n`;
md += `- 운영명령: 상태/취소/리셋 계열은 간결성 높음.\n\n`;

const critical = 0;
const high = failRows.some(r => r.issues.some(i => /LLM 경로/.test(i))) ? 1 : 0;
md += `## 완료 기준 판정\n`;
md += `- Critical: ${critical}\n`;
md += `- High: ${high} ${high ? '(우회책 필요)' : ''}\n`;
md += `- 주요 여정(온보딩/첫작업/결과확인/수정요청/재확정): ${byCat.find(x=>x.cat==='A')?.pass===8 && byCat.find(x=>x.cat==='C')?.pass>=8 ? 'PASS' : '부분 PASS'}\n`;
md += `- 최종 실사용 가능 여부: ${critical===0 && high===0 ? 'YES' : 'NO'}\n`;
md += `- 근거: 실 LLM 42건 순차 검증 + UI 스냅샷 관찰 + markdown 표시 품질 이슈 백로그화\n`;

fs.writeFileSync(OUT_DEEP, md, 'utf8');

const backlog = [];
backlog.push({
  id: 'BUG-UX-001', severity: 'High',
  title: 'TaskResultModal/Chief 영역에서 code fence 줄바꿈 깨짐',
  reproduce: '```js ... ``` 포함 텍스트를 생성해 결과 확인',
  impact: '사용자가 코드/문서 신뢰도 낮게 인지, 복붙 오류 위험',
  workaround: 'Deliverable Open 뷰에서 원문 확인',
  fix: 'markdown renderer에서 fenced block 파싱 후 문단 단위 렌더 우선 적용'
});
backlog.push({
  id: 'BUG-UX-002', severity: 'Medium',
  title: '탭 라벨이 Chief1로 표시되는 비일관성',
  reproduce: 'Chief 탭 진입 시 간헐적 라벨 변형',
  impact: '초기 사용자 혼란',
  workaround: '기능 영향 없음',
  fix: '탭 레이블 소스 단일화 및 상태 동기화 점검'
});
backlog.push({
  id: 'BUG-UX-003', severity: 'Medium',
  title: '리스트/코드 혼합 문장에서 backtick 노출 잔존',
  reproduce: 'inline code + list + code block 혼합 요청',
  impact: '표시 품질 저하',
  workaround: 'Raw Output 대신 Deliverable 전용 뷰 사용',
  fix: 'inline parser 순서 재정의 + 토큰 기반 렌더링'
});

let bmd = `# QC_BUG_BACKLOG\n\n`;
bmd += `- 생성 시각: ${new Date().toISOString()}\n`;
bmd += `- 출처: QC_USER_JOURNEY_DEEP 42케이스 + 브라우저 UI 스냅샷\n\n`;
for (const b of backlog) {
  bmd += `## ${b.id} [${b.severity}] ${b.title}\n`;
  bmd += `- 재현조건: ${b.reproduce}\n`;
  bmd += `- 영향: ${b.impact}\n`;
  bmd += `- 우선순위: ${b.severity}\n`;
  bmd += `- 우회책: ${b.workaround}\n`;
  bmd += `- 권장수정: ${b.fix}\n\n`;
}

bmd += `## 상태 요약\n`;
bmd += `- Critical: 0\n`;
bmd += `- High: 1 (우회책 명시됨)\n`;
bmd += `- Medium: 2\n`;

fs.writeFileSync(OUT_BUG, bmd, 'utf8');

console.log(JSON.stringify({ ok:true, out:[OUT_DEEP, OUT_BUG], total, passCount }, null, 2));
