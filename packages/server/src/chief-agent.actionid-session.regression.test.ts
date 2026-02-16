import assert from 'node:assert/strict';
import type { ChiefAction } from '@ai-office/shared';
import { stmts } from './db.js';
import { createAgent, deleteAllAgents, listAgents } from './agent-manager.js';
import { startPlanningMeeting } from './meetings.js';
import {
  __unsafeSetPendingProposalForTest,
  chatWithChief,
  getPendingProposal,
  handleChiefAction,
  notifyChief,
} from './chief-agent.js';

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

// R1) actionId: view-meeting-* 패턴이 정상 동작해야 한다.
{
  const pm = createAgent('PM-1', 'pm', 'claude-opus-4-6');
  const dev = createAgent('DEV-1', 'developer', 'openai-codex/gpt-5.3-codex');
  const meeting = startPlanningMeeting('세션별 회의 결과 테스트', 'desc', [pm.id, dev.id], 'planning');

  notifyChief({
    id: 'notif-meeting-r1',
    type: 'meeting_complete',
    title: meeting.title,
    summary: 'meeting done',
    actions: [{ id: `view-meeting-${meeting.id}`, label: '회의결과 보기', action: 'view_result', params: { meetingId: meeting.id } }],
    meetingId: meeting.id,
    sessionId: 'session-r1',
    createdAt: new Date().toISOString(),
  });

  const res = handleChiefAction('notif-meeting-r1', `view-meeting-${meeting.id}`, { meetingId: meeting.id }, 'session-r1');
  assert.match(res.reply, /회의 결과/);
  assert.match(res.reply, /세션별 회의 결과 테스트/);
}

// R2) 세션 A/B pending proposal 오염 방지: B 승인 시 A 액션은 실행되지 않아야 한다.
{
  const msgA = 'pending-A';
  const msgB = 'pending-B';

  const actionA: ChiefAction = { type: 'create_agent', params: { name: 'Only-A', role: 'qa' } };
  const actionB: ChiefAction = { type: 'create_agent', params: { name: 'Only-B', role: 'developer' } };

  __unsafeSetPendingProposalForTest(msgA, [actionA], 'session-A');
  __unsafeSetPendingProposalForTest(msgB, [actionB], 'session-B');

  chatWithChief('session-B', '승인');

  const names = listAgents().map(a => a.name);
  assert.ok(names.includes('Only-B'), 'session-B의 승인 액션만 실행되어야 함');
  assert.ok(!names.includes('Only-A'), 'session-A의 pending 액션이 섞여 실행되면 안 됨');

  assert.ok(getPendingProposal(msgA)?.length === 1, 'session-A pending proposal은 유지되어야 함');
  assert.ok(!getPendingProposal(msgB), 'session-B pending proposal은 실행 후 제거되어야 함');
}

// R3) Unknown action fallback은 내부 디버그 문자열을 노출하지 않아야 한다.
{
  const res = handleChiefAction('unknown-notif', 'unsupported-raw-action', {}, 'session-r3');
  assert.doesNotMatch(res.reply, /Unsupported actionId/i);
  assert.match(res.reply, /처리하지 못했|다시 시도/);
}

console.log('✅ chief actionId/session regression passed (view-meeting + isolation + fallback)');
