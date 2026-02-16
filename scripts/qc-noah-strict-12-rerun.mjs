import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = '/home/noah/.openclaw/workspace/company/ai-office/app';
const OUT = `${APP}/tmp_noah_strict_12_results.json`;

const CASES = [
  ['R01','simple','AI Office 현재 상태를 1문장으로만 설명해줘.'],
  ['R02','simple','온보딩 다음 행동 2개만 bullet로.'],
  ['R03','simple','진행/대기/완료 상태를 예시 숫자로 한 줄 포맷만 보여줘.'],
  ['R04','simple','수정요청 후 재확정까지 절차를 3줄로.'],
  ['R05','simple','TaskResultModal에서 꼭 볼 필드 5개만.'],
  ['R06','simple','"조건부 체인"을 이 제품 맥락에서 2문장으로 정의해줘.'],
  ['R07','complex','신규 기능 QA 체크리스트를 기능/UX/안정성/회귀 4영역으로 나눠 각 3개씩 작성해줘.'],
  ['R08','complex','운영자용 장애 보고 템플릿을 원인/영향/즉시조치/재발방지 형식으로 작성해줘.'],
  ['R09','complex','markdown 결과 품질 테스트용 샘플을 표/리스트/코드블록/링크 혼합으로 만들어줘.'],
  ['R10','complex','초보자에게 승인 게이트의 의미를 비유 1개 포함해 설명해줘.'],
  ['R11','complex','한국어 3문장으로만: 2주 개선 로드맵(우선순위 포함).'],
  ['R12','complex','지금 배포 판단 기준을 Must Fix / Should Fix / Nice-to-have 로 구분해줘.'],
];

function run(sessionId, message){
  const raw = execFileSync('openclaw', ['agent','--session-id',sessionId,'--message',message,'--json','--local'], {
    encoding:'utf8', cwd: APP, timeout: 45000, maxBuffer: 20*1024*1024
  });
  const j = JSON.parse(raw);
  const text = (j.payloads||[]).map(p=>p.text||'').join('\n').trim();
  const meta = j.meta?.agentMeta || {};
  return {
    text,
    durationMs: j.meta?.durationMs || 0,
    provider: meta.provider || 'unknown',
    model: meta.model || 'unknown',
  };
}

function score(row){
  const t = row.text || '';
  const functional = (() => {
    if (row.id==='R02') return /[-•]/.test(t) && t.split('\n').filter(Boolean).length>=2;
    if (row.id==='R04') return t.split('\n').filter(Boolean).length<=4 && t.split('\n').filter(Boolean).length>=2;
    if (row.id==='R05') return (t.match(/\n|\d\.|-|•/g)||[]).length>=4;
    if (row.id==='R11') return t.split(/[.!?]\s*|\n/).filter(s=>s.trim()).length<=4;
    if (row.id==='R12') return /Must Fix/i.test(t) && /Should Fix/i.test(t) && /Nice-to-have/i.test(t);
    return t.length>0;
  })();

  const ux = (() => {
    const tooLongSimple = row.type==='simple' && t.length>420;
    const upsell = /원하면|원하시면|추가로 해드릴|더 도와/.test(t);
    const noisy = /✨|🚀|🔥|💡/.test(t);
    return !tooLongSimple && !upsell && !noisy;
  })();

  return { functional, ux };
}

const results=[];
for (const [id,type,prompt] of CASES){
  process.stdout.write(`RUN ${id}... `);
  try {
    const r = run(`noah-strict-${id.toLowerCase()}-${Date.now()}`, prompt);
    const s = score({id,type,text:r.text});
    results.push({id,type,prompt,...r,...s});
    console.log(`ok ${r.durationMs}ms`);
  } catch(e){
    results.push({id,type,prompt,text:'',durationMs:0,provider:'unknown',model:'unknown',functional:false,ux:false,error:String(e?.message||e)});
    console.log('fail');
  }
}

const summary = {
  functionalPass: results.filter(r=>r.functional).length,
  uxPass: results.filter(r=>r.ux).length,
  total: results.length,
  providerOk: results.filter(r=>r.provider==='openai-codex').length,
  modelOk: results.filter(r=>/gpt-5\.3-codex/.test(r.model)).length,
};

fs.writeFileSync(OUT, JSON.stringify({createdAt:new Date().toISOString(),summary,results}, null, 2));
console.log(`written ${OUT}`);
