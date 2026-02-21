import { useEffect } from 'react';
import type { Deliverable } from '@clawhq/shared';
import { MarkdownContent } from '../../lib/format/markdown';

interface Props {
  deliverable: Deliverable;
  onClose: () => void;
}

export default function ReportViewer({ deliverable, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300">📊 {deliverable.title}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex justify-center p-6">
        <MarkdownContent
          text={deliverable.content}
          className="max-w-3xl w-full prose-custom"
        />
      </div>
      <style>{`
        .prose-custom h1 { font-size: 1.8em; font-weight: 700; margin: 1em 0 0.5em; color: #f1f5f9; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }
        .prose-custom h2 { font-size: 1.4em; font-weight: 600; margin: 1em 0 0.4em; color: #e2e8f0; }
        .prose-custom h3 { font-size: 1.15em; font-weight: 600; margin: 0.8em 0 0.3em; color: #cbd5e1; }
        .prose-custom code { background: rgba(255,255,255,0.08); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
        .prose-custom strong { color: #f8fafc; }
        .prose-custom li { margin-left: 1.5em; list-style: disc; }
        .prose-custom p { margin: 0.6em 0; }
      `}</style>
    </div>
  );
}
