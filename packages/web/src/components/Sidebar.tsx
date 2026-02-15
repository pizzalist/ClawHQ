import { useState } from 'react';
import { useStore } from '../store';
import AgentCard from './AgentCard';
import AgentModal from './AgentModal';
import TeamPresets from './TeamPresets';
import EmptyState from './EmptyState';
import { SidebarSkeleton } from './Skeleton';

export default function Sidebar() {
  const agents = useStore((s) => s.agents);
  const initialized = useStore((s) => s.initialized);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  return (
    <>
      <aside className="w-64 bg-panel border-r border-gray-700/50 flex flex-col shrink-0 h-full">
        <div className="p-3 border-b border-gray-700/30 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Agents ({agents.length})
          </span>
          <button
            onClick={() => setShowAddAgent(true)}
            className="text-xs px-2 py-1 bg-accent/20 text-accent hover:bg-accent/30 rounded-md font-medium transition-all hover:scale-105 active:scale-95"
          >
            + Add
          </button>
          <button
            onClick={() => setShowPresets(true)}
            className="text-xs px-2 py-1 bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 rounded-md font-medium transition-all hover:scale-105 active:scale-95"
          >
            🏗️ Presets
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {!initialized ? (
            <SidebarSkeleton />
          ) : agents.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No agents yet"
              description="Add your first AI agent to get started"
              action="+ Add Agent"
              onAction={() => setShowAddAgent(true)}
            />
          ) : (
            agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                selected={selectedAgentId === a.id}
                onClick={() => setSelectedAgent(selectedAgentId === a.id ? null : a.id)}
              />
            ))
          )}
        </div>
      </aside>
      {showAddAgent && <AgentModal onClose={() => setShowAddAgent(false)} />}
      {showPresets && <TeamPresets onClose={() => setShowPresets(false)} />}
    </>
  );
}
