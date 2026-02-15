import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ROLE_EMOJI } from '@ai-office/shared';
import { utcDate } from '../utils/time';

interface Failure {
  taskId: string;
  title: string;
  description: string;
  agentId: string | null;
  agentName: string | null;
  agentRole: string | null;
  error: string;
  failedAt: string;
}

export default function FailureTimeline() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const agents = useStore((s) => s.agents);

  useEffect(() => {
    const load = () =>
      fetch('/api/failures')
        .then((r) => r.json())
        .then(setFailures)
        .catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const filtered =
    filterAgent === 'all'
      ? failures
      : failures.filter((f) => f.agentId === filterAgent);

  const failingAgentIds = [...new Set(failures.map((f) => f.agentId).filter(Boolean))];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-300">Failure Timeline</h3>
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="ml-auto bg-surface border border-gray-700/50 text-xs text-gray-300 rounded px-2 py-1"
        >
          <option value="all">All Agents</option>
          {failingAgentIds.map((id) => {
            const a = agents.find((ag) => ag.id === id);
            return (
              <option key={id} value={id!}>
                {a?.name ?? id}
              </option>
            );
          })}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          {failures.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="text-5xl mb-4 opacity-60">🎉</div>
              <h3 className="text-lg font-semibold text-gray-300 mb-1">No failures recorded</h3>
              <p className="text-sm text-gray-500">Everything is running smoothly</p>
            </div>
          ) : (
            <div className="text-gray-600 text-sm py-8 text-center">No failures for this agent</div>
          )}
        </div>
      ) : (
        <div className="relative border-l-2 border-red-500/30 ml-3 space-y-0">
          {filtered.map((f) => {
            const expanded = expandedId === f.taskId;
            const role = f.agentRole as keyof typeof ROLE_EMOJI | null;
            return (
              <button
                key={f.taskId}
                type="button"
                onClick={() => setExpandedId(expanded ? null : f.taskId)}
                className="block w-full text-left pl-6 py-3 relative hover:bg-surface/50 rounded-r transition-all duration-200 hover:pl-7"
              >
                {/* Timeline dot */}
                <div className="absolute left-[-7px] top-4 w-3 h-3 rounded-full bg-red-500 border-2 border-[#0f0f1a]" />

                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {utcDate(f.failedAt).toLocaleString()}
                  </span>
                  {f.agentName && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">
                      {role ? ROLE_EMOJI[role] + ' ' : ''}
                      {f.agentName}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium mt-1">{f.title}</div>
                <div className="text-xs text-red-400/80 mt-1 truncate">
                  {f.error.slice(0, 150)}
                </div>

                {expanded && (
                  <div className="mt-3 bg-gray-900/50 rounded-lg p-3 text-xs space-y-2">
                    {f.description && (
                      <div>
                        <span className="text-gray-500">Description: </span>
                        <span className="text-gray-300">{f.description}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Full Error:</span>
                      <pre className="mt-1 text-red-400/90 whitespace-pre-wrap break-all font-mono">
                        {f.error}
                      </pre>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
