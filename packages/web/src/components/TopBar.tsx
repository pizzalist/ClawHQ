import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import TaskModal from './TaskModal';

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const download = (fmt: string) => {
    window.open(`/api/export/${fmt}`, '_blank');
    setOpen(false);
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm rounded-lg font-medium transition-all"
      >📥 Export</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[140px] py-1">
          {[['json', '📋 JSON'], ['markdown', '📝 Markdown'], ['csv', '📊 CSV']].map(([fmt, label]) => (
            <button key={fmt} onClick={() => download(fmt)} className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors">
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const { agents, tasks, connected } = useStore();
  const working = agents.filter(a => a.state === 'working').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [decisionCount, setDecisionCount] = useState(0);

  useEffect(() => {
    const load = () => fetch('/api/decisions/pending/count')
      .then(r => r.json())
      .then(d => setDecisionCount(d.count))
      .catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

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
          {decisionCount > 0 && (
            <span className="hidden sm:inline flex items-center gap-1">
              📌 <span className="px-1.5 py-0.5 text-[10px] bg-accent text-white rounded-full font-bold">{decisionCount}</span> decisions
            </span>
          )}
          <span className={`flex items-center gap-1.5 transition-colors ${connected ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
            <span className="hidden sm:inline">{connected ? 'Connected' : 'Disconnected'}</span>
          </span>
          <ExportMenu />
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
