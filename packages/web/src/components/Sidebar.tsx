import { useState } from 'react';
import { useStore } from '../store';
import AgentCard from './AgentCard';
import AgentModal from './AgentModal';

export default function Sidebar() {
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const [showAddAgent, setShowAddAgent] = useState(false);

  return (
    <>
      <aside className="w-64 bg-panel border-r border-gray-700/50 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-700/30 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Agents ({agents.length})
          </span>
          <button
            onClick={() => setShowAddAgent(true)}
            className="text-xs px-2 py-1 bg-accent/20 text-accent hover:bg-accent/30 rounded-md font-medium transition-colors"
          >
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              selected={selectedAgentId === a.id}
              onClick={() => setSelectedAgent(selectedAgentId === a.id ? null : a.id)}
            />
          ))}
          {agents.length === 0 && (
            <div className="text-center text-gray-600 text-sm py-8">No agents yet</div>
          )}
        </div>
      </aside>
      {showAddAgent && <AgentModal onClose={() => setShowAddAgent(false)} />}
    </>
  );
}
