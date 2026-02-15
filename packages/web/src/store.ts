import { create } from 'zustand';
import type { Agent, Task, AppEvent, WSMessage, InitialState } from '@ai-office/shared';

interface Store {
  agents: Agent[];
  tasks: Task[];
  events: AppEvent[];
  connected: boolean;
  selectedAgentId: string | null;
  setAgents: (agents: Agent[]) => void;
  setTasks: (tasks: Task[]) => void;
  addEvent: (event: AppEvent) => void;
  setConnected: (v: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
  init: (state: InitialState) => void;
}

export const useStore = create<Store>((set) => ({
  agents: [],
  tasks: [],
  events: [],
  connected: false,
  selectedAgentId: null,
  setAgents: (agents) => set((s) => ({
    agents,
    selectedAgentId: s.selectedAgentId && agents.some((a) => a.id === s.selectedAgentId) ? s.selectedAgentId : null,
  })),
  setTasks: (tasks) => set({ tasks }),
  addEvent: (event) => set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  setConnected: (connected) => set({ connected }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  init: (state) => set({ agents: state.agents, tasks: state.tasks, events: state.events, selectedAgentId: null }),
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
