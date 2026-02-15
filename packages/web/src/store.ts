import { create } from 'zustand';
import type { Agent, Task, AppEvent, WSMessage, InitialState, Meeting, MeetingCharacter, ChiefChatMessage, TeamPlanSuggestion } from '@ai-office/shared';
import { toast } from './components/Toast';

const API = '';

interface Store {
  agents: Agent[];
  tasks: Task[];
  events: AppEvent[];
  meetings: Meeting[];
  chiefMessages: ChiefChatMessage[];
  chiefSuggestions: TeamPlanSuggestion[];
  chiefMeetingDraft: { title: string; description: string; participantIds: string[]; character: MeetingCharacter } | null;
  connected: boolean;
  initialized: boolean;
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  sidebarOpen: boolean;
  loading: Record<string, boolean>;
  setAgents: (agents: Agent[]) => void;
  setTasks: (tasks: Task[]) => void;
  setMeetings: (meetings: Meeting[]) => void;
  setChiefState: (messages: ChiefChatMessage[], suggestions: TeamPlanSuggestion[], meetingDraft?: { title: string; description: string; participantIds: string[]; character: MeetingCharacter } | null) => void;
  addEvent: (event: AppEvent) => void;
  setConnected: (v: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  setSidebarOpen: (v: boolean) => void;
  init: (state: InitialState) => void;
  // API actions
  createTask: (title: string, description: string, assigneeId?: string | null, expectedDeliverables?: string[]) => Promise<void>;
  chiefChat: (message: string, sessionId?: string) => Promise<void>;
  applyChiefPlan: (suggestions: TeamPlanSuggestion[], sessionId?: string) => Promise<{ meetingDraft: { title: string; description: string; participantIds: string[]; character: MeetingCharacter } | null }>;
  createAgent: (name: string, role: string, model: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  resetAgent: (id: string) => Promise<void>;
  applyPreset: (presetId: string) => Promise<void>;
  createMeeting: (title: string, description: string, participantIds: string[], character?: MeetingCharacter) => Promise<void>;
  decideMeeting: (meetingId: string, winnerId: string, feedback: string) => Promise<void>;
  startTechSpec: (title: string, description: string, assignments: Array<{ role: string; agentId: string }>) => Promise<void>;
  rerunTechSpecRole: (meetingId: string, role: string) => Promise<void>;
  setLoading: (key: string, v: boolean) => void;
}

export const useStore = create<Store>((set, get) => ({
  agents: [],
  tasks: [],
  events: [],
  meetings: [],
  chiefMessages: [],
  chiefSuggestions: [],
  chiefMeetingDraft: null,
  connected: false,
  initialized: false,
  selectedAgentId: null,
  selectedTaskId: null,
  sidebarOpen: true,
  loading: {},
  setAgents: (agents) => set((s) => ({
    agents,
    selectedAgentId: s.selectedAgentId && agents.some((a) => a.id === s.selectedAgentId) ? s.selectedAgentId : s.selectedAgentId,
  })),
  setTasks: (tasks) => set({ tasks }),
  setMeetings: (meetings) => set({ meetings }),
  setChiefState: (chiefMessages, chiefSuggestions, chiefMeetingDraft = null) => set({ chiefMessages, chiefSuggestions, chiefMeetingDraft }),
  addEvent: (event) => set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  setConnected: (connected) => set({ connected }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  setSelectedTask: (selectedTaskId) => set({ selectedTaskId }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  init: (state) => set({ agents: state.agents, tasks: state.tasks, events: state.events, meetings: state.meetings || [], selectedAgentId: null, initialized: true }),
  setLoading: (key, v) => set((s) => ({ loading: { ...s.loading, [key]: v } })),

  createTask: async (title, description, assigneeId, expectedDeliverables) => {
    const { setLoading } = get();
    setLoading('createTask', true);
    try {
      const res = await fetch(`${API}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, assigneeId, expectedDeliverables }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      await fetch(`${API}/api/tasks/process`, { method: 'POST' });
      toast('Task created', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to create task', 'error');
    } finally {
      setLoading('createTask', false);
    }
  },

  chiefChat: async (message, sessionId = 'chief-default') => {
    const { setLoading, setChiefState } = get();
    setLoading('chiefChat', true);
    try {
      const res = await fetch(`${API}/api/chief/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      setChiefState(data.messages || [], data.suggestions || [], null);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '총괄자 대화에 실패했어요', 'error');
    } finally {
      setLoading('chiefChat', false);
    }
  },

  applyChiefPlan: async (suggestions, sessionId = 'chief-default') => {
    const { setLoading, setChiefState } = get();
    setLoading('chiefApply', true);
    try {
      const res = await fetch(`${API}/api/chief/plan/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions, sessionId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      const createdCount = Array.isArray(data.created) ? data.created.length : 0;
      toast(`총괄자 제안 적용 완료: 에이전트 ${createdCount}명 생성`, 'success');
      setChiefState(data.messages || get().chiefMessages, data.suggestions || suggestions, data.meetingDraft || null);
      return { meetingDraft: data.meetingDraft || null };
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '팀 편성 적용에 실패했어요', 'error');
      return { meetingDraft: null };
    } finally {
      setLoading('chiefApply', false);
    }
  },

  createAgent: async (name, role, model) => {
    const { setLoading } = get();
    setLoading('createAgent', true);
    try {
      const res = await fetch(`${API}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, model }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast(`Agent "${name}" added`, 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to add agent', 'error');
    } finally {
      setLoading('createAgent', false);
    }
  },

  deleteAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`delete-${id}`, true);
    try {
      const res = await fetch(`${API}/api/agents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Agent removed', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to remove agent', 'error');
    } finally {
      setLoading(`delete-${id}`, false);
    }
  },

  stopAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`stop-${id}`, true);
    try {
      const res = await fetch(`${API}/api/agents/${id}/stop`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Agent stopped', 'info');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to stop agent', 'error');
    } finally {
      setLoading(`stop-${id}`, false);
    }
  },

  applyPreset: async (presetId) => {
    const { setLoading } = get();
    setLoading('applyPreset', true);
    try {
      await fetch(`${API}/api/presets/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
    } finally {
      setLoading('applyPreset', false);
    }
  },

  createMeeting: async (title, description, participantIds, character = 'planning') => {
    const { setLoading } = get();
    setLoading('createMeeting', true);
    try {
      const res = await fetch(`${API}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, participantIds, character }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Meeting started! PMs are generating proposals...', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to create meeting', 'error');
    } finally {
      setLoading('createMeeting', false);
    }
  },

  decideMeeting: async (meetingId, winnerId, feedback) => {
    const { setLoading } = get();
    setLoading('decideMeeting', true);
    try {
      const res = await fetch(`${API}/api/meetings/${meetingId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, feedback }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Decision recorded!', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to decide', 'error');
    } finally {
      setLoading('decideMeeting', false);
    }
  },

  startTechSpec: async (title, description, assignments) => {
    const { setLoading } = get();
    setLoading('startTechSpec', true);
    try {
      const res = await fetch(`${API}/api/tech-spec/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, assignments }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Tech Spec meeting started! Agents are generating specs...', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to start tech spec', 'error');
    } finally {
      setLoading('startTechSpec', false);
    }
  },

  rerunTechSpecRole: async (meetingId, role) => {
    const { setLoading } = get();
    setLoading('rerunRole', true);
    try {
      const res = await fetch(`${API}/api/tech-spec/${meetingId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast(`Re-running ${role} spec...`, 'info');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to re-run', 'error');
    } finally {
      setLoading('rerunRole', false);
    }
  },

  resetAgent: async (id) => {
    const { setLoading } = get();
    setLoading(`reset-${id}`, true);
    try {
      const res = await fetch(`${API}/api/agents/${id}/reset`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Agent reset', 'info');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to reset agent', 'error');
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
    useStore.getState().setConnected(true);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
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
      case 'meetings_update': {
        const newMeetings = msg.payload as Meeting[];
        const prevMeetings = store.meetings;
        store.setMeetings(newMeetings);
        // Check for newly completed meetings
        for (const m of newMeetings) {
          if (m.status === 'completed' && !m.decision) {
            const prev = prevMeetings.find((pm) => pm.id === m.id);
            if (!prev || prev.status !== 'completed') {
              toast(`Meeting complete! ${m.proposals?.length || 0} proposals ready for your review`, 'info', {
                label: '🗳️ Review',
                onClick: () => { /* handled by UI */ },
              });
            }
          }
        }
        break;
      }
      case 'event': {
        const evt = msg.payload as AppEvent;
        store.addEvent(evt);
        if (evt.type === 'task_completed') {
          const taskId = evt.taskId;
          // Only show toast for root tasks (not chain sub-tasks)
          const task = taskId ? store.tasks.find(t => t.id === taskId) : null;
          const isSubTask = task?.parentTaskId != null;
          if (!isSubTask) {
            toast(evt.message, 'success', taskId ? {
              label: '👁 View Result',
              onClick: () => useStore.getState().setSelectedTask(taskId),
            } : undefined);
          }
        } else if (evt.type === 'task_failed') {
          const taskId = evt.taskId;
          toast(evt.message, 'error', taskId ? {
            label: '👁 View Details',
            onClick: () => useStore.getState().setSelectedTask(taskId),
          } : undefined);
        }
        break;
      }
    }
  };

  ws.onclose = () => {
    useStore.getState().setConnected(false);
    ws = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(connectWS, 3000);
    }
  };

  ws.onerror = () => ws?.close();
}
