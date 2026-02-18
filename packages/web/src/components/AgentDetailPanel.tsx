import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { utcDate } from '../utils/time';
import { ROLE_EMOJI, ROLE_LABELS } from '@ai-office/shared';
import type { Task } from '@ai-office/shared';
import TaskModal from './TaskModal';
import Spinner from './Spinner';

const STATE_BADGE: Record<string, { bg: string; text: string }> = {
  idle: { bg: 'bg-gray-500/15', text: 'text-gray-400' },
  working: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  reviewing: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  done: { bg: 'bg-green-500/15', text: 'text-green-400' },
  error: { bg: 'bg-red-500/15', text: 'text-red-400' },
  waiting: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
};

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  'in-progress': '⚡',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
};

export default function AgentDetailPanel() {
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.events);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const stopAgent = useStore((s) => s.stopAgent);
  const resetAgent = useStore((s) => s.resetAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const loading = useStore((s) => s.loading);
  const [agentTasks, setAgentTasks] = useState<Task[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);

  const agent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const currentTask = agent?.currentTaskId ? tasks.find((t) => t.id === agent.currentTaskId) ?? null : null;

  // Fetch task history for selected agent
  useEffect(() => {
    if (!selectedAgentId) { setAgentTasks([]); return; }
    fetch(`/api/tasks?assigneeId=${selectedAgentId}`)
      .then((r) => r.json())
      .then((data) => setAgentTasks(Array.isArray(data) ? data : []))
      .catch(() => setAgentTasks([]));
  }, [selectedAgentId, tasks]); // re-fetch when tasks update via WS

  const agentEvents = events.filter((e) => e.agentId === selectedAgentId).slice(0, 50);
  const isOpen = !!agent;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={() => setSelectedAgent(null)}
        />
      )}
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-[90vw] bg-[#141425] border-l border-gray-700/50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {agent && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700/40">
              <span className="text-2xl">{ROLE_EMOJI[agent.role]}</span>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold truncate">{agent.name}</h2>
                <p className="text-xs text-gray-400">{ROLE_LABELS[agent.role]}</p>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Info */}
            <div className="px-5 py-3 border-b border-gray-700/30 grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500 text-xs block">State</span>
                <span
                  className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded font-mono font-medium ${(STATE_BADGE[agent.state] || STATE_BADGE.idle).bg} ${(STATE_BADGE[agent.state] || STATE_BADGE.idle).text}`}
                >
                  {agent.state}
                </span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Model</span>
                <span className="text-xs font-mono text-gray-300 mt-0.5 block truncate">{agent.model}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Desk</span>
                <span className="text-xs text-gray-300 mt-0.5 block">#{agent.deskIndex}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Session</span>
                <span className="text-xs font-mono text-gray-300 mt-0.5 block truncate">
                  {agent.sessionId || '—'}
                </span>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="px-5 py-3 border-b border-gray-700/30 flex gap-2 flex-wrap">
              <button
                onClick={() => setShowTaskModal(true)}
                className="px-3 py-1.5 text-xs bg-accent/20 text-accent hover:bg-accent/30 rounded-md font-medium transition-colors"
              >
                📋 Assign Task
              </button>
              {agent.state === 'working' && (
                <button
                  onClick={() => stopAgent(agent.id)}
                  disabled={loading[`stop-${agent.id}`]}
                  className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  ⏹ Stop
                </button>
              )}
              {agent.state !== 'idle' && (
                <button
                  onClick={() => resetAgent(agent.id)}
                  disabled={loading[`reset-${agent.id}`]}
                  className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  🔄 Reset
                </button>
              )}
              <button
                onClick={async () => {
                  if (confirm(`Remove agent "${agent.name}"?`)) {
                    await deleteAgent(agent.id);
                    setSelectedAgent(null);
                  }
                }}
                disabled={loading[`delete-${agent.id}`] || agent.state === 'working'}
                className="px-3 py-1.5 text-xs bg-gray-700/30 text-gray-400 hover:bg-red-500/20 hover:text-red-400 rounded-md font-medium transition-colors disabled:opacity-50 ml-auto"
              >
                🗑 Remove
              </button>
            </div>

            {/* Current Task */}
            {currentTask && (
              <div className="px-5 py-3 border-b border-gray-700/30">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Current Task</div>
                <div className="bg-[#1a1a33] rounded-lg p-3 border border-accent/30">
                  <div className="font-medium text-sm text-accent">{currentTask.title}</div>
                  {currentTask.description && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-3">{currentTask.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style={{
                        backgroundColor: currentTask.status === 'in-progress' ? '#3b82f622' : '#6b728022',
                        color: currentTask.status === 'in-progress' ? '#3b82f6' : '#6b7280',
                      }}
                    >
                      {STATUS_ICONS[currentTask.status]} {currentTask.status}
                    </span>
                  </div>
                  {currentTask.result && (
                    <div className="mt-2 p-2 bg-[#0f0f1a] rounded text-xs font-mono text-green-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {/^\s*<!DOCTYPE|^\s*<html|^\s*```html/i.test(currentTask.result!) ? '🌐 웹 앱 결과물' : currentTask.result!.slice(0, 200)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Scrollable area for task history + events */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Task History */}
              <div className="px-5 py-3">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Task History ({agentTasks.length})
                </div>
                {agentTasks.length === 0 ? (
                  <div className="text-xs text-gray-600 py-2">No tasks assigned yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {agentTasks.map((t) => (
                      <div
                        key={t.id}
                        className="bg-surface rounded p-2 border border-gray-700/20 flex items-start gap-2"
                      >
                        <span className="text-xs mt-0.5">{STATUS_ICONS[t.status] || '📎'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{t.title}</div>
                          <div className="text-[10px] text-gray-500 flex gap-2 mt-0.5">
                            <span>{t.status}</span>
                            <span>{utcDate(t.updatedAt).toLocaleString()}</span>
                          </div>
                          {t.result && (
                            <div className="mt-1 text-[10px] font-mono text-gray-400 truncate">{t.result}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Agent Events */}
              <div className="px-5 py-3 border-t border-gray-700/30">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Activity ({agentEvents.length})
                </div>
                {agentEvents.length === 0 ? (
                  <div className="text-xs text-gray-600 py-2">No activity yet</div>
                ) : (
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {agentEvents.map((e) => (
                      <div key={e.id} className="py-0.5 text-gray-400 hover:text-gray-200 flex gap-2">
                        <span className="text-gray-600 shrink-0">
                          {utcDate(e.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="truncate">{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {showTaskModal && agent && (
        <TaskModal onClose={() => setShowTaskModal(false)} preAssignId={agent.id} />
      )}
    </>
  );
}
