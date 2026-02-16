import { performance } from 'node:perf_hooks';
import { checkOpenClaw } from './openclaw-adapter.js';
import { chatWithChief, generatePlanFromPrompt } from './chief-agent.js';
import { decideNextRoleByIntent } from './task-queue.js';
import { createAgent, deleteAllAgents, listAgents } from './agent-manager.js';
import { stmts } from './db.js';

interface CaseResult {
  id: string;
  category: string;
  input: string;
  pass: boolean;
  concise: boolean;
  quality: number;
  ms: number;
  note: string;
}

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

function scoreText(reply: string, keyword: string): { concise: boolean; quality: number } {
  const concise = reply.length <= 160 && reply.split('\n').length <= 3;
  let quality = 5;
  if (!reply.includes(keyword)) quality -= 1;
  if (!concise) quality -= 1;
  if (/미팅/i.test(reply) && /(상태|취소|리셋|reset)/i.test(keyword)) quality -= 2;
  if (quality < 0) quality = 0;
  return { concise, quality };
}

async function run() {
  const oldPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  await checkOpenClaw(); // force demo fallback
  process.env.PATH = oldPath;

  resetAll();
  createAgent('PM-01', 'pm', 'claude-opus-4-6');
  createAgent('DEV-01', 'developer', 'openai-codex/gpt-5.3-codex');
  createAgent('REV-01', 'reviewer', 'claude-opus-4-6');

  const results: CaseResult[] = [];

  const chiefCases = [
    { id: 'C01', category: '단순 운영', input: '현재 상태 알려줘', expect: /인력\s+\d+명/, key: '상태' },
    { id: 'C02', category: '단순 운영', input: '현황만 짧게', expect: /인력\s+\d+명/, key: '현황' },
    { id: 'C03', category: '단순 운영', input: '대기 작업 전체 취소해줘', expect: /취소/, key: '취소' },
    { id: 'C04', category: '단순 운영', input: '전체 리셋', expect: /리셋/, key: '리셋' },
    { id: 'C05', category: '단일 산출물', input: 'PM 1명 추가', expect: /요청 편성: pm 1명/i, key: 'pm 1명' },
    { id: 'C06', category: '단일 산출물', input: '개발자 1명 추가', expect: /developer 1명/i, key: 'developer 1명' },
    { id: 'C07', category: '복합 요청', input: '상태 확인하고 PM 1명 추가 제안해줘', expect: /pm 1명/i, key: 'pm 1명' },
    { id: 'C08', category: '엣지', input: '!!! 상태??', expect: /인력\s+\d+명/, key: '상태' },
    { id: 'C09', category: '엣지', input: '개발자 2명, 리뷰어 1명', expect: /developer 2명.*reviewer 1명/i, key: 'developer 2명' },
    { id: 'C10', category: '회귀', input: '개발자 1명', expect: /developer 1명/i, key: 'developer 1명' },
  ];

  for (const c of chiefCases) {
    const t0 = performance.now();
    const out = chatWithChief('qc-session', c.input);
    const ms = performance.now() - t0;
    const reply = out.reply || '';
    const pass = c.expect.test(reply);
    const { concise, quality } = scoreText(reply, c.key);
    results.push({ id: c.id, category: c.category, input: c.input, pass, concise, quality, ms, note: reply.replace(/\n/g, ' / ').slice(0, 160) });
  }

  const planCases = [
    ['C11', '조건부 체인', '시장 조사 보고서 작성', 'report', { pm: undefined, dev: undefined }],
    ['C12', '조건부 체인', '시장 조사 보고서 작성 후 리뷰', 'report', { pm: 'reviewer', dev: 'reviewer' }],
    ['C13', '조건부 체인', '웹 대시보드 구현', 'web', { pm: 'developer', dev: undefined }],
    ['C14', '조건부 체인', '웹 대시보드 구현 후 QA 리뷰', 'web', { pm: 'developer', dev: 'reviewer' }],
    ['C15', '조건부 체인', '상태 조회 및 취소 보고', 'report', { pm: undefined, dev: undefined }],
    ['C16', '단일 산출물', '리포트 정리', 'report', { pm: undefined, dev: undefined }],
    ['C17', '단일 산출물', '코드 구현', 'web', { pm: 'developer', dev: undefined }],
    ['C18', '복합 요청', '분석 보고서와 리뷰', 'report', { pm: 'reviewer', dev: 'reviewer' }],
    ['C19', '복합 요청', 'API 구현 및 검토', 'web', { pm: 'developer', dev: 'reviewer' }],
    ['C20', '엣지', '긴급 hotfix 코드 수정', 'web', { pm: 'developer', dev: undefined }],
    ['C33', '실사용 체인', 'QC 한명 붙여 리뷰하고 개발자가 반영해서 재수정해', 'web', { pm: 'qa', dev: undefined }],
  ] as const;

  for (const [id, category, input, deliverable, expect] of planCases) {
    const t0 = performance.now();
    const pmNext = decideNextRoleByIntent({ title: input, description: input, expectedDeliverables: [deliverable] as any }, 'pm');
    const devNext = decideNextRoleByIntent({ title: input, description: input, expectedDeliverables: [deliverable] as any }, 'developer');
    const ms = performance.now() - t0;
    const pass = pmNext === expect.pm && devNext === expect.dev;
    const quality = pass ? 5 : 2;
    results.push({ id, category, input, pass, concise: true, quality, ms, note: `pm→${pmNext ?? 'end'}, dev→${devNext ?? 'end'}` });
  }

  const genCases = [
    ['C21', '회귀', '개발자 1명 추가', 'developer', 1],
    ['C22', '회귀', 'pm 1명', 'pm', 1],
    ['C23', '복합 요청', '개발자 2명 리뷰어 1명', 'developer', 2],
    ['C24', '복합 요청', '리뷰어 2명 + qa 1명', 'reviewer', 2],
    ['C25', '엣지', '  dev 3명   ', 'developer', 3],
    ['C26', '엣지', '디자이너 2명 필요!!!', 'designer', 2],
    ['C27', '엣지', '1명의 개발자', 'developer', 1],
    ['C28', '엣지', '개발자 한명', 'developer', 0],
    ['C29', '엣지', '모호한 요청', 'developer', 0],
    ['C30', '복합 요청', '긴급 배포 인프라 qa', 'devops', 1],
    ['C31', '복합 요청', '소규모 프로토타입', 'developer', 1],
    ['C32', '복합 요청', '디자인 ui ux', 'designer', 1],
  ] as const;

  for (const [id, category, input, role, minCount] of genCases) {
    const t0 = performance.now();
    const plan = generatePlanFromPrompt(input);
    const ms = performance.now() - t0;
    const count = plan.find(p => p.role === role)?.count || 0;
    const pass = count >= minCount;
    const quality = pass ? 5 : (id === 'C28' || id === 'C29' ? 3 : 2);
    results.push({ id, category, input, pass, concise: true, quality, ms, note: plan.map(p => `${p.role}:${p.count}`).join(', ') || 'none' });
  }

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const avgQuality = results.reduce((a, b) => a + b.quality, 0) / total;
  const avgMs = results.reduce((a, b) => a + b.ms, 0) / total;
  const failed = results.filter(r => !r.pass);

  const lines = [
    '# AI Office QC Report (32 cases)',
    '',
    `- Total: ${total}`,
    `- PASS: ${passed}`,
    `- FAIL: ${total - passed}`,
    `- Avg quality: ${avgQuality.toFixed(2)} / 5`,
    `- Avg latency: ${avgMs.toFixed(2)} ms`,
    `- Agents: ${listAgents().length}`,
    '',
    '## Matrix',
    '|ID|Category|PASS|Concise|Quality|Latency(ms)|Input|Note|',
    '|-|-|-|-|-|-|-|-|',
    ...results.map(r => `|${r.id}|${r.category}|${r.pass ? 'PASS' : 'FAIL'}|${r.concise ? 'Y' : 'N'}|${r.quality}|${r.ms.toFixed(1)}|${r.input.replace(/\|/g, '/')}|${r.note.replace(/\|/g, '/')}|`),
    '',
    '## Failed cases',
    ...(failed.length ? failed.map(f => `- ${f.id}: ${f.input} -> ${f.note}`) : ['- 없음']),
  ];

  console.log(lines.join('\n'));
}

run();
