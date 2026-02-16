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
/** Unescape JSON-encoded string literals (\\n → newline, \\t → tab, \\" → quote) */
function unescapeJsonString(s) {
    return s
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}
function sanitizeAgentRawText(input) {
    let text = input
        .replace(/\u001b\[[0-9;]*m/g, '') // ANSI colors
        .replace(/\r\n/g, '\n');
    // Remove fenced json blocks that are clearly tool logs/wrappers.
    text = text.replace(/```json\s*[\s\S]*?```/gi, (block) => {
        if (/(assistant\s+to=functions\.|tool[_\s]?(call|result)|"recipient_name"\s*:\s*"functions\.|"name"\s*:\s*"functions\.)/i.test(block)) {
            return '';
        }
        return block;
    });
    const filteredLines = [];
    let skippingTraceback = false;
    for (const originalLine of text.split('\n')) {
        const line = originalLine.trim();
        if (/^Traceback \(most recent call last\):/i.test(line)) {
            skippingTraceback = true;
            continue;
        }
        if (skippingTraceback) {
            if (line === '' ||
                /^\s*(?:\d+\.|[-*#>])\s+/.test(originalLine) ||
                /^[A-Z][^:]{0,80}:\s*$/.test(line)) {
                skippingTraceback = false;
            }
            else {
                continue;
            }
        }
        if (/^assistant\s+to=functions\./i.test(line) ||
            /^tool\s*(call|result)\b/i.test(line) ||
            /^\s*(\+|\$)\s*(openclaw|npm|node|python|bash|sh)\b/i.test(line)) {
            continue;
        }
        // One-line JSON wrappers around function tool calls/results.
        if (/^\{.*\}$/.test(line)) {
            try {
                const parsed = JSON.parse(line);
                const blob = JSON.stringify(parsed);
                if (/(tool[_\s]?(call|result)|recipient_name"\s*:\s*"functions\.|"name"\s*:\s*"functions\.|"call_id")/i.test(blob)) {
                    continue;
                }
            }
            catch {
                // non-JSON line, keep as-is
            }
        }
        filteredLines.push(originalLine);
    }
    return filteredLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Parse the agent JSON output to extract the reply */
export function parseAgentOutput(stdout) {
    // Try JSON parse first
    try {
        const data = JSON.parse(stdout.trim());
        // Handle OpenClaw payloads format: {"payloads":[{"text":"..."}]}
        if (data.payloads && Array.isArray(data.payloads)) {
            const texts = data.payloads
                .filter((p) => typeof p.text === 'string')
                .map((p) => p.text);
            if (texts.length > 0) {
                return texts.join('\n');
            }
        }
        const raw = data.reply || data.content || data.message || data.result;
        if (typeof raw === 'string')
            return raw;
        return JSON.stringify(data, null, 2);
    }
    catch {
        // stdout might contain multiple JSON lines; try to find a payloads line
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.payloads && Array.isArray(data.payloads)) {
                    const texts = data.payloads
                        .filter((p) => typeof p.text === 'string')
                        .map((p) => p.text);
                    if (texts.length > 0)
                        return texts.join('\n');
                }
            }
            catch { /* skip non-JSON lines */ }
        }
        // Fall back to sanitized raw text, trim to reasonable length
        const sanitized = sanitizeAgentRawText(stdout);
        return sanitized.slice(0, 4000) || 'No output';
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
