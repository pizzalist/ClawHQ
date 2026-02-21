import { useEffect } from 'react';
import type { Deliverable } from '@clawhq/shared';

interface Props {
  deliverable: Deliverable;
  onClose: () => void;
}

const PRESETS = [
  { label: '📱 Mobile', w: 375, h: 667 },
  { label: '📱 Tablet', w: 768, h: 1024 },
  { label: '🖥 Desktop', w: '100%' as const, h: '100%' as const },
];

import { useState } from 'react';

export default function WebViewer({ deliverable, onClose }: Props) {
  const [preset, setPreset] = useState(2);
  const current = PRESETS[preset];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const openInNewTab = () => {
    const blob = new Blob([deliverable.content], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300 mr-4">🌐 {deliverable.title}</span>
        {PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => setPreset(i)}
            className={`px-3 py-1 text-xs rounded ${preset === i ? 'bg-accent/30 text-accent' : 'text-gray-400 hover:text-white hover:bg-gray-700/30'}`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={openInNewTab} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          🔗 New Tab
        </button>
        <button onClick={onClose} className="px-3 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <iframe
          srcDoc={deliverable.content}
          sandbox="allow-scripts allow-modals"
          className="bg-white rounded-lg shadow-2xl border border-gray-600/30"
          style={{
            width: typeof current.w === 'number' ? `${current.w}px` : '100%',
            height: typeof current.h === 'number' ? `${current.h}px` : 'calc(100vh - 60px)',
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 60px)',
          }}
        />
      </div>
    </div>
  );
}
