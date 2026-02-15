export type AgentState = 'idle' | 'working' | 'reviewing' | 'error' | 'done' | 'waiting';
export type AgentRole = 'pm' | 'developer' | 'reviewer' | 'designer' | 'devops' | 'qa';
export type AgentModel = 'claude-opus-4-6' | 'claude-sonnet-4' | 'openai-codex/o3' | 'openai-codex/gpt-5.3-codex';
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
export type EventType = 'agent_created' | 'agent_state_changed' | 'task_created' | 'task_assigned' | 'task_completed' | 'task_failed' | 'message' | 'chain_spawned';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  model: AgentModel;
  state: AgentState;
  currentTaskId: string | null;
  sessionId: string | null;
  deskIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  result: string | null;
  parentTaskId: string | null;
  expectedDeliverables?: DeliverableType[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  agents: Array<{ name: string; role: AgentRole; model: AgentModel }>;
}

export interface AppEvent {
  id: string;
  type: EventType;
  agentId: string | null;
  taskId: string | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Deliverable types
export type DeliverableType = 'web' | 'report' | 'code' | 'api' | 'design' | 'data' | 'document';

export interface Deliverable {
  id: string;
  taskId: string;
  type: DeliverableType;
  title: string;
  content: string;
  language?: string;
  format?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export const DELIVERABLE_LABELS: Record<DeliverableType, { icon: string; label: string }> = {
  web: { icon: '🌐', label: 'Web App' },
  report: { icon: '📊', label: 'Report' },
  code: { icon: '💻', label: 'Code' },
  api: { icon: '🔌', label: 'API' },
  design: { icon: '🎨', label: 'Design' },
  data: { icon: '📈', label: 'Data' },
  document: { icon: '📄', label: 'Document' },
};

// WebSocket message types
export type WSMessageType = 'agents_update' | 'tasks_update' | 'event' | 'initial_state';

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
}

export interface InitialState {
  agents: Agent[];
  tasks: Task[];
  events: AppEvent[];
}
