import { useState } from 'react';
import { useStore } from '../store';
import Spinner from './Spinner';

export default function CommandInput() {
  const [text, setText] = useState('');
  const createTask = useStore((s) => s.createTask);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const agents = useStore((s) => s.agents);
  const loading = useStore((s) => s.loading['createTask']);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const submit = async () => {
    const cmd = text.trim();
    if (!cmd) return;
    setText('');
    await createTask(cmd, '', selectedAgentId || null);
  };

  return (
    <div className="px-3 py-2 bg-panel border-t border-gray-700/50 flex items-center gap-2 shrink-0">
      <span className="text-xs text-gray-500 shrink-0">
        {selectedAgent ? `→ ${selectedAgent.name}` : '→ auto'}
      </span>
      <input
        className="flex-1 bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 placeholder-gray-600 transition-all"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={`Send task${selectedAgent ? ` to ${selectedAgent.name}` : ''}... (Enter to submit)`}
        disabled={loading}
      />
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
