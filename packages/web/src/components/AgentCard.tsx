import type { Agent } from '@ai-office/shared';
import { ROLE_EMOJI, ROLE_LABELS } from '@ai-office/shared';

const STATE_STYLES: Record<string, { bg: string; text: string; dot: string; pulse: boolean }> = {
  idle: { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-500', pulse: false },
  working: { bg: 'bg-yellow-400/20', text: 'text-yellow-300', dot: 'bg-yellow-300', pulse: true },
  reviewing: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-500', pulse: true },
  done: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-500', pulse: false },
  error: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-500', pulse: false },
  waiting: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-500', pulse: true },
};

export default function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected?: boolean;
  onClick?: () => void;
}) {
  const style = STATE_STYLES[agent.state] || STATE_STYLES.idle;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-surface rounded-lg p-3 border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] ${
        selected
          ? 'border-accent shadow-md shadow-accent/10'
          : 'border-gray-700/30 hover:border-gray-600/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{ROLE_EMOJI[agent.role]}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{agent.name}</div>
          <div className="text-xs text-gray-500">{ROLE_LABELS[agent.role]}</div>
        </div>
        <div
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${style.bg} ${style.text}`}>
          {agent.state}
        </span>
        <span className="text-[10px] text-gray-600 font-mono truncate ml-2">{agent.model.split('/').pop()}</span>
      </div>
    </button>
  );
}
