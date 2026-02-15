import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
const OPENCLAW_BIN = 'openclaw';
let demoMode = false;
export async function checkOpenClaw() {
    try {
        await execFileAsync(OPENCLAW_BIN, ['--version'], { timeout: 5000 });
        console.log('[openclaw] CLI available');
        return true;
    }
    catch {
        console.log('[openclaw] CLI not found — demo mode');
        demoMode = true;
        return false;
    }
}
export function isDemoMode() {
    return demoMode;
}
const activeRuns = new Map();
/**
 * Spawn a real OpenClaw agent session for a task.
 * Returns immediately; caller should monitor via getAgentRun / onRunComplete.
 */
export function spawnAgentSession(options) {
    if (demoMode) {
        const run = {
            sessionId: options.sessionId,
            process: null,
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
    const run = {
        sessionId: options.sessionId,
        process: child,
        stdout: '',
        stderr: '',
        done: false,
        exitCode: null,
        startedAt: Date.now(),
    };
    child.stdout?.on('data', (chunk) => {
        run.stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
        run.stderr += chunk.toString();
    });
    const finish = (code) => {
        if (run.done)
            return;
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
export function getAgentRun(sessionId) {
    return activeRuns.get(sessionId);
}
export function killAgentRun(sessionId) {
    const run = activeRuns.get(sessionId);
    if (!run || run.done)
        return false;
    run.process?.kill('SIGTERM');
    return true;
}
export function cleanupRun(sessionId) {
    activeRuns.delete(sessionId);
}
/** Parse the agent JSON output to extract the reply */
export function parseAgentOutput(stdout) {
    // Try JSON parse first
    try {
        const data = JSON.parse(stdout.trim());
        return data.reply || data.content || data.message || data.result || JSON.stringify(data, null, 2);
    }
    catch {
        // Fall back to raw text, trim to reasonable length
        return stdout.trim().slice(0, 4000) || 'No output';
    }
}
/** List active OpenClaw sessions (informational) */
export async function listSessions() {
    if (demoMode)
        return [];
    try {
        const { stdout } = await execFileAsync(OPENCLAW_BIN, ['sessions', '--json', '--active', '60'], { timeout: 10000 });
        return JSON.parse(stdout);
    }
    catch {
        return [];
    }
}
