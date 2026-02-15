import { useState } from 'react';
import { useStore } from '../store';
import { AGENT_ROLES, AGENT_MODELS, ROLE_LABELS } from '@ai-office/shared';

export default function AgentModal({ onClose }: { onClose: () => void }) {
  const createAgent = useStore((s) => s.createAgent);
  const loading = useStore((s) => s.loading['createAgent']);
  const [name, setName] = useState('');
  const [role, setRole] = useState(AGENT_ROLES[1]); // developer
  const [model, setModel] = useState(AGENT_MODELS[1]); // sonnet

  const submit = async () => {
    if (!name.trim()) return;
    await createAgent(name.trim(), role, model);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a2e] rounded-xl border border-gray-700/50 w-[420px] max-w-[90vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-700/30 flex items-center justify-between">
          <h2 className="text-lg font-bold">👤 Add Agent</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Name *</label>
            <input
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Role</label>
            <select
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {AGENT_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Model</label>
            <select
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              value={model}
              onChange={(e) => setModel(e.target.value as typeof model)}
            >
              {AGENT_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-700/30 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/30">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || loading}
            className="px-4 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
