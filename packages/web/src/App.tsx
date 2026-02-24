import { useEffect, useState } from 'react';
import { connectWS, useStore } from './store';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import OfficeView from './components/OfficeView';
import ActivityLog from './components/ActivityLog';
import Dashboard from './components/Dashboard';
import FailureTimeline from './components/FailureTimeline';
import HistoryReplay from './components/HistoryReplay';
import WorkflowDAG from './components/WorkflowDAG';
import AgentDetailPanel from './components/AgentDetailPanel';
// import CommandInput from './components/CommandInput';
import ToastContainer, { toast } from './components/Toast';
import TaskListView from './components/TaskListView';
import TaskResultModal from './components/TaskResultModal';
import DecisionsView from './components/decisions/DecisionsView';
import Settings from './components/Settings';
import MeetingRoom from './components/MeetingRoom';
import ErrorBoundary from './components/ErrorBoundary';
import { useT } from './i18n';

type View = 'office' | 'dashboard' | 'decisions' | 'meetings' | 'workflow' | 'failures' | 'history' | 'tasks';

export default function App() {
  const [view, setView] = useState<View>('office');
  const activeView = useStore((s) => s.activeView);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const [decisionCount, setDecisionCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { connectWS(); }, []);
  useEffect(() => {
    const validViews: View[] = ['office', 'dashboard', 'decisions', 'meetings', 'workflow', 'failures', 'history', 'tasks'];
    if (activeView && validViews.includes(activeView as View)) {
      setView(activeView as View);
      useStore.getState().setActiveView(null);
    }
  }, [activeView]);
  useEffect(() => {
    const load = () => fetch('/api/decisions/pending/count')
      .then(r => r.json()).then(d => setDecisionCount(d.count)).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const t = useT();

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.error('[RuntimeError]', e.error || e.message);
      toast(t('error.runtime'), 'error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error('[UnhandledRejection]', e.reason);
      toast(t('error.unhandled'), 'error');
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const tabs: [View, string][] = [
    ['office', t('tab.office')],
    ['tasks', t('tab.tasks')],
    ['dashboard', t('tab.dashboard')],
    ['decisions', t('tab.decisions')],
    ['meetings', t('tab.meetings')],
    ['workflow', t('tab.workflow')],
    ['failures', t('tab.failures')],
    ['history', t('tab.history')],
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0f0f1a] text-gray-100 overflow-hidden">
      <ToastContainer />
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      {/* View tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-panel border-b border-gray-700/30 shrink-0">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="mr-2 p-1 rounded hover:bg-gray-700/40 text-gray-400 hover:text-gray-200 transition-colors lg:hidden"
          title="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        {tabs.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs rounded-md transition-all duration-200 ${
              view === v
                ? 'bg-accent/20 text-accent font-semibold shadow-sm shadow-accent/10'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
            }`}
          >
            {label}
            {v === 'decisions' && decisionCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-accent text-white rounded-full font-bold leading-none">
                {decisionCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-1 min-h-0">
        {/* Sidebar with responsive collapse */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden shrink-0 ${
            sidebarOpen ? 'w-64' : 'w-0'
          } lg:w-64`}
        >
          <Sidebar />
        </div>
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="flex-1 flex flex-col min-w-0">
          <ErrorBoundary scope={`view:${view}`} autoRecoverMs={1000}>
            {view === 'office' && (
              <>
                <OfficeView />
                <ActivityLog />
              </>
            )}
            {view === 'tasks' && <TaskListView />}
            {view === 'dashboard' && <Dashboard />}
            {view === 'decisions' && <DecisionsView />}
            {view === 'meetings' && <MeetingRoom />}
            {view === 'workflow' && <WorkflowDAG />}
            {view === 'failures' && <FailureTimeline />}
            {view === 'history' && <HistoryReplay />}
          </ErrorBoundary>
          {/* CommandInput removed — use Chief Chat instead */}
        </main>
      </div>
      <AgentDetailPanel />
      <TaskResultModal />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* Mobile bottom bar */}
      <div className="sm:hidden flex items-center justify-around bg-panel border-t border-gray-700/50 py-2 shrink-0">
        {tabs.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex flex-col items-center gap-0.5 text-[10px] px-3 py-1 rounded-lg transition-colors ${
              view === v ? 'text-accent' : 'text-gray-500'
            }`}
          >
            <span className="text-base">{label.split(' ')[0]}</span>
            <span>{label.split(' ').slice(1).join(' ')}</span>
          </button>
        ))}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`flex flex-col items-center gap-0.5 text-[10px] px-3 py-1 rounded-lg transition-colors ${
            sidebarOpen ? 'text-accent' : 'text-gray-500'
          }`}
        >
          <span className="text-base">👥</span>
          <span>{t('mobile.agents')}</span>
        </button>
      </div>
    </div>
  );
}
