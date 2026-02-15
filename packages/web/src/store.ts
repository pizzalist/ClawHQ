import { create } from 'zustand';
import type { Agent, Task, AppEvent, WSMessage, InitialState } from '@ai-office/shared';

const API = '';

interface Store {
  agents: Agent[];
  tasks: Task[];
  events: AppEvent[];
  connected: boolean;
  selectedAgentId: string | null;
  loading: Record<string, boolean>;
  setAgents: (agents: Agent[]) => void;
  setTasks: (tasks: Task[]) => void;
  addEvent: (event: AppEvent) => void;
  setConnected: (v: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
  init: (state: InitialState) => void;
  // API actions
  createTask: (title: string, description: string, assigneeId?: string | null) => Promise<void>;
  createAgent: (name: string, role: string, model: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  resetAgent: (id: string) => Promise<void>;
  setLoading: (key: string, v: boolean) => void;
}

export const useStore = create<Store>((set, get) => ({
  agents: [],
  tasks: [],
  events: [],
  connected: false,
  selectedAgentId: null,
  loading: {},
  setAgents: (agents) => set((s) => ({
    agents,
    selectedAgentId: s.selectedAgentId && agents.some((a) => a.id === s.selectedAgentId) ? s.selectedAgentId : s.selectedAgentId,
  })),
  setTasks: (tasks) => set({ tasks }),
  addEvent: (event) => set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  setConnected: (connected) => set({ connected }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  init: (state) => set({ agents: state.agents, tasks: state.tasks, events: state.events, selectedAgentId: null }),
  setLoading: (key, v) => set((s) => ({ loading: { ...s.loading, [key]: v } })),

  createTask: async (title, description, assigneeId) => {
    const { setLoading } = get();
    setLoading('createTask', true);
    try {
      await fetch(`${API}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, assigneeId }),
      });
      await fetch(`${API}/api/tasks/process`, { method: 'POST' });
    } finally {
      setLoading('createTask', false);
    }
  },

  createAgent: async (name, role, model) => {
    const { setLoading } = get();
    setLoading('createAgent', true);
    try {
      await fetch(`${API}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, model }),
      });
    } finally {
      setLoading('createAgent', false);
    }
  },

  deleteAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`delete-${id}`, true);
    try {
      await fetch(`${API}/api/agents/${id}`, { method: 'DELETE' });
    } finally {
      setLoading(`delete-${id}`, false);
    }
  },

  stopAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`stop-${id}`, true);
    try {
      await fetch(`${API}/api/agents/${id}/stop`, { method: 'POST' });
    } finally {
      setLoading(`stop-${id}`, false);
    }
  },

  resetAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`reset-${id}`, true);
    try {
      await fetch(`${API}/api/agents/${id}/reset`, { method: 'POST' });
    } finally {
      setLoading(`reset-${id}`, false);
    }
  },
}));

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWS() {
  if (ws && ws.readyState <= 1) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    console.log('[ws] connected');
    useStore.getState().setConnected(true);
  };

  ws.onmessage = (e) => {
    const msg: WSMessage = JSON.parse(e.data);
    const store = useStore.getState();
    switch (msg.type) {
      case 'initial_state':
        store.init(msg.payload as InitialState);
        break;
      case 'agents_update':
        store.setAgents(msg.payload as Agent[]);
        break;
      case 'tasks_update':
        store.setTasks(msg.payload as Task[]);
        break;
      case 'event':
        store.addEvent(msg.payload as AppEvent);
        break;
    }
  };

  ws.onclose = () => {
    console.log('[ws] disconnected');
    useStore.getState().setConnected(false);
    ws = null;
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws?.close();
}
