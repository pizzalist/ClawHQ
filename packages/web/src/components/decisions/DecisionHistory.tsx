import type { DecisionItem } from '@clawhq/shared';

const STATUS_STYLES: Record<string, { icon: string; text: string; bg: string }> = {
  approved: { icon: '✅', text: 'text-green-400', bg: 'bg-green-500/10' },
  revised: { icon: '🔄', text: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  rejected: { icon: '❌', text: 'text-red-400', bg: 'bg-red-500/10' },
};

interface Props {
  items: DecisionItem[];
}

export default function DecisionHistory({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-16">
        <span className="text-5xl mb-4">📜</span>
        <h3 className="text-lg font-medium text-gray-400">No decision history</h3>
        <p className="text-sm mt-1">Decisions you make will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const ss = STATUS_STYLES[item.status] || STATUS_STYLES.approved;
        const chosen = item.proposals.find(p => p.id === item.chosenProposalId);
        const avgScore = item.reviews.length > 0
          ? (item.reviews.reduce((s, r) => s + r.score, 0) / item.reviews.length).toFixed(1)
          : '—';

        return (
          <div
            key={item.id}
            className={`rounded-lg border border-gray-700/30 ${ss.bg} p-3 flex items-center gap-4`}
          >
            <span className="text-xl">{ss.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-200 truncate">{item.title}</div>
              <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                {chosen && <span>Winner: <span className="text-gray-300">{chosen.agentName}</span></span>}
                <span>·</span>
                <span>Avg: {avgScore}/10</span>
                <span>·</span>
                <span>{item.decidedAt ? new Date(item.decidedAt).toLocaleDateString() : '—'}</span>
              </div>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ss.text} ${ss.bg}`}>
              {item.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
