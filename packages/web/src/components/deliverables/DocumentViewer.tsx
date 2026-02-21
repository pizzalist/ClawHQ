import { useState, useEffect } from 'react';
import type { Deliverable } from '@clawhq/shared';
import { MarkdownContent } from '../../lib/format/markdown';

interface Props {
  deliverable: Deliverable;
  onClose: () => void;
}

export default function DocumentViewer({ deliverable, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(deliverable.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300">📄 {deliverable.title}</span>
        <div className="flex-1" />
        <button onClick={handleCopy} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          {copied ? '✅ Copied!' : '📋 Copy'}
        </button>
        <button onClick={onClose} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex justify-center p-6">
        <MarkdownContent text={deliverable.content} className="max-w-3xl w-full text-gray-200 text-sm leading-relaxed font-sans" />
      </div>
    </div>
  );
}
