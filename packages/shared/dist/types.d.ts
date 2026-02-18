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
    isTest: boolean;
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
    /** Groups parallel tasks that should be consolidated when all complete */
    batchId: string | null;
    isTest: boolean;
    taskType?: TaskType;
    linkedMeetingId?: string | null;
    expectedDeliverables?: DeliverableType[];
    createdAt: string;
    updatedAt: string;
}
export interface ChainStep {
    role: AgentRole;
    label: string;
    reason: string;
    /** If set, prefer this agent. Otherwise auto-assign by role. */
    agentId?: string;
}
export interface ChainPlan {
    id: string;
    taskId: string;
    taskTitle: string;
    steps: ChainStep[];
    /** Currently completed step index (-1 = not started) */
    currentStep: number;
    status: 'proposed' | 'confirmed' | 'running' | 'completed' | 'cancelled';
    autoExecute: boolean;
    createdAt: string;
    /** Last server mutation time. Used to ignore out-of-order WS updates on client. */
    updatedAt: string;
}
export type ChiefActionType = 'create_task' | 'create_agent' | 'start_meeting' | 'assign_task' | 'cancel_task' | 'cancel_all_pending' | 'reset_agent' | 'delete_meeting' | 'delete_all_meetings' | 'cancel_meeting' | 'confirm_meeting' | 'confirm_task' | 'start_review';
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
    /** Session scoping key for isolating concurrent chief chats */
    sessionId?: string;
}
export type ChiefCheckInStage = 'planning' | 'progress' | 'decision' | 'completion';
export interface ChiefCheckInOption {
    id: string;
    label: string;
    description?: string;
}
export interface ChiefCheckIn {
    id: string;
    stage: ChiefCheckInStage;
    message: string;
    options?: ChiefCheckInOption[];
    /** Related entity IDs for context */
    taskId?: string;
    meetingId?: string;
    /** Session scoping key for isolating concurrent chief chats */
    sessionId?: string;
    /** Summary of agent result if applicable */
    resultSummary?: string;
    createdAt: string;
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
export type MeetingCharacter = 'brainstorm' | 'planning' | 'review' | 'retrospective' | 'kickoff' | 'architecture' | 'design' | 'sprint-planning' | 'estimation' | 'demo' | 'postmortem' | 'code-review' | 'daily';
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
export interface MeetingCandidate {
    name: string;
    summary: string;
    score?: number;
    rationale?: string;
}
export interface ReviewerScoreCard {
    reviewerName: string;
    reviewerRole: string;
    scores: Array<{
        candidateName: string;
        score: number;
        weight: number;
        rationale: string;
    }>;
}
export interface DecisionPacket {
    reviewerScoreCards: ReviewerScoreCard[];
    recommendation: MeetingCandidate;
    alternatives: MeetingCandidate[];
    status: 'pending' | 'approved' | 'revision_requested';
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
    /** Lineage: parent meeting that spawned this one */
    parentMeetingId?: string | null;
    /** Source meeting ID whose candidates are being reviewed */
    sourceMeetingId?: string | null;
    /** Structured candidates inherited from source meeting */
    sourceCandidates?: MeetingCandidate[];
    /** Final decision packet (reviewer scoring + recommendation) */
    decisionPacket?: DecisionPacket | null;
    createdAt: string;
    updatedAt: string;
}
export interface ChiefInlineAction {
    id: string;
    label: string;
    action: 'view_result' | 'approve' | 'request_revision' | 'select_proposal' | 'custom';
    params: Record<string, string>;
}
export interface ChiefNotification {
    id: string;
    type: 'task_complete' | 'task_failed' | 'meeting_complete' | 'meeting_review_complete' | 'info';
    title: string;
    summary: string;
    actions: ChiefInlineAction[];
    taskId?: string;
    meetingId?: string;
    /** Session scoping key for isolating concurrent chief chats */
    sessionId?: string;
    createdAt: string;
}
export interface ChiefChatMessage {
    id: string;
    role: 'user' | 'chief';
    content: string;
    notification?: ChiefNotification;
    createdAt: string;
}
export interface TeamPlanSuggestion {
    role: AgentRole;
    count: number;
}
export type WSMessageType = 'agents_update' | 'tasks_update' | 'event' | 'initial_state' | 'meetings_update' | 'chief_response' | 'chief_checkin' | 'chief_notification' | 'chain_plan_update';
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
