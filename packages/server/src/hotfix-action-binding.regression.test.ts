/**
 * Hotfix A regression tests
 * Run: npx tsx packages/server/src/hotfix-action-binding.regression.test.ts
 */

import { __unsafeSetPendingProposalForTest, approveProposal, handleChiefAction } from './chief-agent.js';
import { listAgents, createAgent } from './agent-manager.js';
import type { ChiefAction } from '@ai-office/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function ensureAgentId(): string {
  const existing = listAgents();
  if (existing.length > 0) return existing[0].id;
  return createAgent('Hotfix-Agent', 'developer', 'openai-codex/gpt-5.3-codex').id;
}

console.log('\n🧪 Hotfix A regression tests\n');

const agentId = ensureAgentId();

// 1) create_task -> assign_task placeholder binding (20회)
let assignFailures = 0;
for (let i = 0; i < 20; i++) {
  const messageId = `hotfix-bind-${Date.now()}-${i}`;
  const actions: ChiefAction[] = [
    {
      type: 'create_task',
      params: {
        title: `Hotfix bind task ${i}`,
        description: 'binding regression',
        assignRole: 'developer',
      },
    },
    {
      type: 'assign_task',
      params: {
        taskId: '(생성된 taskId)',
        agentId,
      },
    },
  ];

  __unsafeSetPendingProposalForTest(messageId, actions, 'hotfix-session');
  const result = approveProposal(messageId);
  const assignResult = result.executedActions[1]?.result;
  if (!assignResult?.ok) {
    assignFailures++;
    console.log(`  ❌ iteration ${i + 1}: ${assignResult?.message}`);
  }
}
assert(assignFailures === 0, `create+assign 20회 중 실패 ${assignFailures}건`);
console.log('  ✅ create+assign 20회: task not found 0건');

// 2) 동일 확정 액션 2회 클릭 -> 1회만 처리
const notificationId = `hotfix-notif-${Date.now()}`;
const first = handleChiefAction(notificationId, 'approve-task-xyz', { taskId: 'xyz' }, 'hotfix-session');
const second = handleChiefAction(notificationId, 'approve-task-xyz', { taskId: 'xyz' }, 'hotfix-session');

assert(first.reply.includes('확정되었습니다'), '첫 확정 응답이 정상이어야 합니다');
assert(second.reply.includes('이미 처리된 요청'), '두 번째 확정은 idempotent 차단되어야 합니다');
console.log('  ✅ 동일 확정 2회 클릭: 1회만 반영');

console.log('\n🎉 Hotfix A regression tests passed\n');
