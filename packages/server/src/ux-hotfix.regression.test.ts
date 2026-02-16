import assert from 'node:assert/strict';
import { suggestChainPlan, confirmChainPlan, advanceChainPlan, listActiveChainPlans, markChainCompleted, cancelChainPlan, editChainPlan, markChainRunning, getChainPlan } from './chain-plan.js';
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

// R1) 상태 조회는 액션 제안을 생성하지 않는다 (회귀 유지)
{
  const out = chatWithChief('ux-hotfix-reg', '현재 상태만 알려줘');
  assert.equal(out.async, false);
  assert.ok(out.reply && out.reply.length > 0);
  assert.equal(getPendingProposal(out.messageId), undefined);
}

// R2) 체인 완료/취소 플랜은 active 목록에서 즉시 제외된다
{
  const p1 = suggestChainPlan('task-chain-1', 'QA 이후 수정', '테스트 후 수정 반영', 'pm', ['web']);
  confirmChainPlan(p1.id);
  advanceChainPlan(p1.id); // move to next step (running)
  markChainCompleted(p1.id); // terminal forced recalc path

  const p2 = suggestChainPlan('task-chain-2', '단발성 작업', '취소 시나리오', 'pm', ['report']);
  cancelChainPlan(p2.id);

  const active = listActiveChainPlans();
  assert.ok(active.every(p => p.status !== 'completed' && p.status !== 'cancelled'));
  assert.ok(!active.find(p => p.id === p1.id));
  assert.ok(!active.find(p => p.id === p2.id));
}

// R3) 1/1 완료 플랜은 completed로 확정되고 active에서 사라진다
{
  const p = suggestChainPlan('task-chain-3', '단일 단계', '원스텝 체인', 'pm', ['report']);
  editChainPlan(p.id, [p.steps[0]]); // force single-step
  confirmChainPlan(p.id);
  markChainRunning(p.id);
  markChainCompleted(p.id);

  const saved = getChainPlan(p.id);
  assert.equal(saved?.status, 'completed');

  const active = listActiveChainPlans();
  assert.ok(!active.find(x => x.id === p.id));
}

console.log('✅ UX hotfix regression passed (status-query + chain-panel cleanup + 1/1 hidden)');
