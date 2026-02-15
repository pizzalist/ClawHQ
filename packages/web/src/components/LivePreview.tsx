import { useState, useRef, useEffect } from 'react';

interface LivePreviewProps {
  html: string;
  onClose: () => void;
}

const PRESETS = [
  { label: '📱 Mobile', w: 375, h: 667 },
  { label: '📱 Tablet', w: 768, h: 1024 },
  { label: '🖥 Desktop', w: '100%' as const, h: '100%' as const },
];

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function extractPreviewableCode(result: string): string | null {
  // If result has escaped newlines (literal \n in text), unescape first
  if (result.includes('\\n')) {
    result = unescapeJsonString(result);
  }

  // Try markdown code blocks first: ```html ... ``` or ```javascript ... ```
  const htmlBlock = result.match(/```html\s*\n([\s\S]*?)```/i);
  if (htmlBlock) return htmlBlock[1].trim();

  const jsBlock = result.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (jsBlock) return wrapJS(jsBlock[1].trim());

  // Raw HTML detection
  if (/<html[\s>]/i.test(result) || /<!DOCTYPE\s+html/i.test(result)) {
    // Extract from first < to last >
    const start = result.indexOf('<');
    const end = result.lastIndexOf('>');
    if (start !== -1 && end > start) return result.slice(start, end + 1);
  }

  // Detect significant HTML with scripts/canvas
  if (/<(?:script|canvas|style|body|head)[\s>]/i.test(result) && /<\/(?:script|body|html)>/i.test(result)) {
    const start = result.indexOf('<');
    const end = result.lastIndexOf('>');
    if (start !== -1 && end > start) return result.slice(start, end + 1);
  }

  return null;
}

export function isPreviewable(result: string | null): boolean {
  if (!result) return false;
  return extractPreviewableCode(result) !== null;
}

function wrapJS(js: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}canvas{display:block;max-width:100%;}</style></head>
<body><canvas id="canvas" width="800" height="600"></canvas>
<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
${js}
</script></body></html>`;
}

export default function LivePreview({ html, onClose }: LivePreviewProps) {
  const [preset, setPreset] = useState(2); // desktop
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const current = PRESETS[preset];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const openInNewTab = () => {
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] border-b border-gray-700/50">
        <span className="text-sm font-semibold text-gray-300 mr-4">▶️ Live Preview</span>
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

      {/* Preview area */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <iframe
          ref={iframeRef}
          srcDoc={html}
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
