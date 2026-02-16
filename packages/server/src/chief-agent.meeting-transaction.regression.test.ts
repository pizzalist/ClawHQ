import assert from 'node:assert/strict';
import { listAgents, createAgent, deleteAllAgents } from './agent-manager.js';
import { listMeetings } from './meetings.js';
import type { ChiefAction } from '@ai-office/shared';
import { approveProposal, __unsafeSetPendingProposalForTest } from './chief-agent.js';
import { stmts } from './db.js';

function resetAll() {
  stmts.deleteAllReviewScores.run();
  stmts.deleteAllProposals.run();
  stmts.deleteAllDecisionItems.run();
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllMeetings.run();
  stmts.deleteAllEvents.run();
  deleteAllAgents();
}

resetAll();

// R1) start_meeting: pm 2명 요청 시 부족 인원 자동 생성 후 회의 시작 성공
{
  createAgent('Solo PM', 'pm', 'claude-opus-4-6');
  const beforeAgents = listAgents().length;

  const messageId = 'test-meeting-autofill';
  const actions: ChiefAction[] = [{
    type: 'start_meeting',
    params: { title: 'PM 2명 킥오프', participants: 'pm 2명 필요', character: 'planning' },
  }];

  __unsafeSetPendingProposalForTest(messageId, actions, 'reg-meeting');
  const result = approveProposal(messageId);

  assert.equal(result.executedActions.length, 1);
  assert.equal(result.executedActions[0].result?.ok, true);

  const afterAgents = listAgents().length;
  assert.ok(afterAgents >= beforeAgents + 1, '부족한 PM 1명 이상 자동 생성되어야 함');

  const meetings = listMeetings();
  const meeting = meetings.find(m => m.title === 'PM 2명 킥오프');
  assert.ok(meeting, '회의가 생성되어야 함');
  assert.ok((meeting?.participants || []).length >= 2, '회의 참여자는 최소 2명이어야 함');
}

// R2) multi-action fail-fast: 2번째 실패 시 3번째 이후 미실행
{
  const messageId = 'test-fail-fast-default';
  const actions: ChiefAction[] = [
    { type: 'create_agent', params: { name: 'A1', role: 'developer' } },
    { type: 'reset_agent', params: { agentId: 'missing-agent-id' } }, // 실패 유도
    { type: 'create_agent', params: { name: 'A3-should-skip', role: 'qa' } },
    { type: 'create_agent', params: { name: 'A4-should-skip', role: 'designer' } },
    { type: 'create_agent', params: { name: 'A5-should-skip', role: 'reviewer' } },
  ];

  __unsafeSetPendingProposalForTest(messageId, actions, 'reg-failfast');
  const result = approveProposal(messageId);

  assert.equal(result.executedActions.length, 2, '2번째 실패 즉시 중단되어야 함');
  assert.equal(result.executedActions[0].result?.ok, true);
  assert.equal(result.executedActions[1].result?.ok, false);
  assert.ok(result.stoppedReason && result.stoppedReason.length > 0, '중단 사유가 포함되어야 함');
  assert.equal(result.skippedActions.length, 3, '3~5번째 액션은 미실행이어야 함');

  const names = listAgents().map(a => a.name);
  assert.ok(names.includes('A1'));
  assert.ok(!names.includes('A3-should-skip'));
  assert.ok(!names.includes('A4-should-skip'));
  assert.ok(!names.includes('A5-should-skip'));
}

// R3) 승인 흐름 회귀: continueOnError=true 옵션 시 후속 액션 계속 실행 가능
{
  const messageId = 'test-continue-on-error';
  const actions: ChiefAction[] = [
    { type: 'create_agent', params: { name: 'B1', role: 'developer' } },
    { type: 'reset_agent', params: { agentId: 'missing-agent-id-2' } }, // 실패 유도
    { type: 'create_agent', params: { name: 'B3', role: 'qa' } },
  ];

  __unsafeSetPendingProposalForTest(messageId, actions, 'reg-continue');
  const result = approveProposal(messageId, undefined, undefined, { continueOnError: true });

  assert.equal(result.executedActions.length, 3, 'continueOnError=true면 실패 후에도 계속 실행되어야 함');
  assert.equal(result.skippedActions.length, 0);

  const names = listAgents().map(a => a.name);
  assert.ok(names.includes('B1'));
  assert.ok(names.includes('B3'));
}

console.log('✅ chief meeting/multi-action regression passed (auto-fill + fail-fast + approval option)');
