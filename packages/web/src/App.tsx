import { useEffect, useState } from 'react';
import { connectWS } from './store';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import OfficeView from './components/OfficeView';
import ActivityLog from './components/ActivityLog';
import Dashboard from './components/Dashboard';
import FailureTimeline from './components/FailureTimeline';

type View = 'office' | 'dashboard' | 'failures';

export default function App() {
  const [view, setView] = useState<View>('office');
  useEffect(() => { connectWS(); }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0f0f1a] text-gray-100 overflow-hidden">
      <TopBar />
      {/* View tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-panel border-b border-gray-700/30 shrink-0">
        {([
          ['office', '🏢 Office Floor'],
          ['dashboard', '📊 Dashboard'],
          ['failures', '⚠️ Failures'],
        ] as [View, string][]).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              view === v
                ? 'bg-accent/20 text-accent font-semibold'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          {view === 'office' && (
            <>
              <OfficeView />
              <ActivityLog />
            </>
          )}
          {view === 'dashboard' && <Dashboard />}
          {view === 'failures' && <FailureTimeline />}
        </main>
      </div>
    </div>
  );
}
