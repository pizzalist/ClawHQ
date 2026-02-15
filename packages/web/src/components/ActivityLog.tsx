import { useStore } from '../store';

const TYPE_ICONS: Record<string, string> = {
  agent_created: '🆕',
  agent_state_changed: '🔄',
  task_created: '📋',
  task_assigned: '📌',
  task_completed: '✅',
  task_failed: '❌',
  message: '💬',
};

export default function ActivityLog() {
  const events = useStore((s) => s.events);

  return (
    <div className="h-48 bg-panel border-t border-gray-700/50 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-gray-700/30 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Activity Log
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
        {events.map((e) => (
          <div key={e.id} className="py-0.5 flex gap-2 text-gray-400 hover:text-gray-200">
            <span className="shrink-0">{TYPE_ICONS[e.type] || '📎'}</span>
            <span className="text-gray-600 shrink-0">
              {new Date(e.createdAt).toLocaleTimeString()}
            </span>
            <span className="truncate">{e.message}</span>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-gray-600 py-4 text-center">No activity yet</div>
        )}
      </div>
    </div>
  );
}
