import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingType, MeetingProposal, MeetingReview } from '@ai-office/shared';
import { stmts } from './db.js';
import { getAgent, listAgents, transitionAgent } from './agent-manager.js';
import { spawnAgentSession, isDemoMode, parseAgentOutput, cleanupRun, type AgentRun } from './openclaw-adapter.js';

type MeetingListener = () => void;
const listeners: MeetingListener[] = [];
export function onMeetingChange(fn: MeetingListener) { listeners.push(fn); }
function emitChange() { for (const fn of listeners) fn(); }

function rowToMeeting(row: Record<string, unknown>): Meeting {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    type: row.type as MeetingType,
    status: row.status as Meeting['status'],
    participants: JSON.parse((row.participants as string) || '[]'),
    proposals: JSON.parse((row.proposals as string) || '[]'),
    decision: row.decision ? JSON.parse(row.decision as string) : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listMeetings(): Meeting[] {
  return (stmts.listMeetings.all() as Record<string, unknown>[]).map(rowToMeeting);
}

export function getMeeting(id: string): Meeting | null {
  const row = stmts.getMeeting.get(id) as Record<string, unknown> | undefined;
  return row ? rowToMeeting(row) : null;
}

function saveMeeting(m: Meeting) {
  stmts.updateMeeting.run(m.status, JSON.stringify(m.proposals), m.decision ? JSON.stringify(m.decision) : null, m.id);
  emitChange();
}

// Track pending proposals per meeting
const pendingProposals = new Map<string, { total: number; done: number }>();
const pendingReviews = new Map<string, { total: number; done: number }>();

export function createMeeting(title: string, description: string, type: MeetingType, participantIds: string[]): Meeting {
  const id = uuid();
  stmts.insertMeeting.run(id, title, description, type, JSON.stringify(participantIds));
  const meeting = getMeeting(id)!;
  emitChange();
  return meeting;
}

export function startPlanningMeeting(title: string, description: string, pmAgentIds: string[]): Meeting {
  const meeting = createMeeting(title, description, 'planning', pmAgentIds);
  pendingProposals.set(meeting.id, { total: pmAgentIds.length, done: 0 });

  for (const agentId of pmAgentIds) {
    const agent = getAgent(agentId);
    if (!agent) continue;

    const sessionId = `meeting-${meeting.id.slice(0, 8)}-${agent.name.toLowerCase()}-${Date.now()}`;
    const prompt = `You are ${agent.name}, a ${agent.role} in the AI Office.\n\nYou are in a planning meeting. Create a detailed proposal for:\n\n## ${title}\n\n${description}\n\nProvide:\n1. Executive Summary\n2. Detailed Plan with steps\n3. Timeline estimate\n4. Resource requirements\n5. Risk assessment\n\nBe specific and actionable.`;

    try { transitionAgent(agentId, 'working', null, sessionId); } catch { /* may already be working */ }

    spawnAgentSession({
      sessionId,
      agentName: agent.name,
      role: agent.role,
      model: agent.model,
      prompt,
      onComplete: (run) => handleProposalComplete(meeting.id, agentId, agent.name, run),
    });
  }

  return meeting;
}

function handleProposalComplete(meetingId: string, agentId: string, agentName: string, run: AgentRun) {
  const meeting = getMeeting(meetingId);
  if (!meeting) return;

  const content = run.exitCode === 0
    ? parseAgentOutput(run.stdout)
    : `[Error generating proposal: exit ${run.exitCode}]`;

  const proposal: MeetingProposal = {
    agentId,
    agentName,
    content,
    taskId: run.sessionId,
    reviews: [],
  };

  meeting.proposals.push(proposal);
  saveMeeting(meeting);

  // Reset agent
  try { transitionAgent(agentId, 'reviewing', null); } catch { /* ignore */ }
  setTimeout(() => {
    try { transitionAgent(agentId, 'done', null); } catch { /* ignore */ }
    setTimeout(() => {
      try { transitionAgent(agentId, 'idle', null, null); } catch { /* ignore */ }
    }, 1000);
  }, 500);

  cleanupRun(run.sessionId);

  // Check if all proposals are in
  const tracker = pendingProposals.get(meetingId);
  if (tracker) {
    tracker.done++;
    if (tracker.done >= tracker.total) {
      pendingProposals.delete(meetingId);
      // Auto-start review phase
      startReviewPhase(meetingId);
    }
  }
}

export function startReviewPhase(meetingId: string) {
  const meeting = getMeeting(meetingId);
  if (!meeting) return;

  meeting.status = 'reviewing';
  saveMeeting(meeting);

  // Find reviewer agents (not participants)
  const participantSet = new Set(meeting.participants);
  const reviewers = listAgents().filter(a => a.role === 'reviewer' && !participantSet.has(a.id));

  if (reviewers.length === 0) {
    // No reviewers available — mark complete
    meeting.status = 'completed';
    saveMeeting(meeting);
    return;
  }

  // Each reviewer reviews all proposals; first reviewer is the devil's advocate (깐깐이)
  let totalReviews = reviewers.length * meeting.proposals.length;
  pendingReviews.set(meetingId, { total: totalReviews, done: 0 });

  for (let ri = 0; ri < reviewers.length; ri++) {
    const reviewer = reviewers[ri];
    const isDevilsAdvocate = ri === 0;

    for (let pi = 0; pi < meeting.proposals.length; pi++) {
      const proposal = meeting.proposals[pi];
      const sessionId = `review-${meetingId.slice(0, 8)}-${reviewer.name.toLowerCase()}-p${pi}-${Date.now()}`;

      const devilPrompt = isDevilsAdvocate
        ? `You are 깐깐이 (Devil's Advocate). Be EXTREMELY critical. Find EVERY flaw, weakness, and risk. Do not hold back.\n\n`
        : '';

      const prompt = `You are ${reviewer.name}, a reviewer in the AI Office.\n\n${devilPrompt}Review this proposal critically for the meeting "${meeting.title}".\n\nProposal by ${proposal.agentName}:\n${proposal.content.slice(0, 3000)}\n\nRespond in this EXACT format:\nSCORE: [1-10]\nPROS:\n- [pro 1]\n- [pro 2]\nCONS:\n- [con 1]\n- [con 2]\nRISKS:\n- [risk 1]\nSUMMARY: [one paragraph summary]`;

      try { transitionAgent(reviewer.id, 'working', null, sessionId); } catch { /* ignore */ }

      spawnAgentSession({
        sessionId,
        agentName: reviewer.name,
        role: reviewer.role,
        model: reviewer.model,
        prompt,
        onComplete: (run) => handleReviewComplete(meetingId, pi, reviewer.id, reviewer.name, isDevilsAdvocate, run),
      });
    }
  }
}

function parseReviewOutput(text: string): Omit<MeetingReview, 'reviewerAgentId' | 'reviewerName' | 'isDevilsAdvocate'> {
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1]))) : 5;

  const extractList = (label: string): string[] => {
    const regex = new RegExp(`${label}:\\s*\\n((?:[-•*]\\s+.+\\n?)+)`, 'i');
    const match = text.match(regex);
    if (!match) return [];
    return match[1].split('\n').map(l => l.replace(/^[-•*]\s+/, '').trim()).filter(Boolean);
  };

  const summaryMatch = text.match(/SUMMARY:\s*(.+)/i);

  return {
    score,
    pros: extractList('PROS'),
    cons: extractList('CONS'),
    risks: extractList('RISKS'),
    summary: summaryMatch ? summaryMatch[1].trim() : text.slice(0, 200),
  };
}

function handleReviewComplete(meetingId: string, proposalIndex: number, reviewerAgentId: string, reviewerName: string, isDevilsAdvocate: boolean, run: AgentRun) {
  const meeting = getMeeting(meetingId);
  if (!meeting || !meeting.proposals[proposalIndex]) return;

  const output = run.exitCode === 0 ? parseAgentOutput(run.stdout) : 'Review failed';
  const parsed = parseReviewOutput(output);

  const review: MeetingReview = {
    reviewerAgentId,
    reviewerName,
    ...parsed,
    isDevilsAdvocate,
  };

  if (!meeting.proposals[proposalIndex].reviews) {
    meeting.proposals[proposalIndex].reviews = [];
  }
  meeting.proposals[proposalIndex].reviews!.push(review);
  saveMeeting(meeting);

  // Reset reviewer
  try { transitionAgent(reviewerAgentId, 'reviewing', null); } catch { /* ignore */ }
  setTimeout(() => {
    try { transitionAgent(reviewerAgentId, 'done', null); } catch { /* ignore */ }
    setTimeout(() => {
      try { transitionAgent(reviewerAgentId, 'idle', null, null); } catch { /* ignore */ }
    }, 1000);
  }, 500);

  cleanupRun(run.sessionId);

  const tracker = pendingReviews.get(meetingId);
  if (tracker) {
    tracker.done++;
    if (tracker.done >= tracker.total) {
      pendingReviews.delete(meetingId);
      meeting.status = 'completed';
      saveMeeting(meeting);
    }
  }
}

export function decideMeeting(meetingId: string, winnerId: string, feedback: string): Meeting {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  meeting.decision = { winnerId, feedback };
  meeting.status = 'completed';
  saveMeeting(meeting);
  return meeting;
}
