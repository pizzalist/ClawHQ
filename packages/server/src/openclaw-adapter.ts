import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const OPENCLAW_BIN = 'openclaw';

let demoMode = false;

export async function checkOpenClaw(): Promise<boolean> {
  try {
    await execFileAsync(OPENCLAW_BIN, ['--version'], { timeout: 5000 });
    console.log('[openclaw] CLI available');
    return true;
  } catch {
    console.log('[openclaw] CLI not found — demo mode');
    demoMode = true;
    return false;
  }
}

export function isDemoMode(): boolean {
  return demoMode;
}

export interface AgentRun {
  sessionId: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  done: boolean;
  exitCode: number | null;
  startedAt: number;
}

const activeRuns = new Map<string, AgentRun>();

/**
 * Spawn a real OpenClaw agent session for a task.
 * Returns immediately; caller should monitor via getAgentRun / onRunComplete.
 */
export function spawnAgentSession(options: {
  sessionId: string;
  agentName: string;
  role: string;
  model?: string;
  prompt: string;
  onComplete: (run: AgentRun) => void;
}): AgentRun {
  if (demoMode) {
    const run: AgentRun = {
      sessionId: options.sessionId,
      process: null as unknown as ChildProcess,
      stdout: 'Demo mode: task completed successfully.',
      stderr: '',
      done: true,
      exitCode: 0,
      startedAt: Date.now(),
    };
    activeRuns.set(options.sessionId, run);
    // Simulate async completion
    setTimeout(() => options.onComplete(run), 5000 + Math.random() * 10000);
    return run;
  }

  const args = [
    'agent',
    '--session-id', options.sessionId,
    '--message', options.prompt,
    '--json',
    '--local',
  ];

  const child = spawn(OPENCLAW_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000, // 10 min max
    env: { ...process.env },
  });

  const run: AgentRun = {
    sessionId: options.sessionId,
    process: child,
    stdout: '',
    stderr: '',
    done: false,
    exitCode: null,
    startedAt: Date.now(),
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    run.stdout += chunk.toString();
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    run.stderr += chunk.toString();
  });

  const finish = (code: number | null) => {
    if (run.done) return;
    run.done = true;
    run.exitCode = code;
    console.log(`[openclaw] Session ${options.sessionId} finished (exit=${code})`);
    options.onComplete(run);
  };

  child.on('close', finish);
  child.on('error', (err) => {
    run.stderr += `\nProcess error: ${err.message}`;
    finish(1);
  });

  activeRuns.set(options.sessionId, run);
  console.log(`[openclaw] Spawned session ${options.sessionId} for ${options.agentName} (pid=${child.pid})`);
  return run;
}

export function getAgentRun(sessionId: string): AgentRun | undefined {
  return activeRuns.get(sessionId);
}

export function killAgentRun(sessionId: string): boolean {
  const run = activeRuns.get(sessionId);
  if (!run || run.done) return false;
  run.process?.kill('SIGTERM');
  return true;
}

export function cleanupRun(sessionId: string) {
  activeRuns.delete(sessionId);
}

/** Parse the agent JSON output to extract the reply */
export function parseAgentOutput(stdout: string): string {
  // Try JSON parse first
  try {
    const data = JSON.parse(stdout.trim());
    return data.reply || data.content || data.message || data.result || JSON.stringify(data, null, 2);
  } catch {
    // Fall back to raw text, trim to reasonable length
    return stdout.trim().slice(0, 4000) || 'No output';
  }
}

/** List active OpenClaw sessions (informational) */
export async function listSessions(): Promise<unknown[]> {
  if (demoMode) return [];
  try {
    const { stdout } = await execFileAsync(OPENCLAW_BIN, ['sessions', '--json', '--active', '60'], { timeout: 10000 });
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}
