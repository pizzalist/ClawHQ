import { useState, useEffect } from 'react';
import type { Deliverable } from '@clawhq/shared';
import { DELIVERABLE_LABELS } from '@clawhq/shared';
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
  const [commitStatus, setCommitStatus] = useState<Record<string, { loading: boolean; result?: string; error?: string }>>({});

  const handleCommit = async (deliverableId: string) => {
    setCommitStatus(s => ({ ...s, [deliverableId]: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/deliverables/${deliverableId}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) {
        setCommitStatus(s => ({ ...s, [deliverableId]: { loading: false, result: data.commitHash || data.message } }));
      } else {
        setCommitStatus(s => ({ ...s, [deliverableId]: { loading: false, error: data.error } }));
      }
    } catch (err: any) {
      setCommitStatus(s => ({ ...s, [deliverableId]: { loading: false, error: err.message } }));
    }
  };

  const handleCommitAll = async () => {
    setCommitStatus(s => ({ ...s, __all: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/tasks/${taskId}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) {
        setCommitStatus(s => ({ ...s, __all: { loading: false, result: data.commitHash || data.message } }));
      } else {
        setCommitStatus(s => ({ ...s, __all: { loading: false, error: data.error } }));
      }
    } catch (err: any) {
      setCommitStatus(s => ({ ...s, __all: { loading: false, error: err.message } }));
    }
  };

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
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Deliverables ({deliverables.length})
        </h3>
        {deliverables.length > 1 && (
          <button
            onClick={handleCommitAll}
            disabled={commitStatus.__all?.loading}
            className="px-2.5 py-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-md font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {commitStatus.__all?.loading ? '⏳' : '📦'} Commit All
            {commitStatus.__all?.result && <span className="text-green-300 ml-1">✓ {commitStatus.__all.result}</span>}
          </button>
        )}
      </div>
      {commitStatus.__all?.error && (
        <div className="text-xs text-red-400 mb-2 bg-red-900/20 px-2 py-1 rounded">❌ {commitStatus.__all.error}</div>
      )}
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
                <button
                  onClick={() => handleCommit(d.id)}
                  disabled={commitStatus[d.id]?.loading}
                  className="px-2.5 py-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-md font-medium transition-colors disabled:opacity-50"
                  title={commitStatus[d.id]?.result ? `✓ ${commitStatus[d.id].result}` : commitStatus[d.id]?.error ? `❌ ${commitStatus[d.id].error}` : 'Commit to git'}
                >
                  {commitStatus[d.id]?.loading ? '⏳' : commitStatus[d.id]?.result ? '✅' : '💾'}
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
