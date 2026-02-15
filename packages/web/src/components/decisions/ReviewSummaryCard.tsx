import type { ReviewScore } from '@ai-office/shared';

const SENTIMENT_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  positive: { border: 'border-green-500/40', bg: 'bg-green-500/10', text: 'text-green-400' },
  caution: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  critical: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-400' },
};

interface Props {
  review: ReviewScore;
}

export default function ReviewSummaryCard({ review }: Props) {
  const style = SENTIMENT_STYLES[review.sentiment] || SENTIMENT_STYLES.caution;
  const isDA = review.isDevilsAdvocate;

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        isDA
          ? 'border-orange-500/50 bg-orange-500/10 ring-1 ring-orange-500/20'
          : `${style.border} ${style.bg}`
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isDA && <span className="text-lg">⚠️</span>}
          <span className="text-sm font-semibold text-gray-200">
            {review.reviewerName}
            {isDA && <span className="text-orange-400 ml-1">(깐깐이)</span>}
          </span>
        </div>
        <div className={`text-lg font-bold ${style.text}`}>
          {review.score}<span className="text-xs text-gray-500">/10</span>
        </div>
      </div>
      <ul className="space-y-1">
        {review.keyPoints.map((point, i) => (
          <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
            <span className={`mt-0.5 ${isDA ? 'text-orange-400' : style.text}`}>•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
