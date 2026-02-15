import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { TaskStatus, Deliverable } from '@ai-office/shared';
import { DELIVERABLE_LABELS } from '@ai-office/shared';
import { utcDate, formatDuration } from '../utils/time';
import LivePreview, { extractPreviewableCode, isPreviewable } from './LivePreview';

const STATUS_BADGE: Record<string, { bg: string; icon: string }> = {
  pending: { bg: 'bg-gray-500/20 text-gray-400', icon: '⏳' },
  'in-progress': { bg: 'bg-blue-500/20 text-blue-400', icon: '🔄' },
  completed: { bg: 'bg-green-500/20 text-green-400', icon: '✅' },
  failed: { bg: 'bg-red-500/20 text-red-400', icon: '❌' },
  cancelled: { bg: 'bg-gray-500/20 text-gray-500', icon: '🚫' },
};

type Filter = 'all' | TaskStatus;

export default function TaskListView() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortAsc, setSortAsc] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [taskDeliverables, setTaskDeliverables] = useState<Record<string, Deliverable[]>>({});

  // Fetch deliverable types for completed tasks
  useEffect(() => {
    const completedIds = tasks.filter(t => t.status === 'completed').map(t => t.id);
    const missing = completedIds.filter(id => !(id in taskDeliverables));
    for (const id of missing.slice(0, 10)) {
      fetch(`/api/deliverables?taskId=${id}`)
        .then(r => r.json())
        .then(d => setTaskDeliverables(prev => ({ ...prev, [id]: d })))
        .catch(() => {});
    }
  }, [tasks]);

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const filtered = tasks
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => {
      const diff = utcDate(b.createdAt).getTime() - utcDate(a.createdAt).getTime();
      return sortAsc ? -diff : diff;
    });

  const filters: [Filter, string][] = [
    ['all', `All (${tasks.length})`],
    ['pending', '⏳ Pending'],
    ['in-progress', '🔄 Working'],
    ['completed', '✅ Completed'],
    ['failed', '❌ Failed'],
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      {previewHtml && <LivePreview html={previewHtml} onClose={() => setPreviewHtml(null)} />}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {filters.map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full transition-all ${
              filter === f
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="ml-auto px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/30 rounded"
          title="Toggle sort order"
        >
          {sortAsc ? '↑ Oldest' : '↓ Newest'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-700/30 bg-panel">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 py-12">
            <span className="text-3xl mb-2 opacity-40">📋</span>
            <span className="text-sm">No tasks found</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel border-b border-gray-700/30">
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2 hidden md:table-cell">Agent</th>
                <th className="text-left px-4 py-2 hidden sm:table-cell">Created</th>
                <th className="text-left px-4 py-2 hidden lg:table-cell">Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const s = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
                const agent = t.assigneeId ? agentMap.get(t.assigneeId) : null;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTask(t.id)}
                    className="border-b border-gray-700/20 hover:bg-gray-700/20 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`}>
                        {s.icon} {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-200 truncate max-w-[280px]">{t.title}</span>
                        {taskDeliverables[t.id]?.map(d => (
                          <span key={d.id} title={DELIVERABLE_LABELS[d.type]?.label || d.type} className="text-xs opacity-60">
                            {DELIVERABLE_LABELS[d.type]?.icon}
                          </span>
                        ))}
                        {isPreviewable(t.result) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const code = extractPreviewableCode(t.result!);
                              if (code) setPreviewHtml(code);
                            }}
                            className="shrink-0 text-emerald-400 hover:text-emerald-300 text-xs"
                            title="Run Preview"
                          >
                            ▶️
                          </button>
                        )}
                      </div>
                      {t.result && (
                        <div className="text-[10px] text-gray-500 truncate max-w-[300px] mt-0.5">
                          {t.result.slice(0, 80)}...
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">
                      {agent?.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums hidden sm:table-cell">
                      {utcDate(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums hidden lg:table-cell">
                      {t.status === 'completed' || t.status === 'failed'
                        ? formatDuration(t.createdAt, t.updatedAt)
                        : t.status === 'in-progress'
                        ? '⏱ ...'
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
