import type { Agent, AgentRole, AgentModel, AgentState, AppEvent } from '@ai-office/shared';
type Listener = (event: AppEvent) => void;
export declare function onEvent(fn: Listener): void;
export declare function listAgents(): Agent[];
export declare function getAgent(id: string): Agent | null;
export declare function createAgent(name: string, role: AgentRole, model: AgentModel): Agent;
export declare function transitionAgent(id: string, newState: AgentState, taskId?: string | null, sessionId?: string | null): Agent;
export declare function seedDemoAgents(): void;
export {};
