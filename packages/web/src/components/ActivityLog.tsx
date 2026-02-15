import { useStore } from '../store';

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

export default function ActivityLog() {
  const events = useStore((s) => s.events);

  return (
    <div className="h-48 bg-panel border-t border-gray-700/50 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-gray-700/30 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <span>Activity Log</span>
        <span className="text-[10px] font-normal text-gray-600">({events.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
        {events.map((e, i) => {
          const cfg = TYPE_CONFIG[e.type] || { icon: '📎', color: 'text-gray-400' };
          return (
            <div
              key={e.id}
              className={`py-1 flex gap-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 rounded px-1 -mx-1 transition-colors ${
                i === 0 ? 'animate-fadeIn' : ''
              }`}
            >
              <span className="shrink-0 w-5 text-center">{cfg.icon}</span>
              <span className="text-gray-600 shrink-0 tabular-nums">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <span className={`truncate ${cfg.color}`}>{e.message}</span>
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
