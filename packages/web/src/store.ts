import { create } from 'zustand';
import type { Agent, Task, AppEvent, WSMessage, InitialState, Meeting, MeetingCharacter, ChiefChatMessage, ChiefAction, ChiefResponse, ChiefCheckIn, ChiefNotification, TeamPlanSuggestion, ChainPlan, ChainStep } from '@ai-office/shared';
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
  chiefSessionId: string;
  chiefThinking: boolean;
  chiefProposedActions: ChiefAction[];   // proposed, awaiting approval
  chiefExecutedActions: ChiefAction[];   // approved & executed results
  chiefPendingMessageId: string | null;  // messageId of proposal awaiting approval
  chiefCheckIns: ChiefCheckIn[];         // proactive check-ins from Chief
  chiefNotifications: ChiefNotification[]; // notifications with inline actions
  chiefPendingDecisions: number;         // count of pending decisions for badge
  chainPlans: ChainPlan[];               // active chain plans
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
  setChiefThinking: (v: boolean) => void;
  handleChiefResponse: (response: ChiefResponse) => void;
  handleChiefCheckIn: (checkIn: ChiefCheckIn) => void;
  handleChiefNotification: (notification: ChiefNotification) => void;
  handleChiefInlineAction: (notificationId: string, actionId: string, params?: Record<string, string>) => Promise<void>;
  respondToCheckIn: (checkInId: string, optionId: string, comment?: string) => Promise<void>;
  dismissCheckIn: (checkInId: string) => void;
  approveProposal: (messageId: string, selectedIndices?: number[], overrideActions?: ChiefAction[]) => Promise<void>;
  rejectProposal: (messageId: string) => Promise<void>;
  // Chain plan actions
  updateChainPlan: (plan: ChainPlan) => void;
  editChainSteps: (planId: string, steps: ChainStep[]) => Promise<void>;
  setChainAutoExecute: (planId: string, autoExecute: boolean) => Promise<void>;
  confirmChainPlan: (planId: string) => Promise<void>;
  advanceChainPlan: (planId: string) => Promise<void>;
  cancelChainPlan: (planId: string) => Promise<void>;
  refreshActiveChainPlans: () => Promise<void>;
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
  chiefSessionId: `chief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  chiefThinking: false,
  chiefProposedActions: [],
  chiefExecutedActions: [],
  chiefPendingMessageId: null,
  chiefCheckIns: [],
  chiefNotifications: [],
  chiefPendingDecisions: 0,
  chainPlans: [],
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
  setChiefThinking: (chiefThinking) => set({ chiefThinking }),
  handleChiefResponse: (response) => {
    const currentSession = get().chiefSessionId;
    if (response.sessionId && response.sessionId !== currentSession) return;

    const chiefMsg: ChiefChatMessage = {
      id: response.messageId,
      role: 'chief',
      content: response.reply,
      createdAt: new Date().toISOString(),
    };
    set((s) => {
      // Deduplicate: skip if message with same id already exists
      const exists = s.chiefMessages.some(m => m.id === response.messageId);
      return {
        chiefMessages: exists ? s.chiefMessages : [...s.chiefMessages, chiefMsg],
        chiefProposedActions: response.actions,
        chiefExecutedActions: [],
        chiefPendingMessageId: response.actions.length > 0 ? response.messageId : null,
        chiefThinking: false,
      };
    });
  },
  handleChiefCheckIn: (checkIn) => {
    const currentSession = get().chiefSessionId;
    if (checkIn.sessionId && checkIn.sessionId !== currentSession) return;
    set((s) => {
      // Deduplicate
      if (s.chiefMessages.some(m => m.id === checkIn.id)) return s;
      const chiefMsg: ChiefChatMessage = {
        id: checkIn.id,
        role: 'chief',
        content: checkIn.message,
        createdAt: checkIn.createdAt,
      };
      return {
        chiefMessages: [...s.chiefMessages, chiefMsg],
        chiefCheckIns: [...s.chiefCheckIns, checkIn],
      };
    });
  },
  handleChiefNotification: (notification) => {
    const currentSession = get().chiefSessionId;
    if (notification.sessionId && notification.sessionId !== currentSession) return;
    set((s) => {
      // Deduplicate
      if (s.chiefMessages.some(m => m.id === notification.id)) return s;
      const chiefMsg: ChiefChatMessage = {
        id: notification.id,
        role: 'chief',
        content: notification.summary,
        notification,
        createdAt: notification.createdAt,
      };
      return {
        chiefMessages: [...s.chiefMessages, chiefMsg],
        chiefNotifications: [...s.chiefNotifications, notification],
        chiefPendingDecisions: s.chiefPendingDecisions + 1,
      };
    });
  },
  handleChiefInlineAction: async (notificationId, actionId, params) => {
    try {
      const currentSession = get().chiefSessionId;
      const res = await fetch(`${API}/api/chief/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId, actionId, params, sessionId: currentSession }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      if (data.reply) {
        const replyMsg: ChiefChatMessage = {
          id: `action-reply-${Date.now()}`,
          role: 'chief',
          content: data.reply,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          chiefMessages: [...s.chiefMessages, replyMsg],
          chiefNotifications: s.chiefNotifications.filter(n => n.id !== notificationId),
          chiefPendingDecisions: Math.max(0, s.chiefPendingDecisions - 1),
        }));
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to handle action', 'error');
    }
  },
  respondToCheckIn: async (checkInId, optionId, comment) => {
    try {
      const res = await fetch(`${API}/api/chief/checkin/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkInId, optionId, comment }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      // Add chief's follow-up reply
      if (data.reply) {
        const replyMsg: ChiefChatMessage = {
          id: `checkin-reply-${Date.now()}`,
          role: 'chief',
          content: data.reply,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          chiefMessages: [...s.chiefMessages, replyMsg],
          chiefCheckIns: s.chiefCheckIns.filter(c => c.id !== checkInId),
        }));
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to respond', 'error');
    }
  },
  dismissCheckIn: (checkInId) => {
    set((s) => ({ chiefCheckIns: s.chiefCheckIns.filter(c => c.id !== checkInId) }));
  },
  approveProposal: async (messageId, selectedIndices, overrideActions) => {
    const { setLoading } = get();
    setLoading('chiefApprove', true);
    try {
      const res = await fetch(`${API}/api/chief/proposal/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, selectedIndices, overrideActions }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      const executedCount = data.executedActions?.filter((a: ChiefAction) => a.result?.ok).length ?? 0;
      toast(`총괄자 제안 승인: ${executedCount}건 실행 완료`, 'success');

      set((s) => ({
        chiefExecutedActions: data.executedActions || [],
        chiefProposedActions: [],
        chiefPendingMessageId: null,
        agents: data.state?.agents || get().agents,
        tasks: data.state?.tasks || get().tasks,
        meetings: data.state?.meetings || get().meetings,
      }));
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '제안 승인에 실패했어요', 'error');
    } finally {
      setLoading('chiefApprove', false);
    }
  },
  rejectProposal: async (messageId) => {
    try {
      await fetch(`${API}/api/chief/proposal/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      set({ chiefProposedActions: [], chiefPendingMessageId: null });
      toast('제안을 거절했습니다', 'info');
    } catch {
      // silent
    }
  },
  // Chain plan actions
  updateChainPlan: (plan) => {
    set((s) => {
      const existing = s.chainPlans.find((p) => p.id === plan.id);
      // WS 누락/역전 방지: 더 오래된 이벤트는 무시
      if (existing && existing.updatedAt && plan.updatedAt && existing.updatedAt > plan.updatedAt) {
        return s;
      }

      if (plan.status === 'completed' || plan.status === 'cancelled') {
        return { chainPlans: s.chainPlans.filter(p => p.id !== plan.id) };
      }
      const existingIndex = s.chainPlans.findIndex(p => p.id === plan.id);
      const plans = [...s.chainPlans];
      if (existingIndex >= 0) plans[existingIndex] = plan;
      else plans.unshift(plan);
      return { chainPlans: plans };
    });
  },
  editChainSteps: async (planId, steps) => {
    try {
      const res = await fetch(`${API}/api/chain-plans/${planId}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const plan = await res.json();
      get().updateChainPlan(plan);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '체인 수정 실패', 'error');
    }
  },
  setChainAutoExecute: async (planId, autoExecute) => {
    try {
      const res = await fetch(`${API}/api/chain-plans/${planId}/auto-execute`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoExecute }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const plan = await res.json();
      get().updateChainPlan(plan);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '설정 실패', 'error');
    }
  },
  confirmChainPlan: async (planId) => {
    try {
      const res = await fetch(`${API}/api/chain-plans/${planId}/confirm`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const plan = await res.json();
      get().updateChainPlan(plan);
      toast('체인 확정 — 실행을 시작합니다', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '체인 확정 실패', 'error');
    }
  },
  advanceChainPlan: async (planId) => {
    try {
      const res = await fetch(`${API}/api/chain-plans/${planId}/advance`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const { plan } = await res.json();
      get().updateChainPlan(plan);
      toast('다음 단계로 진행합니다', 'success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '진행 실패', 'error');
    }
  },
  cancelChainPlan: async (planId) => {
    try {
      const res = await fetch(`${API}/api/chain-plans/${planId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
      const plan = await res.json();
      get().updateChainPlan(plan);
      toast('체인 취소됨', 'info');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '취소 실패', 'error');
    }
  },
  refreshActiveChainPlans: async () => {
    try {
      const res = await fetch(`${API}/api/chain-plans/active`);
      if (!res.ok) return;
      const plans = await res.json();
      set({ chainPlans: Array.isArray(plans) ? plans : [] });
    } catch {
      // silent, best effort sync
    }
  },
  addEvent: (event) => set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  setConnected: (connected) => set({ connected }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  setSelectedTask: (selectedTaskId) => set({ selectedTaskId }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  init: (state) => {
    set({ agents: state.agents, tasks: state.tasks, events: state.events, meetings: state.meetings || [], selectedAgentId: null, initialized: true });
    setTimeout(() => { get().refreshActiveChainPlans(); }, 0);
  },
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

  chiefChat: async (message, sessionId) => {
    const { setLoading, setChiefState, setChiefThinking, chiefSessionId } = get();
    const resolvedSessionId = sessionId || chiefSessionId;
    setLoading('chiefChat', true);
    // Add user message optimistically
    const userMsg: ChiefChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ chiefMessages: [...s.chiefMessages, userMsg], chiefProposedActions: [], chiefExecutedActions: [], chiefPendingMessageId: null }));
    try {
      const res = await fetch(`${API}/api/chief/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId: resolvedSessionId }),
      });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = 'Failed';
        try { errMsg = JSON.parse(text).error || errMsg; } catch { errMsg = `Server error (${res.status})`; }
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.status === 'processing') {
        // Async LLM mode — response will come via WebSocket
        setChiefThinking(true);
      } else {
        // Sync keyword mode
        setChiefState(data.messages || [], data.suggestions || [], null);
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '총괄자 대화에 실패했어요', 'error');
      setChiefThinking(false);
    } finally {
      setLoading('chiefChat', false);
    }
  },

  applyChiefPlan: async (suggestions, sessionId) => {
    const { setLoading, setChiefState, chiefSessionId } = get();
    const resolvedSessionId = sessionId || chiefSessionId;
    setLoading('chiefApply', true);
    try {
      const res = await fetch(`${API}/api/chief/plan/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions, sessionId: resolvedSessionId }),
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
        // 강제 재동기화: 완료/취소 체인 잔상 제거
        store.refreshActiveChainPlans();
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
      case 'chief_response': {
        store.handleChiefResponse(msg.payload as ChiefResponse);
        break;
      }
      case 'chief_checkin': {
        store.handleChiefCheckIn(msg.payload as ChiefCheckIn);
        break;
      }
      case 'chief_notification': {
        store.handleChiefNotification(msg.payload as ChiefNotification);
        break;
      }
      case 'chain_plan_update': {
        store.updateChainPlan(msg.payload as ChainPlan);
        // 서버 상태 기준으로 즉시 정리
        store.refreshActiveChainPlans();
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
