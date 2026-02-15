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
export type TaskType = 'standard' | 'meeting' | 'review' | 'planning';
export interface Task {
    id: string;
    title: string;
    description: string;
    assigneeId: string | null;
    status: TaskStatus;
    result: string | null;
    parentTaskId: string | null;
    taskType?: TaskType;
    linkedMeetingId?: string | null;
    expectedDeliverables?: DeliverableType[];
    createdAt: string;
    updatedAt: string;
}
export type ChiefActionType = 'create_task' | 'create_agent' | 'start_meeting' | 'assign_task';
export interface ChiefAction {
    type: ChiefActionType;
    params: Record<string, string>;
    result?: {
        ok: boolean;
        message: string;
        id?: string;
    };
}
export interface ChiefResponse {
    messageId: string;
    reply: string;
    actions: ChiefAction[];
    state: {
        agents: Agent[];
        tasks: Task[];
        meetings: Meeting[];
    };
}
export interface TeamPreset {
    id: string;
    name: string;
    description: string;
    agents: Array<{
        name: string;
        role: AgentRole;
        model: AgentModel;
    }>;
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
export declare const DELIVERABLE_LABELS: Record<DeliverableType, {
    icon: string;
    label: string;
}>;
export type DecisionStatus = 'pending' | 'approved' | 'revised' | 'rejected';
export interface Proposal {
    id: string;
    decisionItemId: string;
    agentId: string;
    agentName: string;
    agentRole: AgentRole;
    agentModel: AgentModel;
    content: string;
    pros: string[];
    cons: string[];
    createdAt: string;
}
export interface ReviewScore {
    id: string;
    proposalId: string;
    reviewerName: string;
    reviewerRole: string;
    score: number;
    keyPoints: string[];
    isDevilsAdvocate: boolean;
    sentiment: 'positive' | 'caution' | 'critical';
    createdAt: string;
}
export interface DecisionItem {
    id: string;
    taskId: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: DecisionStatus;
    proposals: Proposal[];
    reviews: ReviewScore[];
    chosenProposalId: string | null;
    decidedAt: string | null;
    createdAt: string;
}
export interface DecisionHistoryEntry {
    id: string;
    decisionItemId: string;
    title: string;
    action: DecisionStatus;
    chosenProposalAgentName: string | null;
    avgScore: number;
    decidedAt: string;
}
export type MeetingType = 'planning' | 'review' | 'debate' | 'tech-spec';
export type MeetingCharacter = 'brainstorm' | 'planning' | 'review' | 'retrospective';
export type TechSpecRole = 'cto' | 'frontend-lead' | 'backend-lead' | 'qa-devils-advocate';
export interface TechSpecParticipant {
    agentId: string;
    agentName: string;
    role: TechSpecRole;
    spec: string | null;
    status: 'pending' | 'working' | 'done' | 'error';
}
export interface TechSpecConflict {
    topic: string;
    positions: Array<{
        role: TechSpecRole;
        stance: string;
    }>;
}
export interface TechSpecMeetingData {
    participants: TechSpecParticipant[];
    conflicts: TechSpecConflict[];
    synthesis: string | null;
    synthesisStatus: 'pending' | 'working' | 'done';
}
export type MeetingStatus = 'active' | 'reviewing' | 'completed';
export interface MeetingProposal {
    agentId: string;
    agentName: string;
    content: string;
    taskId: string;
    reviews?: MeetingReview[];
}
export interface MeetingReview {
    reviewerAgentId: string;
    reviewerName: string;
    score: number;
    pros: string[];
    cons: string[];
    risks: string[];
    summary: string;
    isDevilsAdvocate?: boolean;
}
export interface Meeting {
    id: string;
    title: string;
    description: string;
    type: MeetingType;
    status: MeetingStatus;
    participants: string[];
    proposals: MeetingProposal[];
    decision: {
        winnerId: string;
        feedback: string;
    } | null;
    techSpec?: TechSpecMeetingData;
    character?: MeetingCharacter;
    report?: string;
    createdAt: string;
    updatedAt: string;
}
export interface ChiefChatMessage {
    id: string;
    role: 'user' | 'chief';
    content: string;
    createdAt: string;
}
export interface TeamPlanSuggestion {
    role: AgentRole;
    count: number;
}
export type WSMessageType = 'agents_update' | 'tasks_update' | 'event' | 'initial_state' | 'meetings_update' | 'chief_response';
export interface WSMessage {
    type: WSMessageType;
    payload: unknown;
}
export interface InitialState {
    agents: Agent[];
    tasks: Task[];
    events: AppEvent[];
    meetings: Meeting[];
}
