/** DB stores UTC timestamps without Z suffix. Ensure correct parsing. */
export function utcDate(dateStr: string): Date {
  return new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
}

export function utcMs(dateStr: string): number {
  return utcDate(dateStr).getTime();
}

export function formatDuration(startStr: string, endStr: string): string {
  const ms = utcMs(endStr) - utcMs(startStr);
  if (ms < 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function formatElapsed(startStr: string): string {
  const ms = Date.now() - utcMs(startStr);
  if (ms < 0) return '0s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
