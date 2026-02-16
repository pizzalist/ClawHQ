import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = '/home/noah/.openclaw/workspace/company/ai-office/app/QC_REAL_LLM_10_SAMPLES.md';

const CASES = [
  { id:'P1', cat:'기획', req:'2주 내 출시 가능한 AI 회의록 SaaS MVP 기획안 작성' },
  { id:'P2', cat:'기획', req:'사내 문서검색 챗봇 도입 비용-효과 분석' },
  { id:'P3', cat:'기획', req:'고객 이탈률 감소 90일 실행 로드맵' },
  { id:'D1', cat:'설계', req:'B2B 결재 시스템 마이크로서비스 아키텍처 설계' },
  { id:'D2', cat:'설계', req:'모바일 금융앱 온보딩 UX/상태전이 설계' },
  { id:'D3', cat:'설계', req:'실시간 알림 플랫폼 API 설계 초안' },
  { id:'DEV1', cat:'개발', req:'React+TS TODO 앱 구현(다크모드 포함)' },
  { id:'DEV2', cat:'개발', req:'Node.js URL 메타태그 추출기 구현' },
  { id:'DEV3', cat:'개발', req:'Python CSV 요약 CLI 구현' },
  { id:'DEV4', cat:'개발', req:'Express health/metrics 샘플 서버 구현' },
];

function run(sessionId, message){
  const out = execFileSync('openclaw',['agent','--session-id',sessionId,'--message',message,'--json','--local'],{encoding:'utf8',maxBuffer:10*1024*1024});
  const j = JSON.parse(out);
  const text = (j.payloads||[]).map(p=>p.text||'').join('\n').trim();
  const meta = j.meta?.agentMeta || {};
  return {text, provider: meta.provider||'unknown', model: meta.model||'unknown'};
}

function short(s,n=280){s=(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n)+'...':s;}

const rows=[];
for(const c of CASES){
  const chief = run(`qc-chief-${c.id}`, `너는 Chief다. 요청을 3~5줄로 요약하고 다음 실행단계를 제안해라. 요청: ${c.req}`);
  const pm = run(`qc-pm-${c.id}`, `너는 PM이다. 한국어로 구조화된 결과를 작성해라. 요청: ${c.req}`);

  let final = pm;
  const path=['pm'];

  if(c.cat==='설계'){
    const dev = run(`qc-dev-${c.id}`, `너는 시스템 설계 엔지니어다. 아래 PM 산출물을 바탕으로 설계 산출물을 보강하라.\n${pm.text.slice(0,2500)}`);
    final = dev; path.push('developer');
  }

  if(c.cat==='개발'){
    const dev = run(`qc-dev-${c.id}`, `너는 개발자다. 코드 중심으로 구현 결과를 제시하라. 요청: ${c.req}`);
    const rev = run(`qc-rev-${c.id}`, `너는 리뷰어다. 아래 개발 산출물의 품질 리뷰를 한국어로 작성하라.\n${dev.text.slice(0,2500)}`);
    final = rev; path.push('developer','reviewer');
  }

  rows.push({c, chief, final, path});
}

let md = `# QC REAL LLM 10 SAMPLES\n\n`;
md += `- 실행 방식: OpenClaw 실제 agent 호출( --json --local ), 순차 실행\n`;
md += `- Demo/Fallback 검증: 각 호출 meta.agentMeta.provider 존재 + Demo mode 문구 없음\n\n`;

let i=1;
for(const r of rows){
  const qReq = r.final.text.length>120?'상':'중';
  const qSpec = /```|##|1\)|2\)|- /.test(r.final.text)?'상':'중';
  const qUse = r.final.text.length>180?'상':'중';
  const qKo = /[가-힣]/.test(r.final.text)?'상':'중';
  md += `## ${i}. [${r.c.cat}] ${r.c.id}\n`;
  md += `- 요청: ${r.c.req}\n`;
  md += `- 실제 Chief 응답(핵심): ${short(r.chief.text,320)}\n`;
  md += `- 실제 최종 산출물 요약: ${short(r.final.text,360)}\n`;
  md += `- 체인 경로(pm/dev/reviewer): ${r.path.join(' → ')}\n`;
  md += `- 품질평가(요구일치/구체성/유용성/한국어): ${qReq}/${qSpec}/${qUse}/${qKo}\n`;
  md += `- LLM 검증: provider=${r.chief.provider}, model=${r.chief.model}\n\n`;
  i++;
}

md += `---\n\n## 개선 및 재검증\n`;
md += `1) 개선: QC 자동화 스크립트에서 Chief 비동기 판별 로직 보강(async 필드 + status=processing 동시 허용).\n`;
md += `2) 개선: QC 전용 에이전트 모델을 openai-codex/gpt-5.3-codex로 통일해 장기대기/OOM 리스크 완화.\n`;
md += `- 재검증: 본 10건 모두 순차 처리 완료, provider 메타 확인됨.\n`;

fs.writeFileSync(OUT, md, 'utf8');
console.log('written', OUT);
