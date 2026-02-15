import { useState, useEffect } from 'react';
import type { Deliverable } from '@ai-office/shared';
import { DELIVERABLE_LABELS } from '@ai-office/shared';
import WebViewer from './WebViewer';
import ReportViewer from './ReportViewer';
import CodeViewer from './CodeViewer';
import DataViewer from './DataViewer';
import DocumentViewer from './DocumentViewer';

const API = '';

interface Props {
  taskId: string;
}

export default function DeliverableList({ taskId }: Props) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/deliverables?taskId=${taskId}`)
      .then(r => r.json())
      .then(d => { setDeliverables(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [taskId]);

  const openDeliverable = deliverables.find(d => d.id === openId);

  if (openDeliverable) {
    const Viewer = getViewer(openDeliverable.type);
    return <Viewer deliverable={openDeliverable} onClose={() => setOpenId(null)} />;
  }

  if (loading) {
    return <div className="text-gray-500 text-sm py-4">Loading deliverables...</div>;
  }

  if (deliverables.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Deliverables ({deliverables.length})
      </h3>
      <div className="grid gap-2">
        {deliverables.map(d => {
          const meta = DELIVERABLE_LABELS[d.type] || DELIVERABLE_LABELS.document;
          return (
            <div
              key={d.id}
              className="flex items-center gap-3 bg-[#0f0f1a] rounded-lg border border-gray-700/40 p-3 hover:border-gray-600/60 transition-colors"
            >
              <span className="text-xl">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200 truncate">{d.title}</span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-accent/15 text-accent font-medium">
                    {meta.label}
                  </span>
                  {d.language && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-700/50 text-gray-400">
                      {d.language}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 truncate mt-0.5">
                  {d.content.slice(0, 80)}...
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setOpenId(d.id)}
                  className="px-2.5 py-1 text-xs bg-accent/20 text-accent hover:bg-accent/30 rounded-md font-medium transition-colors"
                >
                  Open
                </button>
                <a
                  href={`${API}/api/deliverables/${d.id}/download`}
                  className="px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded-md transition-colors"
                  download
                >
                  ⬇️
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getViewer(type: string) {
  switch (type) {
    case 'web': return WebViewer;
    case 'report': return ReportViewer;
    case 'code': return CodeViewer;
    case 'data': return DataViewer;
    default: return DocumentViewer;
  }
}
