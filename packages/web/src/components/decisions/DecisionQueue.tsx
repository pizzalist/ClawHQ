import { useState } from 'react';
import type { DecisionItem } from '@clawhq/shared';

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-400', label: '🔴 Critical' },
  high: { bg: 'bg-orange-500/20 border-orange-500/40', text: 'text-orange-400', label: '🟠 High' },
  medium: { bg: 'bg-yellow-500/20 border-yellow-500/40', text: 'text-yellow-400', label: '🟡 Medium' },
  low: { bg: 'bg-green-500/20 border-green-500/40', text: 'text-green-400', label: '🟢 Low' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  items: DecisionItem[];
  onSelect: (item: DecisionItem) => void;
}

export default function DecisionQueue({ items, onSelect }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-16">
        <span className="text-5xl mb-4">✅</span>
        <h3 className="text-lg font-medium text-gray-400">No pending decisions</h3>
        <p className="text-sm mt-1">All caught up! Check the history tab for past decisions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const ps = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.medium;
        const avgScore = item.reviews.length > 0
          ? (item.reviews.reduce((s, r) => s + r.score, 0) / item.reviews.length).toFixed(1)
          : '—';
        const expanded = expandedId === item.id;

        return (
          <div
            key={item.id}
            className={`rounded-xl border ${ps.bg} transition-all duration-200 hover:shadow-lg hover:shadow-black/10`}
          >
            <div
              className="p-4 cursor-pointer flex items-center gap-4"
              onClick={() => setExpandedId(expanded ? null : item.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ps.bg} ${ps.text}`}>
                    {ps.label}
                  </span>
                  <span className="text-xs text-gray-500">{timeAgo(item.createdAt)}</span>
                </div>
                <h3 className="text-sm font-semibold text-gray-200 truncate">{item.title}</h3>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-200">{item.proposals.length}</div>
                  <div>proposals</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-accent">{avgScore}</div>
                  <div>avg score</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onSelect(item); }}
                  className="px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg font-semibold transition-all hover:scale-105 active:scale-95"
                >
                  Decide →
                </button>
              </div>
            </div>

            {expanded && (
              <div className="px-4 pb-4 border-t border-gray-700/30 pt-3">
                <p className="text-sm text-gray-400 mb-3">{item.description || 'No description'}</p>
                <div className="flex gap-2 flex-wrap">
                  {item.proposals.map((p) => (
                    <span key={p.id} className="text-xs bg-gray-700/40 px-2 py-1 rounded-md text-gray-300">
                      {p.agentName} ({p.agentRole})
                    </span>
                  ))}
                </div>
                {item.reviews.some(r => r.isDevilsAdvocate) && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-orange-400">
                    <span>⚠️</span>
                    <span>Devil's Advocate review available</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
