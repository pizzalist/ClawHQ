/**
 * Tech Spec Meeting — server-side logic
 *
 * Orchestrates a 4-role technical specification discussion:
 *   CTO → Frontend Lead → Backend Lead → QA/Devil's Advocate → Synthesis
 *
 * This module exports functions callable by the meeting system without
 * modifying the existing meetings.ts file.
 */

import { v4 as uuid } from 'uuid';
import type {
  Meeting,
  TechSpecRole,
  TechSpecParticipant,
  TechSpecMeetingData,
  TechSpecConflict,
  AgentRole,
} from '@ai-office/shared';
import { TECH_SPEC_ROLES, TECH_SPEC_SYNTHESIS_PROMPT } from '@ai-office/shared';
import { stmts } from './db.js';
import { getAgent, listAgents, transitionAgent } from './agent-manager.js';
import { spawnAgentSession, parseAgentOutput, cleanupRun, type AgentRun } from './openclaw-adapter.js';
import { onMeetingChange } from './meetings.js';

// Re-use the meeting change broadcaster
type MeetingListener = () => void;
const localListeners: MeetingListener[] = [];
export function onTechSpecChange(fn: MeetingListener) { localListeners.push(fn); }
function emitChange() { for (const fn of localListeners) fn(); }

// ---- Helpers ----

function getMeetingRow(id: string): Meeting | null {
  const row = stmts.getMeeting.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    type: row.type as any,
    status: row.status as any,
    participants: JSON.parse((row.participants as string) || '[]'),
    proposals: JSON.parse((row.proposals as string) || '[]'),
    decision: row.decision ? JSON.parse(row.decision as string) : null,
    techSpec: row.proposals ? parseTechSpecFromProposals(row.proposals as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * We store TechSpecMeetingData inside the proposals JSON column
 * as a special envelope: { _techSpec: TechSpecMeetingData }
 */
function parseTechSpecFromProposals(raw: string): TechSpecMeetingData | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed._techSpec) return parsed._techSpec as TechSpecMeetingData;
  } catch { /* ignore */ }
  return undefined;
}

function saveTechSpecData(meetingId: string, data: TechSpecMeetingData, status: Meeting['status'] = 'active') {
  const envelope = JSON.stringify({ _techSpec: data });
  stmts.updateMeeting.run(status, envelope, null, meetingId);
  emitChange();
}

// ---- Role → Agent auto-suggestion ----

export interface TechSpecRoleAssignment {
  role: TechSpecRole;
  agentId: string;
}

/**
 * Auto-suggest agents for tech-spec roles based on their AgentRole.
 * Returns suggestions; user can override.
 */
export function suggestTechSpecAgents(): TechSpecRoleAssignment[] {
  const agents = listAgents();
  const suggestions: TechSpecRoleAssignment[] = [];
  const used = new Set<string>();

  const roleOrder: TechSpecRole[] = ['cto', 'frontend-lead', 'backend-lead', 'qa-devils-advocate'];

  for (const tsRole of roleOrder) {
    const config = TECH_SPEC_ROLES[tsRole];
    // Prefer matching agent role, then any idle agent
    let candidate = agents.find(a => a.role === config.suggestedAgentRole && !used.has(a.id));
    if (!candidate) {
      candidate = agents.find(a => !used.has(a.id));
    }
    if (candidate) {
      suggestions.push({ role: tsRole, agentId: candidate.id });
      used.add(candidate.id);
    }
  }

  return suggestions;
}

// ---- Start Tech Spec Meeting ----

export function startTechSpecMeeting(
  title: string,
  description: string,
  assignments: TechSpecRoleAssignment[],
): Meeting {
  // Validate: need all 4 roles
  const roleSet = new Set(assignments.map(a => a.role));
  const required: TechSpecRole[] = ['cto', 'frontend-lead', 'backend-lead', 'qa-devils-advocate'];
  for (const r of required) {
    if (!roleSet.has(r)) throw new Error(`Missing required role: ${r}`);
  }

  const participantIds = assignments.map(a => a.agentId);
  const id = uuid();
  stmts.insertMeeting.run(id, title, description, 'tech-spec', JSON.stringify(participantIds));

  // Build initial tech spec data
  const participants: TechSpecParticipant[] = assignments.map(a => {
    const agent = getAgent(a.agentId);
    return {
      agentId: a.agentId,
      agentName: agent?.name || 'Unknown',
      role: a.role,
      spec: null,
      status: 'pending',
    };
  });

  const techSpec: TechSpecMeetingData = {
    participants,
    conflicts: [],
    synthesis: null,
    synthesisStatus: 'pending',
  };

  saveTechSpecData(id, techSpec);

  // Spawn agent sessions for each role
  const task = `${title}\n\n${description}`;

  for (const participant of techSpec.participants) {
    const agent = getAgent(participant.agentId);
    if (!agent) continue;

    const config = TECH_SPEC_ROLES[participant.role];
    const sessionId = `techspec-${id.slice(0, 8)}-${participant.role}-${Date.now()}`;
    const prompt = `You are ${agent.name}, acting as ${config.label} in a technical specification meeting.\n\n${config.prompt(task)}\n\nBe thorough and specific. Use markdown formatting.`;

    participant.status = 'working';

    try { transitionAgent(participant.agentId, 'working', null, sessionId); } catch { /* may already be working */ }

    spawnAgentSession({
      sessionId,
      agentName: agent.name,
      role: agent.role,
      model: agent.model,
      prompt,
      onComplete: (run) => handleSpecComplete(id, participant.agentId, participant.role, run),
    });
  }

  saveTechSpecData(id, techSpec);

  const meeting = getMeetingRow(id)!;
  return meeting;
}

function handleSpecComplete(meetingId: string, agentId: string, role: TechSpecRole, run: AgentRun) {
  const row = stmts.getMeeting.get(meetingId) as Record<string, unknown> | undefined;
  if (!row) return;

  const techSpec = parseTechSpecFromProposals(row.proposals as string);
  if (!techSpec) return;

  const participant = techSpec.participants.find(p => p.agentId === agentId && p.role === role);
  if (!participant) return;

  const content = run.exitCode === 0
    ? parseAgentOutput(run.stdout)
    : `[Error generating spec: exit ${run.exitCode}]\n${run.stderr?.slice(0, 500) || ''}`;

  participant.spec = content;
  participant.status = run.exitCode === 0 ? 'done' : 'error';

  // Reset agent state
  try { transitionAgent(agentId, 'reviewing', null); } catch { /* ignore */ }
  setTimeout(() => {
    try { transitionAgent(agentId, 'done', null); } catch { /* ignore */ }
    setTimeout(() => {
      try { transitionAgent(agentId, 'idle', null, null); } catch { /* ignore */ }
    }, 1000);
  }, 500);

  cleanupRun(run.sessionId);

  // Check if all participants are done
  const allDone = techSpec.participants.every(p => p.status === 'done' || p.status === 'error');

  if (allDone) {
    // Detect conflicts
    techSpec.conflicts = detectConflicts(techSpec.participants);
    // Start synthesis
    startSynthesis(meetingId, techSpec);
  } else {
    saveTechSpecData(meetingId, techSpec);
  }
}

// ---- Conflict Detection ----

function detectConflicts(participants: TechSpecParticipant[]): TechSpecConflict[] {
  const conflicts: TechSpecConflict[] = [];

  // Simple keyword-based conflict detection
  const techKeywords: Record<string, string[]> = {
    'Frontend Framework': ['react', 'vue', 'svelte', 'angular', 'next.js', 'nuxt', 'solid'],
    'Backend Framework': ['express', 'fastify', 'nestjs', 'django', 'flask', 'spring', 'gin'],
    'Database': ['postgresql', 'postgres', 'mysql', 'mongodb', 'sqlite', 'redis', 'dynamodb'],
    'Language': ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin'],
    'Deployment': ['docker', 'kubernetes', 'k8s', 'serverless', 'lambda', 'vercel', 'aws', 'gcp'],
    'State Management': ['redux', 'zustand', 'mobx', 'jotai', 'recoil', 'pinia', 'vuex'],
  };

  for (const [topic, keywords] of Object.entries(techKeywords)) {
    const positions: Array<{ role: TechSpecRole; stance: string }> = [];

    for (const p of participants) {
      if (!p.spec) continue;
      const lower = p.spec.toLowerCase();
      const found = keywords.filter(kw => lower.includes(kw));
      if (found.length > 0) {
        positions.push({ role: p.role, stance: found.join(', ') });
      }
    }

    // Only flag as conflict if different participants mention different things
    if (positions.length >= 2) {
      const stances = new Set(positions.map(p => p.stance));
      if (stances.size > 1) {
        conflicts.push({ topic, positions });
      }
    }
  }

  return conflicts;
}

// ---- Synthesis ----

function startSynthesis(meetingId: string, techSpec: TechSpecMeetingData) {
  techSpec.synthesisStatus = 'working';
  saveTechSpecData(meetingId, techSpec, 'reviewing');

  // Find CTO agent for synthesis (or first available)
  const ctoParticipant = techSpec.participants.find(p => p.role === 'cto');
  const agent = ctoParticipant ? getAgent(ctoParticipant.agentId) : null;

  if (!agent) {
    techSpec.synthesis = '[No CTO agent available for synthesis]';
    techSpec.synthesisStatus = 'done';
    saveTechSpecData(meetingId, techSpec, 'completed');
    return;
  }

  // Build synthesis prompt with all specs
  const specsText = techSpec.participants.map(p => {
    const config = TECH_SPEC_ROLES[p.role];
    return `## ${config.label} (${p.agentName})\n\n${p.spec || '[No spec provided]'}`;
  }).join('\n\n---\n\n');

  const conflictsText = techSpec.conflicts.length > 0
    ? `\n\n## Detected Conflicts\n${techSpec.conflicts.map(c =>
        `- **${c.topic}**: ${c.positions.map(p => `${p.role}: ${p.stance}`).join(' vs ')}`
      ).join('\n')}`
    : '';

  const sessionId = `techspec-synth-${meetingId.slice(0, 8)}-${Date.now()}`;
  const prompt = `You are ${agent.name}, acting as CTO synthesizer.\n\n${TECH_SPEC_SYNTHESIS_PROMPT(specsText + conflictsText)}\n\nCreate a unified spec with:\n1. Architecture Overview\n2. Tech Stack (resolved)\n3. Module Breakdown\n4. API Design Summary\n5. Database Schema\n6. Sprint Plan\n7. Risk Mitigation\n\nUse markdown formatting.`;

  try { transitionAgent(agent.id, 'working', null, sessionId); } catch { /* ignore */ }

  spawnAgentSession({
    sessionId,
    agentName: agent.name,
    role: agent.role,
    model: agent.model,
    prompt,
    onComplete: (run) => handleSynthesisComplete(meetingId, agent.id, run),
  });
}

function handleSynthesisComplete(meetingId: string, agentId: string, run: AgentRun) {
  const row = stmts.getMeeting.get(meetingId) as Record<string, unknown> | undefined;
  if (!row) return;

  const techSpec = parseTechSpecFromProposals(row.proposals as string);
  if (!techSpec) return;

  techSpec.synthesis = run.exitCode === 0
    ? parseAgentOutput(run.stdout)
    : `[Synthesis failed: exit ${run.exitCode}]`;
  techSpec.synthesisStatus = 'done';

  saveTechSpecData(meetingId, techSpec, 'completed');

  // Reset agent
  try { transitionAgent(agentId, 'reviewing', null); } catch { /* ignore */ }
  setTimeout(() => {
    try { transitionAgent(agentId, 'done', null); } catch { /* ignore */ }
    setTimeout(() => {
      try { transitionAgent(agentId, 'idle', null, null); } catch { /* ignore */ }
    }, 1000);
  }, 500);

  cleanupRun(run.sessionId);
}

// ---- Re-run a specific role ----

export function rerunTechSpecRole(meetingId: string, role: TechSpecRole): void {
  const row = stmts.getMeeting.get(meetingId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Meeting not found');

  const techSpec = parseTechSpecFromProposals(row.proposals as string);
  if (!techSpec) throw new Error('Not a tech-spec meeting');

  const participant = techSpec.participants.find(p => p.role === role);
  if (!participant) throw new Error(`Role ${role} not found`);

  const agent = getAgent(participant.agentId);
  if (!agent) throw new Error('Agent not found');

  participant.spec = null;
  participant.status = 'working';
  techSpec.synthesis = null;
  techSpec.synthesisStatus = 'pending';

  saveTechSpecData(meetingId, techSpec, 'active');

  const title = row.title as string;
  const description = (row.description as string) || '';
  const task = `${title}\n\n${description}`;
  const config = TECH_SPEC_ROLES[role];
  const sessionId = `techspec-${meetingId.slice(0, 8)}-${role}-rerun-${Date.now()}`;
  const prompt = `You are ${agent.name}, acting as ${config.label} in a technical specification meeting.\n\n${config.prompt(task)}\n\nBe thorough and specific. Use markdown formatting.`;

  try { transitionAgent(agent.id, 'working', null, sessionId); } catch { /* ignore */ }

  spawnAgentSession({
    sessionId,
    agentName: agent.name,
    role: agent.role,
    model: agent.model,
    prompt,
    onComplete: (run) => handleSpecComplete(meetingId, participant.agentId, role, run),
  });
}

/**
 * Get tech spec data for a meeting. Used by API routes.
 */
export function getTechSpecData(meetingId: string): TechSpecMeetingData | null {
  const row = stmts.getMeeting.get(meetingId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseTechSpecFromProposals(row.proposals as string) || null;
}
