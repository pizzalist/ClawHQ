import type { Task, AppEvent } from '@ai-office/shared';
type Listener = (event: AppEvent) => void;
export declare function onTaskEvent(fn: Listener): void;
export declare function listTasks(): Task[];
export declare function createTask(title: string, description: string): Task;
/**
 * Process the task queue: assign pending tasks to idle agents.
 * For real mode, spawns OpenClaw agent sessions.
 * For demo mode, uses simulated timers.
 */
export declare function processQueue(): void;
export declare function listEvents(): AppEvent[];
export {};
