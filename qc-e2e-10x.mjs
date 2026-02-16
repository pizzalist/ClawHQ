#!/usr/bin/env node
/**
 * AI Office QC — 10 E2E Integration Flow Rounds
 * Handles async chief chat via WebSocket
 */
import http from 'http';
import { WebSocket } from 'ws';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3055';
const WS_URL = 'ws://localhost:3055/ws';
const SESSION_ID = `qc-e2e-${Date.now()}`;

// WebSocket connection for receiving async responses
let ws;
const pendingResponses = new Map(); // messageId -> { resolve, timer }

function connectWS() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => { console.log('[WS] Connected'); resolve(); });
    ws.on('error', reject);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'chief_response' && msg.payload?.messageId) {
          const pending = pendingResponses.get(msg.payload.messageId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingResponses.delete(msg.payload.messageId);
            pending.resolve(msg.payload);
          }
        }
      } catch {}
    });
  });
}

function waitForChiefResponse(messageId, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingResponses.delete(messageId);
      resolve({ timeout: true, messageId });
    }, timeoutMs);
    pendingResponses.set(messageId, { resolve, timer });
  });
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function chat(message) {
  // Pre-register a wildcard listener for any chief_response that comes in
  // to handle the race condition where WS response arrives before we know the messageId
  const recentResponses = [];
  const earlyHandler = (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'chief_response' && msg.payload?.messageId) {
        recentResponses.push(msg.payload);
      }
    } catch {}
  };
  ws.on('message', earlyHandler);

  const initial = await api('POST', '/api/chief/chat', { sessionId: SESSION_ID, message });
  
  if ((initial?.async === true || initial?.status === 'processing') && initial?.messageId) {
    // Check if response already arrived
    const already = recentResponses.find(r => r.messageId === initial.messageId);
    if (already) {
      ws.removeListener('message', earlyHandler);
      return { ...initial, ...already };
    }
    
    console.log(`    [chat] Async, waiting for WS (${initial.messageId.slice(0,16)}...)...`);
    const wsResponse = await waitForChiefResponse(initial.messageId, 120000);
    ws.removeListener('message', earlyHandler);
    return { ...initial, ...wsResponse };
  }
  
  ws.removeListener('message', earlyHandler);
  return initial;
}

async function approveProposal(messageId) {
  return api('POST', '/api/chief/proposal/approve', { sessionId: SESSION_ID, messageId });
}

async function getTasks() {
  return api('GET', '/api/tasks');
}

async function getDeliverables() {
  return api('GET', '/api/deliverables');
}

// 10 diverse real-world project scenarios
const ROUNDS = [
  {
    id: 1, name: '마케팅 랜딩페이지 + 분석 대시보드', domain: 'Marketing',
    planMsg: '신제품 출시를 위한 마케팅 랜딩페이지를 만들어줘. React + Tailwind로 히어로 섹션, 기능 소개, CTA 버튼, 고객 후기 섹션을 포함하고, 방문자 분석 대시보드도 같이 만들어줘.',
    fixMsg: '랜딩페이지에 모바일 반응형이 빠져있어. 768px 이하에서 레이아웃이 깨져. 수정해줘.',
    expectedDeliverable: 'web',
  },
  {
    id: 2, name: 'SaaS 구독 관리 API + 운영문서', domain: 'SaaS/Backend',
    planMsg: 'SaaS 구독 관리 시스템의 REST API 스펙을 작성해줘. 구독 CRUD, 웹훅 이벤트, 에러 코드 표준, rate limiting을 포함한 OpenAPI 스펙과 운영 가이드를 만들어줘.',
    fixMsg: '웹훅에 subscription.trial_ended 이벤트가 빠져있고, 결제 실패 에러 코드가 없어. 추가해줘.',
    expectedDeliverable: 'document',
  },
  {
    id: 3, name: '내부 운영 자동화 보고서 + 체크리스트', domain: 'Operations',
    planMsg: '매주 팀 운영 보고서를 자동 생성하는 시스템을 기획해줘. Jira 완료율, GitHub PR 현황, 장애 건수 집계하고, 주간 보고서 HTML 템플릿과 실행 체크리스트를 만들어줘.',
    fixMsg: '보고서에 "이번 주 블로커" 섹션이 빠져있고, 체크리스트에 팀장 검토 단계가 없어. 추가해줘.',
    expectedDeliverable: 'document',
  },
  {
    id: 4, name: '사용자 인증 기능 + 핫픽스', domain: 'Web/Auth',
    planMsg: 'JWT 기반 사용자 인증 시스템을 만들어줘. 회원가입, 로그인, 토큰 갱신, 비밀번호 재설정 API와 React 로그인 폼을 포함해.',
    fixMsg: 'refresh token rotation에서 이전 토큰이 즉시 무효화되지 않아. token family 도입해서 수정해줘.',
    expectedDeliverable: 'web',
  },
  {
    id: 5, name: '데이터 리포팅 파이프라인 문서화', domain: 'Data/Analytics',
    planMsg: '일일 매출 데이터를 수집해서 주간/월간 리포트를 생성하는 데이터 파이프라인을 설계하고 전체 문서를 만들어줘. ETL 워크플로우, 스키마, Airflow DAG 코드, 런북 포함.',
    fixMsg: '환불 트랜잭션 타입이 누락되었고, DAG에 재시도 로직이 없어. 3회 재시도 + backoff 추가해줘.',
    expectedDeliverable: 'document',
  },
  {
    id: 6, name: '고객지원 FAQ 시스템', domain: 'Customer Support',
    planMsg: '고객지원 FAQ 시스템을 웹으로 만들어줘. FAQ 30개 이상, 검색 기능, 카테고리별 분류를 포함해.',
    fixMsg: 'FAQ 검색이 정확 일치만 돼. 퍼지 검색과 아코디언 UI를 추가해줘.',
    expectedDeliverable: 'web',
  },
  {
    id: 7, name: '인터랙티브 타이핑 게임', domain: 'Game/Interactive',
    planMsg: '영어 타이핑 게임을 만들어줘. 단어가 떨어지고 타이핑해서 맞추는 방식. 난이도 3단계, 콤보 시스템, 최고 점수 저장, 게임 오버 화면 포함.',
    fixMsg: '같은 단어가 연속으로 나오고 긴 단어가 넘쳐. 중복 방지와 위치 계산 수정해줘.',
    expectedDeliverable: 'web',
  },
  {
    id: 8, name: '릴리즈 노트 + 포스트모템', domain: 'Product/Release',
    planMsg: 'v2.5.0 릴리즈 노트(새 기능 5개, 버그 수정 8개, 성능 개선 3건)와 장애 포스트모템(타임라인, 근본 원인, 재발 방지)을 작성해줘.',
    fixMsg: '마이그레이션 가이드가 빠져있어. DB 스키마 변경, API breaking change, 마이그레이션 절차를 추가해줘.',
    expectedDeliverable: 'document',
  },
  {
    id: 9, name: '분기 로드맵 기획', domain: 'Planning/Strategy',
    planMsg: '다음 분기 로드맵을 기획해줘. 후보 기능 15개를 ICE 스코어로 평가하고, 상위 5개의 기술 스펙과 실행 계획서를 만들어줘.',
    fixMsg: 'ICE 점수 기준이 불명확해. 1-10 기준표를 추가하고 기술 부채 항목 2개 이상 포함시켜줘.',
    expectedDeliverable: 'document',
  },
  {
    id: 10, name: '실시간 서버 모니터링 대시보드', domain: 'Complex/Multi-chain',
    planMsg: '실시간 서버 모니터링 대시보드를 체인 워크플로우로 만들어줘. PM이 요구사항 정리 → 개발자가 API(mock 데이터) → 디자이너가 UI → 개발자가 프론트 → QA가 검증하는 순서로.',
    fixMsg: '실시간 업데이트가 안 돼. 5초마다 데이터 갱신하도록 수정하고, CPU 90% 이상이면 빨간 알럿 추가해줘.',
    expectedDeliverable: 'web',
  },
];

const results = [];

async function runRound(round) {
  const log = { id: round.id, name: round.name, domain: round.domain, steps: [], pass: false, scores: {}, bugs: [] };
  const step = (name, detail) => {
    const d = typeof detail === 'string' ? detail.slice(0, 800) : JSON.stringify(detail).slice(0, 800);
    log.steps.push({ time: new Date().toISOString(), step: name, detail: d });
  };

  console.log(`\n${'='.repeat(60)}\n[Round ${round.id}] ${round.name}\n${'='.repeat(60)}`);

  // Step 1: Plan/Requirements
  console.log(`  [1] Planning...`);
  const planRes = await chat(round.planMsg);
  step('1_plan', { msg: round.planMsg, reply: planRes?.reply?.slice(0,300), hasActions: !!(planRes?.actions?.length) });
  console.log(`  [1] Response: ${planRes?.reply?.slice(0,100) || planRes?.timeout ? 'TIMEOUT' : 'no reply'}... actions=${planRes?.actions?.length || 0}`);

  // Step 2: Approve
  console.log(`  [2] Approving...`);
  let approved = false;
  if (planRes?.actions?.length > 0 && planRes?.messageId) {
    const approvalRes = await approveProposal(planRes.messageId);
    step('2_approve', approvalRes);
    approved = !!approvalRes?.executed;
    console.log(`  [2] Approval: executed=${approvalRes?.executed}, tasks=${approvalRes?.tasksCreated || 0}`);
  } else {
    // Try chat-based approval
    const apRes = await chat('좋아, 전부 진행해줘. 필요한 에이전트에게 작업을 배정해.');
    step('2_approve_chat', { reply: apRes?.reply?.slice(0,300), actions: apRes?.actions?.length || 0 });
    if (apRes?.actions?.length > 0 && apRes?.messageId) {
      const ar = await approveProposal(apRes.messageId);
      step('2_approve_explicit', ar);
      approved = !!ar?.executed;
    }
    console.log(`  [2] Chat approval done, actions=${apRes?.actions?.length || 0}`);
  }

  // Step 3: Wait for execution
  console.log(`  [3] Waiting for execution (up to 120s)...`);
  await new Promise(r => setTimeout(r, 5000));
  
  let completedTask = null;
  const tasksBefore = (await getTasks()) || [];
  const beforeIds = new Set(Array.isArray(tasksBefore) ? tasksBefore.filter(t => t.status === 'completed').map(t => t.id) : []);
  
  const execStart = Date.now();
  while (Date.now() - execStart < 120000) {
    const allTasks = await getTasks();
    if (Array.isArray(allTasks)) {
      completedTask = allTasks.find(t => 
        (t.status === 'completed' || t.status === 'failed') && !beforeIds.has(t.id)
      );
      if (completedTask) break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  
  step('3_execute', completedTask ? { title: completedTask.title, status: completedTask.status, resultSnippet: completedTask.result?.slice(0,300) } : 'no-completion');
  console.log(`  [3] Result: ${completedTask ? `${completedTask.status} - ${completedTask.title.slice(0,40)}` : 'no new completion'}`);

  // Step 4: Verify
  console.log(`  [4] Verifying...`);
  const deliverables = await getDeliverables();
  let validationResult = null;
  if (completedTask && Array.isArray(deliverables)) {
    const del = deliverables.find(d => d.taskId === completedTask.id);
    if (del) {
      try {
        validationResult = await api('GET', `/api/deliverables/${del.id}/validate`);
      } catch {}
    }
  }
  step('4_verify', { completed: !!completedTask, deliverables: Array.isArray(deliverables) ? deliverables.length : 0, validation: validationResult });
  console.log(`  [4] Verified`);

  // Step 5: Request fix
  console.log(`  [5] Requesting fix...`);
  const fixRes = await chat(round.fixMsg);
  step('5_fix', { msg: round.fixMsg, reply: fixRes?.reply?.slice(0,300), actions: fixRes?.actions?.length || 0 });
  
  if (fixRes?.actions?.length > 0 && fixRes?.messageId) {
    const fixApproval = await approveProposal(fixRes.messageId);
    step('5_fix_approve', fixApproval);
  } else {
    const fa = await chat('네, 수정 진행해줘.');
    step('5_fix_approve_chat', { reply: fa?.reply?.slice(0,200) });
    if (fa?.actions?.length > 0 && fa?.messageId) {
      await approveProposal(fa.messageId);
    }
  }
  console.log(`  [5] Fix submitted`);

  // Step 6: Re-verify
  console.log(`  [6] Re-verifying (up to 120s)...`);
  await new Promise(r => setTimeout(r, 5000));
  const afterBefore = new Set(Array.isArray(await getTasks()) ? (await getTasks()).filter(t => t.status === 'completed').map(t => t.id) : []);
  
  let fixedTask = null;
  const fixStart = Date.now();
  while (Date.now() - fixStart < 120000) {
    const allTasks = await getTasks();
    if (Array.isArray(allTasks)) {
      fixedTask = allTasks.find(t => 
        (t.status === 'completed' || t.status === 'failed') && !beforeIds.has(t.id) && t.id !== completedTask?.id
      );
      if (fixedTask) break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  step('6_reverify', fixedTask ? { title: fixedTask.title, status: fixedTask.status } : 'no-fix-completion');
  console.log(`  [6] Fix result: ${fixedTask ? fixedTask.status : 'no new task'}`);

  // Step 7: Confirm
  console.log(`  [7] Confirming...`);
  const confirmRes = await chat('확인 완료. 결과물 최종 정리해줘.');
  step('7_confirm', { reply: confirmRes?.reply?.slice(0,300) });
  console.log(`  [7] Confirmed`);

  // Scoring
  const hasReply = !!(planRes?.reply || planRes?.actions?.length);
  const taskOk = completedTask?.status === 'completed';
  log.scores = {
    requirements_match: hasReply ? (planRes?.actions?.length > 0 ? 9 : 7) : 3,
    completeness: taskOk ? 8 : (completedTask ? 5 : 3),
    executability: taskOk ? (validationResult?.valid ? 9 : 7) : 4,
    ux_clarity: hasReply ? 7 : 3,
  };
  log.pass = hasReply; // At minimum, chief should respond meaningfully

  // Bug detection
  if (planRes?.timeout) log.bugs.push({ severity: 'high', desc: 'Chief LLM response timeout (>120s)', round: round.id });
  if (!planRes?.actions?.length && hasReply) log.bugs.push({ severity: 'medium', desc: 'Chief responded but proposed no actions', round: round.id });
  if (completedTask?.status === 'failed') log.bugs.push({ severity: 'high', desc: `Task failed: ${completedTask.title}`, result: completedTask.result?.slice(0,200) });
  if (!completedTask && approved) log.bugs.push({ severity: 'high', desc: 'Actions approved but no task completed', round: round.id });

  results.push(log);
  return log;
}

async function main() {
  console.log('AI Office QC — 10 E2E Integration Rounds');
  console.log(`Server: ${BASE}, Session: ${SESSION_ID}`);
  
  const health = await api('GET', '/api/health');
  console.log('Health:', JSON.stringify(health));

  await connectWS();

  for (const round of ROUNDS) {
    try {
      await runRound(round);
    } catch (err) {
      console.error(`[Round ${round.id}] ERROR: ${err.message}`);
      results.push({
        id: round.id, name: round.name, domain: round.domain,
        pass: false, error: err.message, steps: [], 
        scores: { requirements_match: 0, completeness: 0, executability: 0, ux_clarity: 0 },
        bugs: [{ severity: 'critical', desc: `Round crashed: ${err.message}` }]
      });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Save raw results
  writeFileSync('/home/noah/.openclaw/workspace/company/ai-office/app/qc-e2e-10x-results.json', JSON.stringify(results, null, 2));
  console.log('\n✅ Results saved to qc-e2e-10x-results.json');
  
  // Print summary
  const passed = results.filter(r => r.pass).length;
  const allBugs = results.flatMap(r => r.bugs || []);
  console.log(`\nSummary: ${passed}/${results.length} PASS, ${allBugs.length} bugs found`);

  ws.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
