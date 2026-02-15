import { useState, useEffect } from 'react';
import type { Deliverable } from '@ai-office/shared';

interface Props {
  deliverable: Deliverable;
  onClose: () => void;
}

export default function CodeViewer({ deliverable, onClose }: Props) {
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

  const lines = deliverable.content.split('\n');

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300">💻 {deliverable.title}</span>
        {deliverable.language && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400 font-medium">
            {deliverable.language}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-500">{lines.length} lines</span>
        <button
          onClick={handleCopy}
          className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded"
        >
          {copied ? '✅ Copied!' : '📋 Copy'}
        </button>
        <button onClick={onClose} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="bg-[#0a0a15] rounded-lg border border-gray-700/40 p-4 text-sm font-mono leading-relaxed overflow-x-auto">
          <table className="border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-gray-800/30">
                  <td className="pr-4 text-right text-gray-600 select-none align-top" style={{ minWidth: '3em' }}>
                    {i + 1}
                  </td>
                  <td className="text-gray-200 whitespace-pre">{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </pre>
      </div>
    </div>
  );
}
