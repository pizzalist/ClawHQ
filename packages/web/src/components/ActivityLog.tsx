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

export default function ActivityLog() {
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const setSelectedTask = useStore((s) => s.setSelectedTask);

  return (
    <div className="h-48 bg-panel border-t border-gray-700/50 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-gray-700/30 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <span>Activity Log</span>
        <span className="text-[10px] font-normal text-gray-600">({events.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
        {events.map((e, i) => {
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
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <span className="text-2xl mb-1 opacity-40">📝</span>
            <span className="text-xs">No activity yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
