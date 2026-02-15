export const AGENT_STATES = ['idle', 'working', 'reviewing', 'error', 'done', 'waiting'];
export const AGENT_ROLES = ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'];
export const AGENT_MODELS = [
    'claude-opus-4-6',
    'claude-sonnet-4',
    'openai-codex/o3',
    'openai-codex/gpt-5.3-codex',
];
export const ROLE_LABELS = {
    pm: 'Project Manager',
    developer: 'Developer',
    reviewer: 'Code Reviewer',
    designer: 'Designer',
    devops: 'DevOps',
    qa: 'QA Engineer',
};
export const ROLE_EMOJI = {
    pm: '📋',
    developer: '💻',
    reviewer: '🔍',
    designer: '🎨',
    devops: '🔧',
    qa: '🧪',
};
export const STATE_COLORS = {
    idle: '#6b7280',
    working: '#3b82f6',
    reviewing: '#f59e0b',
    error: '#ef4444',
    done: '#10b981',
    waiting: '#8b5cf6',
};
// Valid FSM transitions
export const STATE_TRANSITIONS = {
    idle: ['working', 'waiting'],
    working: ['reviewing', 'done', 'error', 'idle'],
    reviewing: ['done', 'error', 'working'],
    error: ['idle', 'working'],
    done: ['idle'],
    waiting: ['working', 'idle'],
};
export const TEAM_PRESETS = [
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
export const CHAIN_NEXT_ROLE = {
    pm: 'developer',
    developer: 'reviewer',
};
export const CHAIN_STEP_LABELS = {
    pm: 'Plan',
    developer: 'Implement',
    reviewer: 'Review',
};
export const MAX_CONCURRENT_TASKS = 3;
export const SERVER_PORT = 3001;
export const WS_PATH = '/ws';
