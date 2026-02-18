import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { utcDate } from '../utils/time';

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  agent_created: { icon: '🆕', color: 'text-purple-400' },
  agent_state_changed: { icon: '🔄', color: 'text-blue-400' },
  task_created: { icon: '📋', color: 'text-cyan-400' },
  task_assigned: { icon: '📌', color: 'text-yellow-400' },
  task_completed: { icon: '✅', color: 'text-green-400' },
  task_failed: { icon: '❌', color: 'text-red-400' },
  message: { icon: '💬', color: 'text-gray-400' },
  chain_spawned: { icon: '🔗', color: 'text-orange-400' },
};

const CLICKABLE_TYPES = new Set(['task_completed', 'task_failed', 'task_assigned']);

type FilterPreset = 'all' | 'errors' | 'tasks' | 'meetings' | 'agents';

const FILTER_PRESETS: Array<{ key: FilterPreset; label: string; icon: string; types: string[] | null }> = [
  { key: 'all', label: '전체', icon: '📋', types: null },
  { key: 'errors', label: '오류', icon: '❌', types: ['task_failed'] },
  { key: 'tasks', label: '태스크', icon: '📌', types: ['task_created', 'task_assigned', 'task_completed', 'task_failed', 'chain_spawned'] },
  { key: 'meetings', label: '미팅', icon: '🤝', types: ['message'] },
  { key: 'agents', label: '에이전트', icon: '🤖', types: ['agent_created', 'agent_state_changed'] },
];

export default function ActivityLog() {
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<FilterPreset>('all');

  const filteredEvents = useMemo(() => {
    const preset = FILTER_PRESETS.find((p) => p.key === filter);
    if (!preset || !preset.types) return events;
    const typeSet = new Set(preset.types);
    return events.filter((e) => typeSet.has(e.type));
  }, [events, filter]);

  return (
    <div className={`bg-panel border-t border-gray-700/50 flex flex-col shrink-0 transition-all duration-200 ${collapsed ? 'h-8' : 'h-48'}`}>
      <div className="flex items-center border-b border-gray-700/30 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 hover:bg-gray-700/20 transition-colors text-left"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span>Activity Log</span>
          <span className="text-[10px] font-normal text-gray-600">({filteredEvents.length}{filter !== 'all' ? `/${events.length}` : ''})</span>
        </button>
        {!collapsed && (
          <div className="flex items-center gap-1 ml-auto pr-3">
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => setFilter(preset.key)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  filter === preset.key
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/30 border border-transparent'
                }`}
                title={preset.label}
              >
                {preset.icon} {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!collapsed && <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
        {filteredEvents.map((e, i) => {
          const cfg = TYPE_CONFIG[e.type] || { icon: '📎', color: 'text-gray-400' };
          const clickable = CLICKABLE_TYPES.has(e.type) && e.taskId;
          const task = clickable ? tasks.find((t) => t.id === e.taskId) : null;
          const resultPreview = task?.result ? task.result.slice(0, 100) : null;

          return (
            <div
              key={e.id}
              onClick={clickable ? () => setSelectedTask(e.taskId!) : undefined}
              className={`py-1 flex gap-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 rounded px-1 -mx-1 transition-colors ${
                i === 0 ? 'animate-fadeIn' : ''
              } ${clickable ? 'cursor-pointer' : ''}`}
            >
              <span className="shrink-0 w-5 text-center">{cfg.icon}</span>
              <span className="text-gray-600 shrink-0 tabular-nums">
                {utcDate(e.createdAt).toLocaleTimeString()}
              </span>
              <div className="min-w-0 flex-1">
                <span className={`${cfg.color} ${clickable ? 'underline decoration-dotted underline-offset-2' : ''}`}>
                  {e.message}
                </span>
                {resultPreview && (
                  <div className="text-[10px] text-gray-600 truncate mt-0.5">
                    💬 {resultPreview}{task!.result!.length > 100 ? '...' : ''}
                  </div>
                )}
              </div>
              {clickable && (
                <span className="text-[10px] text-gray-600 shrink-0">👁</span>
              )}
            </div>
          );
        })}
        {filteredEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <span className="text-2xl mb-1 opacity-40">{filter === 'all' ? '📝' : '🔍'}</span>
            <span className="text-xs">
              {filter === 'all'
                ? '아직 활동이 없습니다. Chief에게 작업을 요청해보세요!'
                : `"${FILTER_PRESETS.find((p) => p.key === filter)?.label}" 필터에 해당하는 이벤트가 없습니다.`}
            </span>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="mt-1.5 text-[10px] text-accent hover:underline"
              >
                전체 보기
              </button>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
