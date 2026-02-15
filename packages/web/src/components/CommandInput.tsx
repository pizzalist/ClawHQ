import { useState, useMemo } from 'react';
import { useStore } from '../store';
import Spinner from './Spinner';
import { detectDeliverableType, DELIVERABLE_LABELS, type DeliverableType } from '@ai-office/shared';

const ALL_TYPES: DeliverableType[] = ['web', 'report', 'code', 'data', 'design', 'document'];

export default function CommandInput() {
  const [text, setText] = useState('');
  const [typeOverride, setTypeOverride] = useState<DeliverableType | null>(null);
  const createTask = useStore((s) => s.createTask);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const agents = useStore((s) => s.agents);
  const loading = useStore((s) => s.loading['createTask']);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const detectedType = useMemo(() => detectDeliverableType(text), [text]);
  const activeType = typeOverride ?? detectedType;
  const label = DELIVERABLE_LABELS[activeType];

  const cycleBadge = () => {
    const currentIdx = ALL_TYPES.indexOf(activeType);
    const next = ALL_TYPES[(currentIdx + 1) % ALL_TYPES.length];
    setTypeOverride(next);
  };

  const submit = async () => {
    const cmd = text.trim();
    if (!cmd) return;
    const delivType = activeType;
    setText('');
    setTypeOverride(null);
    await createTask(cmd, '', selectedAgentId || null, [delivType]);
  };

  return (
    <div className="px-3 py-2 bg-panel border-t border-gray-700/50 flex items-center gap-2 shrink-0">
      <span className="text-xs text-gray-500 shrink-0">
        {selectedAgent ? `→ ${selectedAgent.name}` : '→ auto'}
      </span>
      <div className="flex-1 flex items-center gap-1.5 bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30 transition-all">
        <input
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-600"
          value={text}
          onChange={(e) => { setText(e.target.value); setTypeOverride(null); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={`Send task${selectedAgent ? ` to ${selectedAgent.name}` : ''}... (Enter to submit)`}
          disabled={loading}
        />
        {text.trim() && (
          <button
            type="button"
            onClick={cycleBadge}
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            title="Click to change type"
          >
            {label.icon} {label.label}
          </button>
        )}
      </div>
      <button
        onClick={submit}
        disabled={!text.trim() || loading}
        className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg font-medium disabled:opacity-50 shrink-0 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5"
      >
        {loading ? <Spinner size={14} /> : null}
        {loading ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
}
