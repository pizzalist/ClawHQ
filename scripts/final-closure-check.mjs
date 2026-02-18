const base='http://127.0.0.1:3001';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function j(method,path,body){
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t=await r.text();
  let data=t; try{data=JSON.parse(t);}catch{}
  return {ok:r.ok,status:r.status,data};
}

async function waitFor(fn,{timeoutMs=120000,intervalMs=1000,label='condition'}={}){
  const start=Date.now();
  let last;
  while(Date.now()-start<timeoutMs){
    try { last=await fn(); } catch (e) { last={ok:false,error:String(e?.message||e)}; }
    if(last?.ok) return {ok:true,value:last.value,ms:Date.now()-start};
    await sleep(intervalMs);
  }
  return {ok:false,error:`timeout waiting ${label}`,last,ms:Date.now()-start};
}

const results=[];
async function step(id,name,fn){
  const t=Date.now();
  process.stdout.write(`\n[${id}] ${name} ... `);
  try{
    const detail=await fn();
    results.push({id,name,ok:true,ms:Date.now()-t,detail});
    process.stdout.write('PASS\n');
  }catch(e){
    results.push({id,name,ok:false,ms:Date.now()-t,error:String(e?.message||e)});
    process.stdout.write(`FAIL (${String(e?.message||e)})\n`);
  }
}

const sid='closure-'+Date.now();
let rootTask;
let fixTask;

await step('S01','health endpoint', async()=>{
  const r=await j('GET','/api/health');
  if(!r.ok||r.data.status!=='ok') throw new Error('health not ok');
  return r.data;
});

await step('S02','reset-all baseline', async()=>{
  const rr=await j('POST','/api/reset-all',{});
  if(!rr.ok) throw new Error('reset fail');
  const t=await j('GET','/api/tasks');
  if(!Array.isArray(t.data)||t.data.length!==0) throw new Error('tasks not empty after reset');
  return {tasks:t.data.length};
});

await step('S03','create request accepted', async()=>{
  const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'간단한 로그인 화면 HTML을 만들어줘'});
  if(!r.ok||r.data.status!=='processing') throw new Error('not processing');
  return {messageId:r.data.messageId};
});

await step('S04','immediate approve race ack', async()=>{
  const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'응'});
  if(!r.ok||r.data.async!==false) throw new Error('approve not sync ack');
  if(!String(r.data.reply||'').includes('자동으로 이어서 실행')) throw new Error('missing queued ack');
  return {reply:r.data.reply};
});

await step('S05','task becomes visible', async()=>{
  const w=await waitFor(async()=>{
    const t=await j('GET','/api/tasks');
    if(!t.ok||!Array.isArray(t.data)) return {ok:false};
    const rt=t.data.find(x=>!x.parentTaskId);
    if(rt) return {ok:true,value:rt};
    return {ok:false,value:t.data.length};
  },{timeoutMs:90000,label:'root task visible'});
  if(!w.ok) throw new Error(w.error);
  rootTask=w.value;
  return {taskId:rootTask.id,title:rootTask.title,status:rootTask.status};
});

await step('S06','create->approve->complete->result visible', async()=>{
  const w=await waitFor(async()=>{
    const t=await j('GET',`/api/tasks/${rootTask.id}`);
    if(!t.ok) return {ok:false};
    if(t.data.status==='completed' && t.data.result) return {ok:true,value:t.data};
    return {ok:false,value:t.data.status};
  },{timeoutMs:240000,label:'root completion'});
  if(!w.ok) throw new Error(w.error);
  rootTask=w.value;
  return {status:rootTask.status,resultLen:rootTask.result.length};
});

await step('S07','modify request + approve starts fix task', async()=>{
  const req=await j('POST','/api/chief/chat',{sessionId:sid,message:'리뷰 피드백 반영해줘'});
  if(!req.ok) throw new Error('fix request failed');
  const ap=await j('POST','/api/chief/chat',{sessionId:sid,message:'승인'});
  if(!ap.ok) throw new Error('fix approve failed');

  const w=await waitFor(async()=>{
    const t=await j('GET','/api/tasks');
    if(!t.ok||!Array.isArray(t.data)) return {ok:false};
    const fx=t.data
      .filter(x=>!x.parentTaskId)
      .filter(x=>/^\[Fix\]/i.test(x.title) || /(피드백.*반영|수정.*반영|\[Fix\])/i.test(x.title))
      .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())[0];
    if(fx) return {ok:true,value:fx};
    return {ok:false};
  },{timeoutMs:90000,label:'fix task visible'});
  if(!w.ok) throw new Error(w.error);
  fixTask=w.value;
  return {fixTaskId:fixTask.id,title:fixTask.title,status:fixTask.status};
});

await step('S08','modify request flow completes with modified result', async()=>{
  const w=await waitFor(async()=>{
    const t=await j('GET',`/api/tasks/${fixTask.id}`);
    if(!t.ok) return {ok:false};
    if(t.data.status==='completed' && t.data.result) return {ok:true,value:t.data};
    return {ok:false,value:t.data.status};
  },{timeoutMs:240000,label:'fix completion'});
  if(!w.ok) throw new Error(w.error);
  fixTask=w.value;
  return {status:fixTask.status,resultLen:fixTask.result.length};
});

await step('S09','"수정 결과 요약해줘" gives fix summary context', async()=>{
  const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'수정 결과 요약해줘'});
  if(!r.ok) throw new Error('chat failed');
  const reply=String(r.data.reply||'');
  const meaningful=/수정 결과 요약|핵심 변경사항|검증\/리뷰 요약|\[Fix\]/.test(reply);
  const generic=/현재 대기|현재 진행|현재 상태/.test(reply);
  if(!meaningful || generic) throw new Error('generic reply');
  return {reply:reply.slice(0,260)};
});

await step('S10','second session immediate approve race safe', async()=>{
  const sid2='closure-race-'+Date.now();
  await j('POST','/api/chief/chat',{sessionId:sid2,message:'간단한 보고서 작성 시작해줘'});
  const a1=await j('POST','/api/chief/chat',{sessionId:sid2,message:'응'});
  const a2=await j('POST','/api/chief/chat',{sessionId:sid2,message:'응'});
  if(!a1.ok||!a2.ok) throw new Error('race approve failed');
  if(!String(a1.data.reply||'').includes('처리 중')) throw new Error('missing first race ack');
  return {a1:a1.data.reply?.slice(0,80),a2:a2.data.reply?.slice(0,80)};
});

const pass=results.filter(r=>r.ok).length;
const fail=results.length-pass;
const out={base,sid,pass,fail,results,generatedAt:new Date().toISOString()};
console.log('\n'+JSON.stringify(out,null,2));
process.exit(fail?1:0);
