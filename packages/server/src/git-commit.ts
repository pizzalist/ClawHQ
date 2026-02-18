/**
 * AI Commit — Auto-commit deliverables to a git repository.
 *
 * Writes deliverable content to files and creates a structured commit
 * with agent/task metadata in the commit message.
 */
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Deliverable, DeliverableType } from '@ai-office/shared';
import { getDeliverable, listDeliverablesByTask } from './deliverables.js';
import { stmts } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default output repo path — can be overridden via AI_OFFICE_REPO_PATH env */
const DEFAULT_REPO_PATH = path.join(__dirname, '..', 'output-repo');

function getRepoPath(): string {
  return process.env.AI_OFFICE_REPO_PATH || DEFAULT_REPO_PATH;
}

/** File extension mapping by deliverable type + language */
function getFileExtension(d: Deliverable): string {
  if (d.language) {
    const langMap: Record<string, string> = {
      html: '.html',
      htm: '.html',
      javascript: '.js',
      js: '.js',
      typescript: '.ts',
      ts: '.ts',
      python: '.py',
      css: '.css',
      json: '.json',
      csv: '.csv',
      sql: '.sql',
      shell: '.sh',
      bash: '.sh',
      yaml: '.yaml',
      yml: '.yaml',
      markdown: '.md',
      md: '.md',
      rust: '.rs',
      go: '.go',
      java: '.java',
      cpp: '.cpp',
      c: '.c',
      ruby: '.rb',
      php: '.php',
      swift: '.swift',
      kotlin: '.kt',
    };
    if (langMap[d.language]) return langMap[d.language];
  }
  if (d.format) {
    const fmtMap: Record<string, string> = {
      json: '.json',
      csv: '.csv',
      markdown: '.md',
      xml: '.xml',
    };
    if (fmtMap[d.format]) return fmtMap[d.format];
  }
  const typeMap: Record<DeliverableType, string> = {
    web: '.html',
    report: '.md',
    code: '.txt',
    api: '.json',
    design: '.svg',
    data: '.json',
    document: '.md',
  };
  return typeMap[d.type] || '.txt';
}

/** Sanitize a string for use as filename */
function sanitizeFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'output';
}

/** Initialize git repo if not already initialized */
function ensureRepo(): string {
  const repoPath = getRepoPath();
  mkdirSync(repoPath, { recursive: true });

  if (!existsSync(path.join(repoPath, '.git'))) {
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'AI Office'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'ai-office@localhost'], { cwd: repoPath, stdio: 'pipe' });
    // Initial commit
    writeFileSync(path.join(repoPath, 'README.md'), '# AI Office Output Repository\n\nAuto-committed deliverables from AI Office agents.\n');
    execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init: AI Office output repository'], { cwd: repoPath, stdio: 'pipe' });
  }

  return repoPath;
}

/** Get task info for commit message */
function getTaskInfo(taskId: string): { title: string; assigneeName: string; assigneeRole: string } | null {
  const row = stmts.getTask.get(taskId) as Record<string, unknown> | undefined;
  if (!row) return null;

  let assigneeName = 'unknown';
  let assigneeRole = 'unknown';
  if (row.assignee_id) {
    const agentRow = stmts.getAgent.get(row.assignee_id) as Record<string, unknown> | undefined;
    if (agentRow) {
      assigneeName = agentRow.name as string;
      assigneeRole = agentRow.role as string;
    }
  }

  return {
    title: row.title as string,
    assigneeName,
    assigneeRole,
  };
}

export interface CommitResult {
  ok: boolean;
  commitHash?: string;
  filePaths?: string[];
  message?: string;
  error?: string;
}

/**
 * Commit a single deliverable to the output repo.
 */
export function commitDeliverable(deliverableId: string, customMessage?: string): CommitResult {
  try {
    const d = getDeliverable(deliverableId);
    if (!d) return { ok: false, error: 'Deliverable not found' };

    const repoPath = ensureRepo();
    const taskInfo = getTaskInfo(d.taskId);

    // Determine output directory: task-based folder structure
    const taskDir = taskInfo
      ? sanitizeFilename(taskInfo.title)
      : d.taskId.slice(0, 8);
    const outputDir = path.join(repoPath, taskDir);
    mkdirSync(outputDir, { recursive: true });

    // Write file
    const filename = sanitizeFilename(d.title) + getFileExtension(d);
    const filePath = path.join(outputDir, filename);
    writeFileSync(filePath, d.content, 'utf-8');

    // Build commit message
    const commitMsg = customMessage || buildCommitMessage(d, taskInfo);

    // Stage and commit (use execFileSync to prevent command injection)
    execFileSync('git', ['add', '--', path.relative(repoPath, filePath)], { cwd: repoPath, stdio: 'pipe' });

    // Check if there are changes to commit
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8' }).trim();
    if (!status) {
      return { ok: true, message: 'No changes to commit (file unchanged)', filePaths: [path.relative(repoPath, filePath)] };
    }

    execFileSync('git', ['commit', '-m', commitMsg], { cwd: repoPath, stdio: 'pipe' });

    // Get commit hash
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoPath, encoding: 'utf-8' }).trim();

    return {
      ok: true,
      commitHash: hash,
      filePaths: [path.relative(repoPath, filePath)],
      message: `Committed ${filename} as ${hash}`,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Commit all deliverables for a task in a single commit.
 */
export function commitTaskDeliverables(taskId: string, customMessage?: string): CommitResult {
  try {
    const deliverables = listDeliverablesByTask(taskId);
    if (deliverables.length === 0) return { ok: false, error: 'No deliverables found for task' };

    const repoPath = ensureRepo();
    const taskInfo = getTaskInfo(taskId);

    const taskDir = taskInfo
      ? sanitizeFilename(taskInfo.title)
      : taskId.slice(0, 8);
    const outputDir = path.join(repoPath, taskDir);
    mkdirSync(outputDir, { recursive: true });

    const filePaths: string[] = [];

    // Write all deliverable files
    for (const d of deliverables) {
      const filename = sanitizeFilename(d.title) + getFileExtension(d);
      const filePath = path.join(outputDir, filename);
      writeFileSync(filePath, d.content, 'utf-8');
      filePaths.push(path.relative(repoPath, filePath));
    }

    // Stage all (use execFileSync with -- to prevent flag injection)
    execFileSync('git', ['add', '--', './' + taskDir], { cwd: repoPath, stdio: 'pipe' });

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8' }).trim();
    if (!status) {
      return { ok: true, message: 'No changes to commit (files unchanged)', filePaths };
    }

    // Build commit message
    const commitMsg = customMessage || buildTaskCommitMessage(deliverables, taskInfo);
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: repoPath, stdio: 'pipe' });

    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoPath, encoding: 'utf-8' }).trim();

    return {
      ok: true,
      commitHash: hash,
      filePaths,
      message: `Committed ${deliverables.length} deliverable(s) as ${hash}`,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Get git log for the output repo.
 */
export function getCommitLog(limit = 20): Array<{ hash: string; message: string; date: string; author: string }> {
  try {
    const repoPath = getRepoPath();
    if (!existsSync(path.join(repoPath, '.git'))) return [];

    const log = execFileSync(
      'git', ['log', `--pretty=format:%H|%s|%ai|%an`, '-n', String(limit)],
      { cwd: repoPath, encoding: 'utf-8' }
    ).trim();

    if (!log) return [];

    return log.split('\n').map(line => {
      const [hash, message, date, author] = line.split('|');
      return { hash: hash.slice(0, 7), message, date, author };
    });
  } catch {
    return [];
  }
}

// --- Private helpers ---

function buildCommitMessage(d: Deliverable, taskInfo: ReturnType<typeof getTaskInfo>): string {
  const typeLabel = d.type === 'web' ? 'feat' : d.type === 'code' ? 'feat' : d.type === 'report' ? 'docs' : 'chore';
  const scope = taskInfo?.assigneeRole || 'agent';
  const subject = d.title.length > 50 ? d.title.slice(0, 47) + '...' : d.title;

  let msg = `${typeLabel}(${scope}): ${subject}`;

  if (taskInfo) {
    msg += `\n\nTask: ${taskInfo.title}`;
    msg += `\nAgent: ${taskInfo.assigneeName} (${taskInfo.assigneeRole})`;
  }
  msg += `\nType: ${d.type}`;
  if (d.language) msg += `\nLanguage: ${d.language}`;

  return msg;
}

function buildTaskCommitMessage(deliverables: Deliverable[], taskInfo: ReturnType<typeof getTaskInfo>): string {
  const typeLabel = deliverables.some(d => d.type === 'web' || d.type === 'code') ? 'feat' : 'docs';
  const scope = taskInfo?.assigneeRole || 'agent';
  const subject = taskInfo?.title || `${deliverables.length} deliverable(s)`;
  const truncSubject = subject.length > 50 ? subject.slice(0, 47) + '...' : subject;

  let msg = `${typeLabel}(${scope}): ${truncSubject}`;

  if (taskInfo) {
    msg += `\n\nTask: ${taskInfo.title}`;
    msg += `\nAgent: ${taskInfo.assigneeName} (${taskInfo.assigneeRole})`;
  }
  msg += `\nDeliverables: ${deliverables.map(d => `${d.title} (${d.type})`).join(', ')}`;

  return msg;
}
