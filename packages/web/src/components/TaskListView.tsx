import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import type { TaskStatus, Deliverable, Task } from '@clawhq/shared';
import { DELIVERABLE_LABELS } from '@clawhq/shared';
import { utcDate, formatDuration } from '../utils/time';
import LivePreview, { extractPreviewableCode, isPreviewable } from './LivePreview';
import { useT } from '../i18n';

const STATUS_BADGE: Record<string, { bg: string; icon: string }> = {
  pending: { bg: 'bg-gray-500/20 text-gray-400', icon: '⏳' },
  'in-progress': { bg: 'bg-blue-500/20 text-blue-400', icon: '🔄' },
  completed: { bg: 'bg-green-500/20 text-green-400', icon: '✅' },
  failed: { bg: 'bg-red-500/20 text-red-400', icon: '❌' },
  cancelled: { bg: 'bg-gray-500/20 text-gray-500', icon: '🚫' },
};

type Filter = 'all' | TaskStatus;

/** Extract chain progress from result like "⏳ Step 2/3: Implement starting..." */
function parseChainProgress(result: string | null): { step: number; total: number; label: string } | null {
  if (!result) return null;
  const m = result.match(/^⏳ Step (\d+)\/(\d+): (.+)$/);
  if (!m) return null;
  return { step: parseInt(m[1]), total: parseInt(m[2]), label: m[3] };
}

export default function TaskListView() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortAsc, setSortAsc] = useState(false);
  const [showChainSteps, setShowChainSteps] = useState(false);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [taskDeliverables, setTaskDeliverables] = useState<Record<string, Deliverable[]>>({});
  const tFn = useT();

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

  // Separate root tasks and child tasks
  const { rootTasks, childrenMap } = useMemo(() => {
    const roots: Task[] = [];
    const children = new Map<string, Task[]>();
    
    for (const t of tasks) {
      if (!t.parentTaskId) {
        roots.push(t);
      } else {
        // Walk up to find root
        let rootId = t.parentTaskId;
        let parent = tasks.find(p => p.id === rootId);
        while (parent?.parentTaskId) {
          rootId = parent.parentTaskId;
          parent = tasks.find(p => p.id === rootId);
        }
        const arr = children.get(rootId) || [];
        arr.push(t);
        children.set(rootId, arr);
      }
    }
    return { rootTasks: roots, childrenMap: children };
  }, [tasks]);

  // Determine which tasks to show
  const visibleTasks = showChainSteps ? tasks : rootTasks;

  const filtered = visibleTasks
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => {
      const diff = utcDate(b.createdAt).getTime() - utcDate(a.createdAt).getTime();
      return sortAsc ? -diff : diff;
    });

  const toggleChain = (rootId: string) => {
    setExpandedChains(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  const filters: [Filter, string][] = [
    ['all', `All (${visibleTasks.length})`],
    ['pending', '⏳ Pending'],
    ['in-progress', '🔄 Working'],
    ['completed', '✅ Completed'],
    ['failed', '❌ Failed'],
  ];

  const renderRow = (t: Task, isChild = false) => {
    const s = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
    const agent = t.assigneeId ? agentMap.get(t.assigneeId) : null;
    const children = childrenMap.get(t.id);
    const hasChain = !isChild && children && children.length > 0;
    const isExpanded = expandedChains.has(t.id);
    const progress = !isChild ? parseChainProgress(t.result) : null;

    return (
      <tr
        key={t.id}
        onClick={() => setSelectedTask(t.id)}
        className={`border-b border-gray-700/20 hover:bg-gray-700/20 cursor-pointer transition-colors ${isChild ? 'bg-gray-800/20' : ''}`}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {isChild && <span className="text-gray-600 text-xs ml-2">└</span>}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`}>
              {s.icon} {t.status}
            </span>
          </div>
          {/* Chain progress bar for root tasks */}
          {progress && (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(progress.step / progress.total) * 100}%` }} />
              </div>
              <span className="text-[9px] text-blue-400">{progress.step}/{progress.total}</span>
            </div>
          )}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {hasChain && !showChainSteps && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleChain(t.id); }}
                className="shrink-0 text-gray-500 hover:text-gray-300 text-xs w-4"
                title="Toggle chain steps"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            <span className="font-medium text-gray-200 truncate max-w-[280px]">{t.title}</span>
            {hasChain && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full">
                🔗 {children.length + 1} steps
              </span>
            )}
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
          {progress && (
            <div className="text-[10px] text-blue-400 mt-0.5">{progress.label}</div>
          )}
          {!progress && t.result && !t.result.startsWith('⏳') && (
            <div className="text-[10px] text-gray-500 truncate max-w-[300px] mt-0.5">
              {/^\s*<!DOCTYPE|^\s*<html|^\s*```html/i.test(t.result) ? tFn('notif.htmlResult') : `${t.result.slice(0, 80)}...`}
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
  };

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
        <label className="ml-2 flex items-center gap-1 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showChainSteps}
            onChange={(e) => setShowChainSteps(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent/50 w-3 h-3"
          />
          {tFn('task.showChainSteps')}
        </label>
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="ml-auto px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/30 rounded"
          title="Toggle sort order"
        >
          {sortAsc ? tFn('task.oldest') : tFn('task.newest')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-700/30 bg-panel">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 py-12">
            <span className="text-3xl mb-2 opacity-40">📋</span>
            <span className="text-sm">{tFn('task.noTasks')}</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel border-b border-gray-700/30">
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2">{tFn('task.status')}</th>
                <th className="text-left px-4 py-2">{tFn('task.title')}</th>
                <th className="text-left px-4 py-2 hidden md:table-cell">{tFn('task.agent')}</th>
                <th className="text-left px-4 py-2 hidden sm:table-cell">{tFn('task.created')}</th>
                <th className="text-left px-4 py-2 hidden lg:table-cell">{tFn('task.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {showChainSteps
                ? filtered.map((t) => renderRow(t))
                : filtered.map((t) => {
                    const children = childrenMap.get(t.id) || [];
                    const isExpanded = expandedChains.has(t.id);
                    return [
                      renderRow(t),
                      ...(isExpanded ? children.map(c => renderRow(c, true)) : []),
                    ];
                  }).flat()
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
