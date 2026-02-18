import assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';
import { chatWithChief, getPendingProposal } from './chief-agent.js';
import { stmts } from './db.js';

function resetAll() {
  stmts.deleteAllReviewScores.run();
  stmts.deleteAllProposals.run();
  stmts.deleteAllDecisionItems.run();
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllMeetings.run();
  stmts.deleteAllEvents.run();
}

resetAll();

// Seed internal DB state for realistic status/ETA lookups.
const t1 = uuid();
const t2 = uuid();
const t3 = uuid();

stmts.insertTask.run(t1, '핫픽스 배포', '운영 버그 핫픽스', null, JSON.stringify(['web']), 0);
stmts.insertTask.run(t2, 'QA 재검증', '배포 후 검증', null, JSON.stringify(['report']), 0);
stmts.insertTask.run(t3, '리포트 정리', '완료 보고서 작성', null, JSON.stringify(['report']), 0);

stmts.updateTask.run(null, 'in-progress', null, t1);
stmts.updateTask.run(null, 'pending', null, t2);
stmts.updateTask.run(null, 'completed', 'done', t3);

const cases = [
  '진행중이야?',
  '상태 재확인',
  'ETA 알려줘',
  '지금 진행 상황 어때?',
  '현재 상태만 알려줘',
  '다시 상태 체크해줘',
  // New patterns added for stabilization
  '다 됐어?',
  '아직이야?',
  '결과 나왔어?',
  '끝났어?',
  '언제 줘?',
  '언제 돼?',
];

for (const [idx, input] of cases.entries()) {
  const out = chatWithChief(`chief-intent-reg-${idx}`, input);
  assert.equal(out.async, false, `조회성 요청은 즉시 응답해야 함: ${input}`);
  assert.ok(out.reply && out.reply.length > 0, `응답 본문이 비어 있으면 안 됨: ${input}`);
  assert.ok(!/create_task|실행 후보 액션|생성할까요|승인하면/.test(out.reply || ''), `조회성 요청에 실행 제안이 섞이면 안 됨: ${input} -> ${out.reply}`);
  assert.ok(/(\d+건|완료|진행|대기)/.test(out.reply || ''), `내부 DB 조회 요약 형식이 필요함: ${input} -> ${out.reply}`);
  assert.equal(getPendingProposal(out.messageId), undefined, `조회성 요청에 pending 액션이 생기면 안 됨: ${input}`);
}

console.log(`✅ chief monitoring regression passed: ${cases.length} cases`);
