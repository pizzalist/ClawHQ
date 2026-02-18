import { useEffect, useRef, useState } from 'react';
import type { AppEvent, Task } from '@ai-office/shared';
import { utcDate } from '../utils/time';

export default function HistoryReplay() {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/events').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()),
    ]).then(([evts, tks]) => {
      // events come newest-first from API, reverse for chronological
      const sorted = ([...evts] as AppEvent[]).reverse();
      setEvents(sorted);
      setTasks(tks);
      setCursor(sorted.length > 0 ? sorted.length - 1 : 0);
    });
  }, []);

  // auto-play
  useEffect(() => {
    if (playing && events.length > 0) {
      timerRef.current = setInterval(() => {
        setCursor(prev => {
          if (prev >= events.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, speed);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, speed, events.length]);

  // scroll visible card into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [cursor]);

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  const fmtTime = (iso: string) => {
    const d = utcDate(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const fmtDate = (iso: string) => utcDate(iso).toLocaleDateString();

  const typeColors: Record<string, string> = {
    task_completed: 'border-green-500/50 bg-green-500/5',
    task_failed: 'border-red-500/50 bg-red-500/5',
    task_assigned: 'border-blue-500/50 bg-blue-500/5',
    agent_working: 'border-yellow-500/50 bg-yellow-500/5',
  };

  const typeIcons: Record<string, string> = {
    task_completed: '✅',
    task_failed: '❌',
    task_assigned: '📋',
    agent_working: '⚡',
    agent_idle: '💤',
    task_created: '📝',
  };

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-3">🕐</div>
          <div className="text-lg font-medium">No history yet</div>
          <div className="text-sm mt-1">Events will appear here as agents work on tasks</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
      {/* Controls */}
      <div className="flex items-center gap-3 bg-surface rounded-xl border border-gray-700/30 p-3">
        <button
          onClick={() => { setCursor(0); setPlaying(true); }}
          className="px-2 py-1 text-xs rounded bg-gray-700/40 hover:bg-gray-600/40 transition-colors"
          title="Restart"
        >⏮</button>
        <button
          onClick={() => setPlaying(!playing)}
          className="px-4 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 font-semibold text-sm transition-colors"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={() => setCursor(Math.min(cursor + 1, events.length - 1))}
          className="px-2 py-1 text-xs rounded bg-gray-700/40 hover:bg-gray-600/40 transition-colors"
          disabled={cursor >= events.length - 1}
        >⏭</button>

        <div className="flex-1 mx-3">
          <input
            type="range"
            min={0}
            max={events.length - 1}
            value={cursor}
            onChange={e => { setCursor(Number(e.target.value)); setPlaying(false); }}
            className="w-full accent-accent"
          />
        </div>

        <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {cursor + 1} / {events.length}
        </span>

        <select
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
        >
          <option value={500}>Fast</option>
          <option value={1500}>Normal</option>
          <option value={3000}>Slow</option>
        </select>
      </div>

      {/* Timeline */}
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-2 pr-1">
        {events.map((evt, i) => {
          const visible = i <= cursor;
          if (!visible) return null;
          const task = evt.taskId ? taskMap.get(evt.taskId) : null;
          const meta = typeof evt.metadata === 'string' ? JSON.parse(evt.metadata || '{}') : (evt.metadata || {});
          const colorClass = typeColors[evt.type] || 'border-gray-600/50 bg-gray-800/30';
          const icon = typeIcons[evt.type] || '📌';
          const isCurrent = i === cursor;

          return (
            <div
              key={evt.id}
              data-idx={i}
              onClick={() => { setCursor(i); setPlaying(false); }}
              className={`border-l-2 pl-4 py-2 pr-3 rounded-r-lg cursor-pointer transition-all duration-200 ${colorClass} ${
                isCurrent ? 'ring-1 ring-accent/40 shadow-lg shadow-accent/5' : 'opacity-60 hover:opacity-80'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                <span>{icon}</span>
                <span className="font-mono">{fmtTime(evt.createdAt)}</span>
                <span className="text-gray-600">{fmtDate(evt.createdAt)}</span>
                <span className="ml-auto text-[10px] text-gray-600 uppercase tracking-wider">{evt.type.replace(/_/g, ' ')}</span>
              </div>
              <div className="text-sm text-gray-200">{evt.message}</div>
              {task && (
                <div className="mt-1 text-xs text-gray-500">
                  Task: <span className="text-gray-400">{task.title}</span>
                  {task.status === 'completed' && task.result && (
                    <span className="ml-2 text-green-400/70">→ {/^\s*<!DOCTYPE|^\s*<html|^\s*```html/i.test(task.result as string) ? '🌐 HTML 결과물' : `${(task.result as string).slice(0, 80)}`}</span>
                  )}
                </div>
              )}
              {meta.durationMs && (
                <div className="mt-0.5 text-[10px] text-gray-500">⏱ {(meta.durationMs / 1000).toFixed(1)}s</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
