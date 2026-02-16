import { v4 as uuid } from 'uuid';
import type { Deliverable, DeliverableType } from '@ai-office/shared';
import { stmts } from './db.js';

interface ParsedArtifact {
  type: DeliverableType;
  title: string;
  content: string;
  language?: string;
  format?: string;
}

/**
 * Parse a task result into deliverable artifacts.
 * A single result can produce multiple deliverables.
 */
export function parseResultToArtifacts(result: string): ParsedArtifact[] {
  const artifacts: ParsedArtifact[] = [];

  // Extract code blocks with language tags
  const codeBlockRegex = /```(\w+)\s*\n([\s\S]*?)```/g;
  let match;
  const codeBlocks: { lang: string; code: string; index: number }[] = [];

  while ((match = codeBlockRegex.exec(result)) !== null) {
    codeBlocks.push({ lang: match[1].toLowerCase(), code: match[2].trim(), index: match.index });
  }

  // Check for web deliverables (HTML/CSS/JS)
  const webLangs = ['html', 'htm'];
  const webBlocks = codeBlocks.filter(b => webLangs.includes(b.lang));
  for (const block of webBlocks) {
    artifacts.push({
      type: 'web',
      title: 'Web Output',
      content: block.code,
      language: 'html',
    });
  }

  // Check for standalone JS that looks like a web app (canvas, DOM manipulation)
  const jsBlocks = codeBlocks.filter(b => ['javascript', 'js'].includes(b.lang));
  for (const block of jsBlocks) {
    if (/document\.|canvas|getElementById|querySelector|DOM/i.test(block.code)) {
      artifacts.push({
        type: 'web',
        title: 'JavaScript App',
        content: wrapJS(block.code),
        language: 'javascript',
      });
    } else {
      artifacts.push({
        type: 'code',
        title: `JavaScript Code`,
        content: block.code,
        language: 'javascript',
      });
    }
  }

  // Other code blocks
  const handledLangs = new Set([...webLangs, 'javascript', 'js']);
  const otherCode = codeBlocks.filter(b => !handledLangs.has(b.lang));
  for (const block of otherCode) {
    // JSON/CSV → data type
    if (['json', 'csv'].includes(block.lang)) {
      artifacts.push({
        type: 'data',
        title: `${block.lang.toUpperCase()} Data`,
        content: block.code,
        format: block.lang,
      });
    } else {
      artifacts.push({
        type: 'code',
        title: `${block.lang.charAt(0).toUpperCase() + block.lang.slice(1)} Code`,
        content: block.code,
        language: block.lang,
      });
    }
  }

  // If no code blocks found, analyze raw text
  if (artifacts.length === 0) {
    // Raw HTML detection
    if (/<html[\s>]/i.test(result) || /<!DOCTYPE\s+html/i.test(result)) {
      const start = result.indexOf('<');
      const end = result.lastIndexOf('>');
      if (start !== -1 && end > start) {
        artifacts.push({
          type: 'web',
          title: 'Web Output',
          content: result.slice(start, end + 1),
          language: 'html',
        });
      }
    }
    // JSON data
    else if (/^\s*[\[{]/.test(result) && /[\]}]\s*$/.test(result)) {
      try {
        JSON.parse(result.trim());
        artifacts.push({
          type: 'data',
          title: 'JSON Data',
          content: result.trim(),
          format: 'json',
        });
      } catch { /* not valid JSON */ }
    }
  }

  // Check remaining text (outside code blocks) for report-style content
  let textOutsideBlocks = result;
  // Remove code blocks from text
  for (const block of codeBlocks) {
    textOutsideBlocks = textOutsideBlocks.replace(`\`\`\`${block.lang}\n${block.code}\n\`\`\``, '');
  }
  textOutsideBlocks = textOutsideBlocks.trim();

  if (textOutsideBlocks.length > 30) {
    // Markdown with headers → report
    const hasHeaders = /^#{1,3}\s+/m.test(textOutsideBlocks);
    const hasSections = (textOutsideBlocks.match(/^#{1,3}\s+/gm) || []).length >= 2;

    if (hasHeaders && hasSections) {
      artifacts.push({
        type: 'report',
        title: 'Report',
        content: textOutsideBlocks,
        format: 'markdown',
      });
    } else if (artifacts.length === 0) {
      // Default: document
      artifacts.push({
        type: 'document',
        title: 'Document',
        content: result,
      });
    }
  }

  // If still nothing, create a document deliverable
  if (artifacts.length === 0) {
    artifacts.push({
      type: 'document',
      title: 'Output',
      content: result,
    });
  }

  return artifacts;
}

function wrapJS(js: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}canvas{display:block;max-width:100%}</style></head>
<body><canvas id="canvas" width="800" height="600"></canvas>
<script>${js}</script></body></html>`;
}

/**
 * Create deliverables from a completed task result.
 * @param agentRole - optional role to enforce type constraints (e.g. PM always gets 'report')
 */
export function createDeliverablesFromResult(taskId: string, result: string, agentRole?: string): Deliverable[] {
  // Delete existing deliverables for this task (in case of re-run)
  stmts.deleteDeliverablesByTask.run(taskId);

  // Unescape literal \n sequences that LLM output sometimes contains
  if (result.includes('\\n')) {
    result = result
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"');
  }

  let artifacts = parseResultToArtifacts(result);

  // PM role enforcement: force all artifacts to report/document type
  if (agentRole === 'pm') {
    artifacts = artifacts.map(a => ({
      ...a,
      type: a.type === 'document' ? 'document' : 'report',
      language: undefined,
    }));
  }

  const deliverables: Deliverable[] = [];

  for (const artifact of artifacts) {
    const id = uuid();
    // Validate web deliverables for blank-screen issues
    let metadata: Record<string, any> = {};
    if (artifact.type === 'web') {
      const validation = validateWebDeliverable(artifact.content);
      metadata = { validation };
      if (!validation.valid) {
        console.warn(`[deliverables] Web deliverable has issues: ${validation.issues.join('; ')}`);
      }
    }

    stmts.insertDeliverable.run(
      id,
      taskId,
      artifact.type,
      artifact.title,
      artifact.content,
      artifact.language || null,
      artifact.format || null,
      JSON.stringify(metadata),
    );
    deliverables.push({
      id,
      taskId,
      type: artifact.type,
      title: artifact.title,
      content: artifact.content,
      language: artifact.language,
      format: artifact.format,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }

  return deliverables;
}

export function listDeliverablesByTask(taskId: string): Deliverable[] {
  const rows = stmts.listDeliverablesByTask.all(taskId) as Record<string, unknown>[];
  return rows.map(rowToDeliverable);
}

export function getDeliverable(id: string): Deliverable | null {
  const row = stmts.getDeliverable.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToDeliverable(row);
}

function rowToDeliverable(row: Record<string, unknown>): Deliverable {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    type: row.type as DeliverableType,
    title: row.title as string,
    content: row.content as string,
    language: (row.language as string) || undefined,
    format: (row.format as string) || undefined,
    metadata: JSON.parse((row.metadata as string) || '{}'),
    createdAt: row.created_at as string,
  };
}

/**
 * Validate a web deliverable for basic runnability.
 * Returns { valid, issues } where issues describe potential blank-screen causes.
 */
export function validateWebDeliverable(html: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for minimal content
  if (!html || html.trim().length < 50) {
    issues.push('HTML content is nearly empty');
  }

  // Check for <body> with actual content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').trim();
    if (bodyContent.length < 10 && !/<canvas/i.test(html)) {
      issues.push('Body has no visible content (and no canvas element)');
    }
  } else if (!/<html/i.test(html)) {
    // No body tag and no html tag — might be a fragment
    if (html.trim().length < 100 && !/<canvas|<div|<svg/i.test(html)) {
      issues.push('No <body> tag found and content appears minimal');
    }
  }

  // Check for common JS errors that would cause blank screen
  if (/<script/i.test(html)) {
    // Unclosed script tags
    const scriptOpens = (html.match(/<script/gi) || []).length;
    const scriptCloses = (html.match(/<\/script>/gi) || []).length;
    if (scriptOpens !== scriptCloses) {
      issues.push('Unclosed <script> tag detected — may prevent rendering');
    }
  }

  // Check for canvas-based apps without initialization
  if (/<canvas/i.test(html) && !/(getContext|pixi|three|phaser|createjs)/i.test(html)) {
    issues.push('Canvas element found but no rendering library/context initialization detected');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Render a deliverable for display.
 */
export function renderDeliverable(deliverable: Deliverable): { contentType: string; body: string } {
  switch (deliverable.type) {
    case 'web':
      return { contentType: 'text/html; charset=utf-8', body: deliverable.content };
    case 'report':
      // Return raw markdown — client will render it
      return { contentType: 'text/markdown; charset=utf-8', body: deliverable.content };
    case 'code':
      return { contentType: 'text/plain; charset=utf-8', body: deliverable.content };
    case 'data':
      return { contentType: 'application/json; charset=utf-8', body: deliverable.content };
    default:
      return { contentType: 'text/plain; charset=utf-8', body: deliverable.content };
  }
}
