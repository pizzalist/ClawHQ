import { useState } from 'react';
import { useStore } from '../store';
import TaskModal from './TaskModal';

export default function TopBar() {
  const { agents, tasks, connected } = useStore();
  const working = agents.filter(a => a.state === 'working').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const [showTaskModal, setShowTaskModal] = useState(false);

  return (
    <>
      <header className="h-12 bg-panel border-b border-gray-700/50 flex items-center px-4 gap-6 shrink-0">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-accent">AI</span> Office
        </h1>
        <div className="flex gap-4 text-sm text-gray-400 ml-auto items-center">
          <span className="hidden sm:inline">👥 {agents.length} agents</span>
          <span className="hidden sm:inline">⚡ {working} working</span>
          <span className="hidden sm:inline">📋 {pending} pending</span>
          <span className={`flex items-center gap-1.5 transition-colors ${connected ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
            <span className="hidden sm:inline">{connected ? 'Connected' : 'Disconnected'}</span>
          </span>
          <button
            onClick={() => setShowTaskModal(true)}
            className="ml-2 px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg font-semibold transition-all hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-accent/20"
          >
            + New Task
          </button>
        </div>
      </header>
      {showTaskModal && <TaskModal onClose={() => setShowTaskModal(false)} />}
    </>
  );
}
