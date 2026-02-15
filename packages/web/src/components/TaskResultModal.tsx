import { useState, useEffect } from 'react';
import { useStore } from '../store';
import LivePreview, { extractPreviewableCode, isPreviewable } from './LivePreview';
import DeliverableList from './deliverables/DeliverableList';

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  pending: { bg: 'bg-gray-500/20 text-gray-400', label: '⏳ Pending' },
  'in-progress': { bg: 'bg-blue-500/20 text-blue-400', label: '🔄 Working' },
  completed: { bg: 'bg-green-500/20 text-green-400', label: '✅ Completed' },
  failed: { bg: 'bg-red-500/20 text-red-400', label: '❌ Failed' },
  cancelled: { bg: 'bg-gray-500/20 text-gray-500', label: '🚫 Cancelled' },
};

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function TaskResultModal() {
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const createTask = useStore((s) => s.createTask);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  if (!selectedTaskId) return null;

  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) return null;

  const agent = task.assigneeId ? agents.find((a) => a.id === task.assigneeId) : null;
  const status = STATUS_BADGE[task.status] || STATUS_BADGE.pending;
  const isWorking = task.status === 'in-progress';

  const handleCopy = () => {
    if (task.result) {
      navigator.clipboard.writeText(task.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRunAgain = async () => {
    setSelectedTask(null);
    await createTask(task.title, task.description, task.assigneeId);
  };

  const previewCode = task.result ? extractPreviewableCode(task.result) : null;

  const close = () => setSelectedTask(null);

  if (showPreview && previewCode) {
    return <LivePreview html={previewCode} onClose={() => setShowPreview(false)} />;
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center" onClick={close}>
      <div
        className="bg-[#1a1a2e] rounded-xl border border-gray-700/50 w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700/30 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${status.bg}`}>{status.label}</span>
              {agent && <span>👤 {agent.name}</span>}
              <span>📅 {new Date(task.createdAt).toLocaleString()}</span>
              {task.status === 'completed' && (
                <span>⏱ {formatDuration(task.createdAt, task.updatedAt)}</span>
              )}
            </div>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-white text-lg shrink-0">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {task.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</h3>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {isWorking && (
            <div className="flex items-center gap-2 text-blue-400 text-sm py-4">
              <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span>Working...</span>
              <WorkingTimer since={task.updatedAt} />
            </div>
          )}

          {task.status === 'completed' && (
            <DeliverableList taskId={task.id} />
          )}

          {task.result && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Raw Output</h3>
              <div className="bg-[#0f0f1a] rounded-lg border border-gray-700/40 p-4 text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed max-h-[40vh] overflow-y-auto">
                {task.result}
              </div>
            </div>
          )}

          {!task.result && !isWorking && task.status !== 'pending' && (
            <div className="text-gray-500 text-sm italic py-4">No result available</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700/30 flex justify-end gap-2">
          {previewCode && (
            <button
              onClick={() => setShowPreview(true)}
              className="px-3 py-1.5 text-sm bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg font-medium transition-colors"
            >
              ▶️ Run Preview
            </button>
          )}
          {task.result && (
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-gray-700/30 transition-colors"
            >
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          )}
          <button
            onClick={handleRunAgain}
            className="px-3 py-1.5 text-sm bg-accent/20 text-accent hover:bg-accent/30 rounded-lg font-medium transition-colors"
          >
            🔄 Run Again
          </button>
          <button onClick={close} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/30">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkingTimer({ since }: { since: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return <span className="tabular-nums">{min > 0 ? `${min}m ${sec}s` : `${sec}s`}</span>;
}
