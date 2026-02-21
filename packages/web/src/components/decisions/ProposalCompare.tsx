import { useState } from 'react';
import type { DecisionItem, Proposal, ReviewScore } from '@clawhq/shared';
import ReviewSummaryCard from './ReviewSummaryCard';

interface Props {
  item: DecisionItem;
  onDecide: (action: 'approved' | 'revised' | 'rejected', proposalId?: string) => void;
  onBack: () => void;
}

function ProposalCard({
  proposal,
  reviews,
  rank,
  onAction,
}: {
  proposal: Proposal;
  reviews: ReviewScore[];
  rank: number;
  onAction: (action: 'approved' | 'revised' | 'rejected') => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const avgScore = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.score, 0) / reviews.length)
    : 0;
  const devilReviews = reviews.filter(r => r.isDevilsAdvocate);
  const normalReviews = reviews.filter(r => !r.isDevilsAdvocate);

  return (
    <div className="bg-surface rounded-xl border border-gray-700/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">
            #{rank}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-200">{proposal.agentName}</div>
            <div className="text-xs text-gray-500">{proposal.agentRole} · {proposal.agentModel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`text-2xl font-bold ${avgScore >= 7 ? 'text-green-400' : avgScore >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
            {avgScore.toFixed(1)}
          </div>
          <span className="text-xs text-gray-500">/10</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300 mb-2 transition-colors"
        >
          {expanded ? '▼ Collapse' : '▶ Expand'} Proposal
        </button>
        {expanded && (
          <div className="bg-gray-800/50 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto mb-3 leading-relaxed">
            {proposal.content}
          </div>
        )}

        {/* Pros / Cons */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <h4 className="text-xs font-semibold text-green-400 mb-1.5">✅ Pros</h4>
            <ul className="space-y-1">
              {proposal.pros.map((p, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <span className="text-green-400 mt-0.5">+</span>
                  <span>{p}</span>
                </li>
              ))}
              {proposal.pros.length === 0 && <li className="text-xs text-gray-600">None listed</li>}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-red-400 mb-1.5">❌ Cons</h4>
            <ul className="space-y-1">
              {proposal.cons.map((c, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <span className="text-red-400 mt-0.5">−</span>
                  <span>{c}</span>
                </li>
              ))}
              {proposal.cons.length === 0 && <li className="text-xs text-gray-600">None listed</li>}
            </ul>
          </div>
        </div>

        {/* Reviews */}
        {devilReviews.length > 0 && (
          <div className="mb-3">
            <h4 className="text-xs font-semibold text-orange-400 mb-2">⚠️ Devil's Advocate</h4>
            <div className="space-y-2">
              {devilReviews.map(r => <ReviewSummaryCard key={r.id} review={r} />)}
            </div>
          </div>
        )}
        {normalReviews.length > 0 && (
          <div className="mb-3">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">📝 Reviews</h4>
            <div className="space-y-2">
              {normalReviews.map(r => <ReviewSummaryCard key={r.id} review={r} />)}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t border-gray-700/30">
          <button
            onClick={() => onAction('approved')}
            className="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm font-semibold rounded-lg transition-all hover:scale-[1.02] active:scale-95"
          >
            ✅ Approve
          </button>
          <button
            onClick={() => onAction('revised')}
            className="flex-1 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 text-sm font-semibold rounded-lg transition-all hover:scale-[1.02] active:scale-95"
          >
            🔄 Revise
          </button>
          <button
            onClick={() => onAction('rejected')}
            className="flex-1 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-semibold rounded-lg transition-all hover:scale-[1.02] active:scale-95"
          >
            ❌ Reject
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProposalCompare({ item, onDecide, onBack }: Props) {
  // Sort proposals by avg review score descending
  const sorted = [...item.proposals].sort((a, b) => {
    const aReviews = item.reviews.filter(r => r.proposalId === a.id);
    const bReviews = item.reviews.filter(r => r.proposalId === b.id);
    const aAvg = aReviews.length > 0 ? aReviews.reduce((s, r) => s + r.score, 0) / aReviews.length : 0;
    const bAvg = bReviews.length > 0 ? bReviews.reduce((s, r) => s + r.score, 0) / bReviews.length : 0;
    return bAvg - aAvg;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-700/40 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
        >
          ← Back
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-200">{item.title}</h2>
          <p className="text-xs text-gray-500">{item.proposals.length} proposals · {item.reviews.length} reviews</p>
        </div>
      </div>

      {/* Proposals grid */}
      <div className={`grid gap-4 ${sorted.length > 1 ? 'lg:grid-cols-2' : 'max-w-2xl'}`}>
        {sorted.map((proposal, idx) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            reviews={item.reviews.filter(r => r.proposalId === proposal.id)}
            rank={idx + 1}
            onAction={(action) => onDecide(action, proposal.id)}
          />
        ))}
      </div>

      {item.proposals.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <span className="text-4xl block mb-3">📭</span>
          <p>No proposals yet for this item</p>
        </div>
      )}
    </div>
  );
}
