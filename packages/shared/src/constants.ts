import type { AgentRole, AgentState, AgentModel } from './types.js';

export const AGENT_STATES: AgentState[] = ['idle', 'working', 'reviewing', 'error', 'done', 'waiting'];

export const AGENT_ROLES: AgentRole[] = ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'];

export const AGENT_MODELS: AgentModel[] = [
  'claude-opus-4-6',
  'claude-sonnet-4',
  'openai-codex/o3',
  'openai-codex/gpt-5.3-codex',
];

export const ROLE_LABELS: Record<AgentRole, string> = {
  pm: 'Project Manager',
  developer: 'Developer',
  reviewer: 'Code Reviewer',
  designer: 'Designer',
  devops: 'DevOps',
  qa: 'QA Engineer',
};

export const ROLE_EMOJI: Record<AgentRole, string> = {
  pm: '🍥',       // Naruto
  developer: '⚡', // Sasuke
  reviewer: '👁️', // Kakashi / Sharingan
  designer: '🌸',  // Sakura
  devops: '🐍',    // Orochimaru vibe
  qa: '🐸',        // Jiraiya / toad
};

export const STATE_COLORS: Record<AgentState, string> = {
  idle: '#6b7280',
  working: '#3b82f6',
  reviewing: '#f59e0b',
  error: '#ef4444',
  done: '#10b981',
  waiting: '#8b5cf6',
};

// Valid FSM transitions
export const STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ['working', 'waiting'],
  working: ['reviewing', 'done', 'error', 'idle'],
  reviewing: ['done', 'error', 'working'],
  error: ['idle', 'working'],
  done: ['idle'],
  waiting: ['working', 'idle'],
};

export const TEAM_PRESETS: import('./types.js').TeamPreset[] = [
  {
    id: 'web-dev',
    name: 'Web Dev Team',
    description: 'PM + 2 Developers + Code Reviewer',
    agents: [
      { name: 'Alice', role: 'pm', model: 'claude-opus-4-6' },
      { name: 'Bob', role: 'developer', model: 'claude-sonnet-4' },
      { name: 'Charlie', role: 'developer', model: 'openai-codex/o3' },
      { name: 'Diana', role: 'reviewer', model: 'claude-opus-4-6' },
    ],
  },
  {
    id: 'content',
    name: 'Content Team',
    description: 'PM + Designer + Developer (Writer)',
    agents: [
      { name: 'Alice', role: 'pm', model: 'claude-opus-4-6' },
      { name: 'Eve', role: 'designer', model: 'claude-sonnet-4' },
      { name: 'Bob', role: 'developer', model: 'claude-sonnet-4' },
    ],
  },
  {
    id: 'full-stack',
    name: 'Full Stack',
    description: 'PM + Frontend + Backend + DevOps + Reviewer',
    agents: [
      { name: 'Alice', role: 'pm', model: 'claude-opus-4-6' },
      { name: 'Bob', role: 'developer', model: 'claude-sonnet-4' },
      { name: 'Charlie', role: 'developer', model: 'openai-codex/o3' },
      { name: 'Frank', role: 'devops', model: 'openai-codex/gpt-5.3-codex' },
      { name: 'Diana', role: 'reviewer', model: 'claude-opus-4-6' },
    ],
  },
];

// Chain defines the role flow: PM → Developer → Reviewer → Done
export const CHAIN_NEXT_ROLE: Partial<Record<import('./types.js').AgentRole, import('./types.js').AgentRole>> = {
  pm: 'developer',
  developer: 'reviewer',
};

export const CHAIN_STEP_LABELS: Partial<Record<import('./types.js').AgentRole, string>> = {
  pm: 'Plan',
  developer: 'Implement',
  reviewer: 'Review',
};

// Tech Spec role config
export const TECH_SPEC_ROLES: Record<import('./types.js').TechSpecRole, {
  label: string;
  emoji: string;
  color: string;
  suggestedAgentRole: import('./types.js').AgentRole;
  prompt: (task: string) => string;
}> = {
  'cto': {
    label: 'CTO',
    emoji: '👔',
    color: '#8b5cf6', // purple
    suggestedAgentRole: 'pm',
    prompt: (task) => `As CTO, define the architecture, tech stack, module breakdown, and sprint plan for: ${task}`,
  },
  'frontend-lead': {
    label: 'Frontend Lead',
    emoji: '🎨',
    color: '#3b82f6', // blue
    suggestedAgentRole: 'developer',
    prompt: (task) => `As Frontend Lead, spec the UI/UX, components, state management, and user flows for: ${task}`,
  },
  'backend-lead': {
    label: 'Backend Lead',
    emoji: '⚙️',
    color: '#10b981', // green
    suggestedAgentRole: 'developer',
    prompt: (task) => `As Backend Lead, spec the API design, DB schema, WebSocket events, and deployment plan for: ${task}`,
  },
  'qa-devils-advocate': {
    label: "QA / Devil's Advocate (깐깐이)",
    emoji: '🔥',
    color: '#f97316', // orange
    suggestedAgentRole: 'reviewer',
    prompt: (task) => `As QA/Devil's Advocate (깐깐이), find every technical pitfall, scope risk, timeline issue, and missing requirement in: ${task}. Be extremely critical. Score viability 1-10.`,
  },
};

export const TECH_SPEC_SYNTHESIS_PROMPT = (specs: string) =>
  `Synthesize these 4 specs into one unified development specification. Resolve conflicts. Create a final sprint plan.\n\n${specs}`;

export const MAX_CONCURRENT_TASKS = 3;
export const SERVER_PORT = 3001;
export const WS_PATH = '/ws';
