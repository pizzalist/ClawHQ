import type { Agent } from '@ai-office/shared';
import { ROLE_EMOJI, ROLE_LABELS, STATE_COLORS } from '@ai-office/shared';

export default function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected?: boolean;
  onClick?: () => void;
}) {
  const color = STATE_COLORS[agent.state];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-surface rounded-lg p-3 border transition-colors ${selected ? 'border-accent' : 'border-gray-700/30 hover:border-accent/50'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{ROLE_EMOJI[agent.role]}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{agent.name}</div>
          <div className="text-xs text-gray-500">{ROLE_LABELS[agent.role]}</div>
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
          style={{ backgroundColor: color, animationDuration: agent.state === 'working' ? '1s' : '0s' }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: color + '22', color }}>
          {agent.state}
        </span>
        <span className="text-[10px] text-gray-600 font-mono truncate ml-2">{agent.model.split('/').pop()}</span>
      </div>
    </button>
  );
}
