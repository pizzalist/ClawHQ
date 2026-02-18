const base='http://127.0.0.1:3001';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function j(method,path,body){
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const text=await r.text();
  let data; try{data=JSON.parse(text);}catch{data=text;}
  return {ok:r.ok,status:r.status,data};
}

const results=[];
async function run(id,name,fn){
  const t=Date.now();
  try{const detail=await fn();results.push({id,name,ok:true,ms:Date.now()-t,detail});}
  catch(e){results.push({id,name,ok:false,ms:Date.now()-t,detail:String(e.message||e)});}
}

const sid='overnight-'+Date.now();
let raceTaskSeen=false;

await run('S01','health', async()=>{ const r=await j('GET','/api/health'); if(!r.ok||r.data.status!=='ok') throw new Error('health not ok'); return r.data;});
await run('S02','reset-all clears data', async()=>{ await j('POST','/api/reset-all',{}); const t=await j('GET','/api/tasks'); const m=await j('GET','/api/meetings'); if(t.data.length!==0||m.data.length!==0) throw new Error('not empty'); return {tasks:t.data.length,meetings:m.data.length};});
await run('S03','chief status sync reply', async()=>{ const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'현재 상태 알려줘'}); if(!r.ok||r.data.async!==false) throw new Error('not sync'); return r.data.reply?.slice(0,80);});
await run('S04','chief async request returns processing', async()=>{ const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'모바일 퍼스트 일정관리 웹앱 기획부터 개발까지 시작해줘'}); if(!r.ok||r.data.status!=='processing') throw new Error('not processing'); return r.data.messageId;});
await run('S05','immediate approve queued while LLM in-flight', async()=>{ const r=await j('POST','/api/chief/chat',{sessionId:sid,message:'응'}); if(!r.ok||r.data.async!==false) throw new Error('approve not sync ack'); if(!String(r.data.reply||'').includes('처리 중')) throw new Error('no queued-approval ack'); return r.data.reply;});
await run('S06','race flow creates task within 20s', async()=>{ for(let i=0;i<20;i++){await sleep(1000); const t=await j('GET','/api/tasks'); if(Array.isArray(t.data)&&t.data.length>0){raceTaskSeen=true; return {sec:i+1,count:t.data.length,first:t.data[0].title};}} throw new Error('task not created');});
await run('S07','no zero-task ghost after approval', async()=>{ const t=await j('GET','/api/tasks'); if(!Array.isArray(t.data)||t.data.length===0) throw new Error('tasks still 0'); return {count:t.data.length,statuses:[...new Set(t.data.map(x=>x.status))]};});
await run('S08','tasks have active or completed states', async()=>{ const t=await j('GET','/api/tasks'); const ok=t.data.some(x=>['pending','in-progress','completed'].includes(x.status)); if(!ok) throw new Error('no expected statuses'); return t.data.map(x=>x.status);});
await run('S09','stray approve without pending is safe', async()=>{ const r=await j('POST','/api/chief/chat',{sessionId:'new-'+Date.now(),message:'응'}); if(!r.ok||r.data.async!==false) throw new Error('not safe sync'); return r.data.reply;});
await run('S10','api create task works', async()=>{ const a=await j('GET','/api/agents'); const assignee=a.data.find(x=>x.role==='pm')?.id||null; const r=await j('POST','/api/tasks',{title:'overnight-api-smoke',description:'smoke',assigneeId:assignee}); if(!r.ok||!r.data.id) throw new Error('create failed'); return {id:r.data.id,assigneeId:r.data.assigneeId};});
await run('S11','monitoring endpoints shape', async()=>{ const m=await j('GET','/api/monitoring/metrics'); const a=await j('GET','/api/monitoring/alerts'); const ts=await j('GET','/api/monitoring/timeseries?metric=task_success_rate&window=24h&interval=1h'); if(!m.ok||!a.ok||!ts.ok) throw new Error('monitoring fail'); return {alerts:Array.isArray(a.data.alerts)?a.data.alerts.length:-1,points:Array.isArray(ts.data.points)?ts.data.points.length:-1};});
await run('S12','export endpoints available', async()=>{ const j1=await fetch(base+'/api/export/json'); const md=await fetch(base+'/api/export/markdown'); const csv=await fetch(base+'/api/export/csv'); if(!j1.ok||!md.ok||!csv.ok) throw new Error('export fail'); return {json:j1.status,md:md.status,csv:csv.status};});
await run('S13','reset-all leaves agents idle', async()=>{ await j('POST','/api/reset-all',{}); const a=await j('GET','/api/agents'); const nonIdle=a.data.filter(x=>x.state!=='idle'); if(nonIdle.length>0) throw new Error('non-idle agents remain'); return {agents:a.data.length};});

const pass=results.filter(r=>r.ok).length;
const fail=results.length-pass;
console.log(JSON.stringify({base,sid,pass,fail,results},null,2));
process.exit(fail?1:0);
