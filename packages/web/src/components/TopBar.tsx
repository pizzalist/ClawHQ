import { useStore } from '../store';

export default function TopBar() {
  const { agents, tasks, connected } = useStore();
  const working = agents.filter(a => a.state === 'working').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  return (
    <header className="h-12 bg-panel border-b border-gray-700/50 flex items-center px-4 gap-6 shrink-0">
      <h1 className="text-lg font-bold tracking-tight">
        <span className="text-accent">AI</span> Office
      </h1>
      <div className="flex gap-4 text-sm text-gray-400 ml-auto">
        <span>👥 {agents.length} agents</span>
        <span>⚡ {working} working</span>
        <span>📋 {pending} pending</span>
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? '● Connected' : '○ Disconnected'}
        </span>
      </div>
    </header>
  );
}
