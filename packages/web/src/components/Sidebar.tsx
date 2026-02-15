import { useStore } from '../store';
import AgentCard from './AgentCard';

export default function Sidebar() {
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);

  return (
    <aside className="w-64 bg-panel border-r border-gray-700/50 flex flex-col shrink-0">
      <div className="p-3 border-b border-gray-700/30 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Agents ({agents.length})
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            selected={selectedAgentId === a.id}
            onClick={() => setSelectedAgent(a.id)}
          />
        ))}
        {agents.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-8">No agents yet</div>
        )}
      </div>
    </aside>
  );
}
