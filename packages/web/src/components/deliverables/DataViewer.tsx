import { useState, useEffect, useMemo } from 'react';
import type { Deliverable } from '@clawhq/shared';

interface Props {
  deliverable: Deliverable;
  onClose: () => void;
}

function parseData(content: string, format?: string): { headers: string[]; rows: string[][] } | null {
  if (format === 'csv' || (!format && content.includes(','))) {
    try {
      const lines = content.trim().split('\n').filter(l => l.trim());
      if (lines.length < 1) return null;
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      if (headers.length > 1) return { headers, rows };
    } catch { /* fall through */ }
  }

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      const headers = Object.keys(parsed[0]);
      const rows = parsed.map(item => headers.map(h => String(item[h] ?? '')));
      return { headers, rows };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const headers = ['Key', 'Value'];
      const rows = Object.entries(parsed).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
      return { headers, rows };
    }
  } catch { /* not JSON */ }

  return null;
}

export default function DataViewer({ deliverable, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const table = useMemo(() => parseData(deliverable.content, deliverable.format), [deliverable]);

  const handleCopy = () => {
    navigator.clipboard.writeText(deliverable.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300">📈 {deliverable.title}</span>
        {deliverable.format && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
            {deliverable.format.toUpperCase()}
          </span>
        )}
        <div className="flex-1" />
        {table && <span className="text-xs text-gray-500">{table.rows.length} rows</span>}
        <button onClick={handleCopy} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          {copied ? '✅ Copied!' : '📋 Copy'}
        </button>
        <button onClick={onClose} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {table ? (
          <div className="bg-[#0a0a15] rounded-lg border border-gray-700/40 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0a0a15]">
                <tr className="border-b border-gray-700/40">
                  {table.headers.map((h, i) => (
                    <th key={i} className="text-left px-4 py-2 text-xs text-gray-400 font-semibold uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-700/20 hover:bg-gray-800/30">
                    {row.map((cell, j) => (
                      <td key={j} className="px-4 py-2 text-gray-200 font-mono text-xs">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <pre className="bg-[#0a0a15] rounded-lg border border-gray-700/40 p-4 text-sm text-gray-200 font-mono whitespace-pre-wrap">
            {deliverable.content}
          </pre>
        )}
      </div>
    </div>
  );
}
