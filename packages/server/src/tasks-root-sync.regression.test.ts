import assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';
import { stmts } from './db.js';
import { syncRootTaskStates } from './task-queue.js';

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

const rootId = uuid();
const childId = uuid();

stmts.insertTask.run(rootId, '루트 작업', '설명', null, JSON.stringify(['web']), 0);
stmts.insertTask.run(childId, '[개발] 하위 작업', '설명', rootId, JSON.stringify(['web']), 0);

// 루트가 진행중이며 결과가 실제 코드인 상태
const stableResult = '<!DOCTYPE html><html><body>ok</body></html>';
stmts.updateTask.run(null, 'in-progress', stableResult, rootId);
// 자식도 진행중이지만 진행문구만 보유
stmts.updateTask.run(null, 'in-progress', '⏳ Step 2/3: review starting...', childId);

syncRootTaskStates();
let root = stmts.getTask.get(rootId) as any;
assert.equal(root.status, 'in-progress');
assert.equal(root.result, stableResult, '루트 result가 진행문구로 덮어쓰이면 안 됨');

// 자식 완료 시 루트도 completed로 동기화
stmts.updateTask.run(null, 'completed', '최종 결과', childId);
syncRootTaskStates();
root = stmts.getTask.get(rootId) as any;
assert.equal(root.status, 'completed');
assert.ok(String(root.result || '').includes('최종 결과'));

console.log('✅ /api/tasks root-child sync regression passed');
