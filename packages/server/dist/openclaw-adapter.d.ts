import { ChildProcess } from 'child_process';
export declare function checkOpenClaw(): Promise<boolean>;
export declare function isDemoMode(): boolean;
export interface AgentRun {
    sessionId: string;
    process: ChildProcess;
    stdout: string;
    stderr: string;
    done: boolean;
    exitCode: number | null;
    startedAt: number;
}
/**
 * Spawn a real OpenClaw agent session for a task.
 * Returns immediately; caller should monitor via getAgentRun / onRunComplete.
 */
export declare function spawnAgentSession(options: {
    sessionId: string;
    agentName: string;
    role: string;
    model?: string;
    prompt: string;
    onComplete: (run: AgentRun) => void;
}): AgentRun;
export declare function getAgentRun(sessionId: string): AgentRun | undefined;
export declare function killAgentRun(sessionId: string): boolean;
export declare function cleanupRun(sessionId: string): void;
/** Parse the agent JSON output to extract the reply */
export declare function parseAgentOutput(stdout: string): string;
/** List active OpenClaw sessions (informational) */
export declare function listSessions(): Promise<unknown[]>;
