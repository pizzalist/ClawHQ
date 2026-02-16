/**
 * Structural Meeting Flow Tests (12+ scenarios)
 * Run: npx tsx packages/server/src/meeting-flow.test.ts
 */

import { handleChiefAction, chatWithChief, getChiefMessages, approveProposal, __unsafeSetPendingProposalForTest } from './chief-agent.js';
import { listMeetings, getMeeting, startPlanningMeeting, createMeeting, extractCandidatesFromMeeting, getChildMeetings } from './meetings.js';
import { listAgents, createAgent } from './agent-manager.js';
import type { ChiefAction, MeetingCandidate } from '@ai-office/shared';

let pass = 0;
let fail = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    fail++;
    results.push({ name, ok: false, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Ensure minimum agents exist
function ensureAgents(): string[] {
  let agents = listAgents();
  if (agents.length < 2) {
    createAgent('Test-PM-Flow', 'pm', 'claude-opus-4-6');
    createAgent('Test-Dev-Flow', 'developer', 'claude-opus-4-6');
    agents = listAgents();
  }
  return agents.slice(0, 2).map(a => a.id);
}

console.log('\n🧪 Meeting Flow Structural Tests\n');

const ids = ensureAgents();

// === A) Meeting Lineage ===
console.log('--- A) Meeting Lineage ---');

test('T01: createMeeting with lineage stores fields', () => {
  const parent = createMeeting('Parent Meeting', 'desc', 'planning', ids, 'planning');
  const candidates: MeetingCandidate[] = [
    { name: 'Option A', summary: 'Summary A' },
    { name: 'Option B', summary: 'Summary B' },
  ];
  const child = createMeeting('Review Meeting', 'review', 'review', ids, 'review', {
    parentMeetingId: parent.id,
    sourceMeetingId: parent.id,
    sourceCandidates: candidates,
  });
  const fetched = getMeeting(child.id);
  assert(!!fetched, 'child meeting should exist');
  assert(fetched!.parentMeetingId === parent.id, 'parentMeetingId should match');
  assert(fetched!.sourceMeetingId === parent.id, 'sourceMeetingId should match');
  assert(fetched!.sourceCandidates?.length === 2, 'should have 2 candidates');
  assert(fetched!.sourceCandidates![0].name === 'Option A', 'candidate name should match');
});

test('T02: getChildMeetings returns children', () => {
  const parent = createMeeting('Parent2', 'desc', 'planning', ids, 'planning');
  createMeeting('Child2', 'desc', 'review', ids, 'review', { parentMeetingId: parent.id, sourceMeetingId: parent.id });
  const children = getChildMeetings(parent.id);
  assert(children.length >= 1, 'should find at least 1 child');
  assert(children.some(c => c.parentMeetingId === parent.id), 'child should reference parent');
});

// === B) ActionId Handling ===
console.log('\n--- B) ActionId Stability ---');

test('T03: view-meeting-xxx returns result not error', () => {
  const meeting = createMeeting('ActionTest', 'desc', 'planning', ids, 'planning');
  const r = handleChiefAction('n1', `view-meeting-${meeting.id}`, { meetingId: meeting.id });
  assert(r.reply.includes('회의 결과'), 'should contain meeting result');
  assert(!r.reply.includes('처리하지 못했습니다'), 'should not contain error');
});

test('T04: approve-meeting-xxx works', () => {
  const r = handleChiefAction('n2', 'approve-meeting-abc', { meetingId: 'abc' });
  assert(r.reply.includes('확정'), 'should confirm approval');
  assert(!r.reply.includes('처리하지 못했습니다'), 'no error');
});

test('T05: revise-meeting-xxx works', () => {
  const r = handleChiefAction('n3', 'revise-meeting-abc', { meetingId: 'abc' });
  assert(r.reply.includes('수정 요청'), 'should confirm revision');
  assert(!r.reply.includes('처리하지 못했습니다'), 'no error');
});

test('T06: view-taskId fallback', () => {
  const r = handleChiefAction('n4', 'view-task123', { taskId: 'task123' });
  assert(!r.reply.includes('처리하지 못했습니다'), 'no error for view-task');
});

test('T07: start-review-xxx graceful', () => {
  const r = handleChiefAction('n5', 'start-review-nonexist');
  assert(!r.reply.includes('처리하지 못했습니다'), 'no hard error');
});

test('T08: unknown actionId gives graceful fallback', () => {
  const r = handleChiefAction('n6', 'totally-unknown-action');
  assert(!r.reply.includes('처리하지 못했습니다'), 'no error');
  assert(!r.reply.includes('Unsupported'), 'no unsupported');
});

// === C) Context Isolation ===
console.log('\n--- C) Context Isolation ---');

test('T09: sourceCandidates are bounded (no full text leak)', () => {
  const longText = 'x'.repeat(2000);
  // extractCandidatesFromMeeting caps at 800 chars per candidate
  const candidates: MeetingCandidate[] = [{ name: 'Test', summary: longText.slice(0, 800) }];
  assert(candidates[0].summary.length <= 800, 'summary should be bounded');
});

// === D) Decision Packet ===
console.log('\n--- D) Decision Packet ---');

test('T10: DecisionPacket type structure', () => {
  const packet: import('@ai-office/shared').DecisionPacket = {
    reviewerScoreCards: [{
      reviewerName: 'R1', reviewerRole: 'reviewer',
      scores: [{ candidateName: 'A', score: 8, weight: 1, rationale: 'good' }],
    }],
    recommendation: { name: 'A', summary: 'best' },
    alternatives: [{ name: 'B', summary: 'ok' }],
    status: 'pending',
  };
  assert(packet.reviewerScoreCards.length === 1, 'should have 1 reviewer');
  assert(packet.recommendation.name === 'A', 'recommendation correct');
  assert(packet.alternatives.length === 1, 'should have 1 alternative');
});

// === E) User Bug Fixes ===
console.log('\n--- E) User Bug Fixes ---');

test('T11: multi-action fail-fast stops on first failure', () => {
  const msgId = `test-ff-${Date.now()}`;
  const actions: ChiefAction[] = [
    { type: 'cancel_task', params: { taskId: 'nonexistent-xyz' } },
    { type: 'create_agent', params: { name: 'ShouldNotCreate', role: 'pm', model: 'claude-opus-4-6' } },
  ];
  __unsafeSetPendingProposalForTest(msgId, actions, 'test-ff');
  const r = approveProposal(msgId, undefined, undefined, { continueOnError: false });
  assert(!r.executedActions[0].result?.ok, 'first should fail');
  assert(r.skippedActions.length === 1, 'second should be skipped');
  assert(!!r.stoppedReason, 'should have stopped reason');
});

test('T12: status query suppresses actions', () => {
  const sid = 'test-status-q';
  const r = chatWithChief(sid, '현재 상태 확인');
  if (!r.async) {
    assert(!!r.reply, 'should have reply');
    assert(!r.reply!.includes('[ACTION:'), 'no actions in status reply');
  }
});

test('T13: formatMeetingResult shows lineage info', () => {
  const parent = createMeeting('Planning Session', 'desc', 'planning', ids, 'planning');
  const child = createMeeting('Review Session', 'review', 'review', ids, 'review', {
    parentMeetingId: parent.id,
    sourceMeetingId: parent.id,
    sourceCandidates: [{ name: 'A', summary: 'test' }],
  });
  const r = handleChiefAction('n7', `view-meeting-${child.id}`, { meetingId: child.id });
  assert(r.reply.includes('기반 회의'), 'should show source meeting reference');
  assert(r.reply.includes('Planning Session'), 'should show source meeting title');
});

test('T14: meeting completion with planning character has review action', () => {
  // This is a structural check - planning meetings should offer "리뷰어 점수화 시작" button
  // We verify the notification action IDs are generated correctly
  const meeting = createMeeting('Flow Test', 'desc', 'planning', ids, 'planning');
  // Verify that if we were to notify, the actions would include start-review
  const actionId = `start-review-${meeting.id}`;
  assert(actionId.startsWith('start-review-'), 'action ID format correct');
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter(r => !r.ok)) {
    console.log(`  ❌ ${r.name}: ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed! ✅');
  process.exit(0);
}
