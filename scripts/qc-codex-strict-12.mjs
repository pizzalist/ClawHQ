import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = '/home/noah/.openclaw/workspace/company/ai-office/app';
const OUT = `${APP}/tmp_strict_12_results.json`;

const CASES = [
  ['S01','simple','현재 상태 한 줄만 답해.'],
  ['S02','simple','취소/리셋/역할추가 가능 여부만 1문장으로.'],
  ['S03','simple','대기 작업 전부 취소해. 승인요청 없이 바로 실행 결과만.'],
  ['S04','simple','단순 요청은 짧게. 지금 상태 숫자만: 진행/대기/완료.'],
  ['S05','simple','리뷰어 1명 추가 실행안, 2줄 이내.'],
  ['S06','simple','불필요 미팅 없이 다음 한 단계만 제시해.'],
  ['C01','complex','신규 SaaS MVP 2주 실행계획을 목표/범위/리스크/담당/일정으로 작성하고 마지막에 오늘 바로 할 일 3개를 넣어줘.'],
  ['C02','complex','요구사항이 모호한 상태다. 질문 3개만 하고, 각 질문의 이유를 한 줄씩 덧붙여줘.'],
  ['C03','complex','Node.js URL 메타태그 추출기 구현 코드와 실행 방법, 실패 케이스 2개를 제시해줘.'],
  ['C04','complex','리셋 동작 테스트 포인트 정확히 3개. 각 포인트는 검증방법 1줄 포함.'],
  ['C05','complex','최종 리포트 필수 항목 7개를 번호 목록으로만 써줘.'],
  ['C06','complex','아래 요청을 한국어 3문장으로 압축: 고객 이탈률 감소 90일 실행 로드맵과 지표 설계 및 리스크 대응 계획.'],
];

function run(sessionId, message){
  const raw = execFileSync('openclaw', ['agent','--session-id',sessionId,'--message',message,'--json','--local'], {encoding:'utf8', cwd: APP, timeout: 40000, maxBuffer: 20*1024*1024});
  const j = JSON.parse(raw);
  const text = (j.payloads||[]).map(p=>p.text||'').join('\n').trim();
  return { ok:true, text, durationMs:j.meta?.durationMs||0, provider:j.meta?.agentMeta?.provider||'unknown', model:j.meta?.agentMeta?.model||'unknown' };
}

const results=[];
for (const [id,type,req] of CASES){
  process.stdout.write(`RUN ${id}... `);
  try {
    const r = run(`strict-${id.toLowerCase()}-${Date.now()}`, req);
    results.push({id,type,req,...r});
    console.log(`ok ${r.durationMs}ms`);
  } catch (e) {
    results.push({id,type,req,ok:false,error:String(e.message||e)});
    console.log('fail');
  }
}

fs.writeFileSync(OUT, JSON.stringify({createdAt:new Date().toISOString(),results},null,2));
console.log(`written ${OUT}`);
