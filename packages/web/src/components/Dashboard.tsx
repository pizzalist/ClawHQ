import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ROLE_EMOJI, ROLE_LABELS } from '@ai-office/shared';

interface Stats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  avgCompletionMs: number;
  successRate: number;
  perAgent: Array<{
    agentId: string;
    agentName: string;
    role: string;
    completed: number;
    failed: number;
    avgTimeMs: number;
  }>;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const agents = useStore((s) => s.agents);

  useEffect(() => {
    const load = () =>
      fetch('/api/stats')
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Loading stats…
      </div>
    );
  }

  const fmt = (ms: number) => {
    if (ms === 0) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const cards = [
    { label: 'Total Tasks', value: stats.total, icon: '📋', color: '#6b7280' },
    { label: 'Completed', value: stats.completed, icon: '✅', color: '#10b981' },
    { label: 'Failed', value: stats.failed, icon: '❌', color: '#ef4444' },
    { label: 'Avg Time', value: fmt(stats.avgCompletionMs), icon: '⏱️', color: '#f59e0b' },
    { label: 'Success Rate', value: stats.total > 0 ? `${stats.successRate.toFixed(0)}%` : '—', icon: '📈', color: '#3b82f6' },
  ];

  const maxCompleted = Math.max(1, ...stats.perAgent.map((a) => a.completed + a.failed));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-surface rounded-xl p-4 border border-gray-700/30"
          >
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <span>{c.icon}</span>
              <span>{c.label}</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: c.color }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-agent performance */}
      <div className="bg-surface rounded-xl border border-gray-700/30 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">
          Agent Performance
        </h3>
        {stats.perAgent.length === 0 ? (
          <div className="text-gray-600 text-sm py-4 text-center">
            No task data yet
          </div>
        ) : (
          <div className="space-y-3">
            {stats.perAgent.map((a) => {
              const agent = agents.find((ag) => ag.id === a.agentId);
              const role = agent?.role ?? 'developer';
              const total = a.completed + a.failed;
              const pct = (total / maxCompleted) * 100;
              const successPct = total > 0 ? (a.completed / total) * 100 : 0;
              return (
                <div key={a.agentId} className="flex items-center gap-3">
                  <span className="text-lg w-6 text-center">
                    {ROLE_EMOJI[role as keyof typeof ROLE_EMOJI] ?? '💻'}
                  </span>
                  <div className="w-28 truncate">
                    <div className="text-sm font-medium">{a.agentName}</div>
                    <div className="text-[10px] text-gray-500">
                      {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                    </div>
                  </div>
                  <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-green-500/70 absolute left-0 top-0 rounded-full transition-all"
                      style={{ width: `${(a.completed / maxCompleted) * 100}%` }}
                    />
                    <div
                      className="h-full bg-red-500/70 absolute top-0 rounded-full transition-all"
                      style={{
                        left: `${(a.completed / maxCompleted) * 100}%`,
                        width: `${(a.failed / maxCompleted) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="w-20 text-right text-xs text-gray-400">
                    {a.completed}✓ {a.failed}✗
                  </div>
                  <div className="w-16 text-right text-xs text-gray-500">
                    {fmt(a.avgTimeMs)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
