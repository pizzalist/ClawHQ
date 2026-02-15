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
  pm: '📋',
  developer: '💻',
  reviewer: '🔍',
  designer: '🎨',
  devops: '🔧',
  qa: '🧪',
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

export const MAX_CONCURRENT_TASKS = 3;
export const SERVER_PORT = 3001;
export const WS_PATH = '/ws';
