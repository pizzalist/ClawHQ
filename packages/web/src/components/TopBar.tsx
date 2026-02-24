import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useT, useLang } from '../i18n';
import type { Lang } from '../i18n';

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const download = (fmt: string) => {
    window.open(`/api/export/${fmt}`, '_blank');
    setOpen(false);
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm rounded-lg font-medium transition-all"
      >{t('topbar.export')}</button>
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

function LanguageToggle() {
  const { lang, setLang } = useLang();
  const toggle = () => setLang(lang === 'en' ? 'ko' : 'en');
  return (
    <button
      onClick={toggle}
      className="flex items-center gap-0.5 px-2 py-1 rounded-md border border-gray-600/50 text-xs font-medium text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
      title="Switch language"
    >
      <span className={lang === 'en' ? 'text-accent font-bold' : 'text-gray-500'}>EN</span>
      <span className="text-gray-600">/</span>
      <span className={lang === 'ko' ? 'text-accent font-bold' : 'text-gray-500'}>KR</span>
    </button>
  );
}

interface TopBarProps {
  onOpenSettings?: () => void;
}

export default function TopBar({ onOpenSettings }: TopBarProps) {
  const { agents, tasks, connected } = useStore();
  const working = agents.filter(a => a.state === 'working').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const [decisionCount, setDecisionCount] = useState(0);
  const t = useT();

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
          <span className="text-accent">Claw</span>HQ
        </h1>
        <div className="flex gap-4 text-sm text-gray-400 ml-auto items-center">
          <span className="hidden sm:inline">👥 {agents.length} {t('topbar.agents')}</span>
          <span className="hidden sm:inline">⚡ {working} {t('topbar.working')}</span>
          <span className="hidden sm:inline">📋 {pending} {t('topbar.pending')}</span>
          {decisionCount > 0 && (
            <span className="hidden sm:inline flex items-center gap-1">
              📌 <span className="px-1.5 py-0.5 text-[10px] bg-accent text-white rounded-full font-bold">{decisionCount}</span> {t('topbar.decisions')}
            </span>
          )}
          <span className={`flex items-center gap-1.5 transition-colors ${connected ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
            <span className="hidden sm:inline">{connected ? t('topbar.connected') : t('topbar.disconnected')}</span>
          </span>
          <LanguageToggle />
          <button
            onClick={onOpenSettings}
            className="px-2.5 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm rounded-lg font-medium transition-all"
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            ⚙️
          </button>
          <ExportMenu />
          <button
            onClick={async () => {
              if (!confirm(t('topbar.resetConfirm'))) return;
              try {
                const r = await fetch('/api/reset-all', { method: 'POST' });
                if (r.ok) {
                  const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('clawhq'));
                  keysToRemove.forEach(k => localStorage.removeItem(k));
                  window.location.href = window.location.pathname;
                } else {
                  alert(`${t('topbar.resetFail')}: ${r.status} ${r.statusText}`);
                }
              } catch (e) { alert(`${t('topbar.resetFail')}: ${e instanceof Error ? e.message : t('topbar.networkError')}`); }
            }}
            className="px-3 py-1.5 bg-red-700/50 hover:bg-red-600/60 text-red-200 text-sm rounded-lg font-medium transition-all"
          >{t('topbar.reset')}</button>
        </div>
      </header>
    </>
  );
}
