import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { Task, Deliverable } from '@ai-office/shared';
import LivePreview, { extractPreviewableCode, isPreviewable } from './LivePreview';
import DeliverableList from './deliverables/DeliverableList';
import { MarkdownContent } from '../lib/format/markdown';

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  pending: { bg: 'bg-gray-500/20 text-gray-400', label: '⏳ Pending' },
  'in-progress': { bg: 'bg-blue-500/20 text-blue-400', label: '🔄 Working' },
  completed: { bg: 'bg-green-500/20 text-green-400', label: '✅ Completed' },
  failed: { bg: 'bg-red-500/20 text-red-400', label: '❌ Failed' },
  cancelled: { bg: 'bg-gray-500/20 text-gray-500', label: '🚫 Cancelled' },
};

import { formatDuration, formatElapsed, utcDate } from '../utils/time';

/** Pipeline step config by role keyword in title */
const STEP_CONFIG: Array<{ match: string; icon: string; label: string; role: string }> = [
  { match: 'pm', role: 'pm', icon: '📋', label: 'PM Plan' },
  { match: 'developer', role: 'developer', icon: '💻', label: 'Implementation' },
  { match: 'reviewer', role: 'reviewer', icon: '🔍', label: 'Review' },
];

function getStepConfig(task: Task, agents: Array<{ id: string; name: string; role: string }>) {
  const agent = task.assigneeId ? agents.find(a => a.id === task.assigneeId) : null;
  if (agent) {
    const config = STEP_CONFIG.find(s => s.role === agent.role);
    if (config) return { ...config, agentName: agent.name };
  }
  // Fallback: check title
  const titleLower = task.title.toLowerCase();
  if (titleLower.includes('[plan]')) return { icon: '📋', label: 'PM Plan', role: 'pm', agentName: agent?.name || '?' };
  if (titleLower.includes('[implement]')) return { icon: '💻', label: 'Implementation', role: 'developer', agentName: agent?.name || '?' };
  if (titleLower.includes('[review]')) return { icon: '🔍', label: 'Review', role: 'reviewer', agentName: agent?.name || '?' };
  return { icon: '📄', label: 'Step', role: 'unknown', agentName: agent?.name || '?' };
}

export default function TaskResultModal() {
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const createTask = useStore((s) => s.createTask);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [threadSummary, setThreadSummary] = useState<{
    finalDeliverableId: string | null;
    latestDeliverableByThread: string | null;
    draftDeliverableId: string | null;
    qaDeliverableId: string | null;
    allDeliverables: Deliverable[];
  } | null>(null);
  const [activeOutputTab, setActiveOutputTab] = useState<'final' | 'qa' | 'draft'>('final');

  if (!selectedTaskId) return null;

  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) return null;

  const agent = task.assigneeId ? agents.find((a) => a.id === task.assigneeId) : null;
  const status = STATUS_BADGE[task.status] || STATUS_BADGE.pending;
  const isWorking = task.status === 'in-progress';

  // Find chain children for this task (if it's a root task)
  const isRootTask = !task.parentTaskId;
  const chainChildren = isRootTask
    ? tasks.filter(t => {
        // Walk up to find if this task's root is our task
        let current = t;
        while (current.parentTaskId) {
          if (current.parentTaskId === task.id) return true;
          const parent = tasks.find(p => p.id === current.parentTaskId);
          if (!parent) break;
          current = parent;
        }
        return false;
      })
    : [];
  const hasChain = chainChildren.length > 0;

  // Build pipeline steps: root task + children
  const pipelineSteps = hasChain
    ? [task, ...chainChildren].map((t, i) => ({
        task: t,
        stepNum: i + 1,
        ...getStepConfig(t, agents),
      }))
    : [];

  // Find dev step for preview
  const devStep = pipelineSteps.find(s => s.role === 'developer')?.task;
  const previewSource = devStep?.result || task.result;
  const previewCode = previewSource ? extractPreviewableCode(previewSource) : null;

  // Parse chain progress
  const chainProgress = task.result?.match(/^⏳ Step (\d+)\/(\d+): (.+)$/);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tasks/${task.id}/thread-summary`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive || !data) return;
        setThreadSummary(data);
        if (data.finalDeliverableId) setActiveOutputTab('final');
        else if (data.qaDeliverableId) setActiveOutputTab('qa');
        else if (data.draftDeliverableId) setActiveOutputTab('draft');
      })
      .catch(() => {
        if (alive) setThreadSummary(null);
      });
    return () => { alive = false; };
  }, [task.id]);

  const selectedDeliverableId = activeOutputTab === 'final'
    ? (threadSummary?.finalDeliverableId || threadSummary?.latestDeliverableByThread)
    : activeOutputTab === 'qa'
      ? threadSummary?.qaDeliverableId
      : threadSummary?.draftDeliverableId;
  const selectedDeliverable = threadSummary?.allDeliverables?.find(d => d.id === selectedDeliverableId) || null;
  const finalOutputText = selectedDeliverable?.content || devStep?.result || task.result || '';

  const handleCopy = () => {
    const textToCopy = finalOutputText;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRunAgain = async () => {
    setSelectedTask(null);
    // For root tasks, re-create with the original assignee (PM)
    await createTask(task.title, task.description, task.assigneeId);
  };

  const toggleStep = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => setSelectedTask(null);

  if (showPreview && previewCode) {
    return <LivePreview html={previewCode} onClose={() => setShowPreview(false)} />;
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center" onClick={close}>
      <div
        className="bg-[#1a1a2e] rounded-xl border border-gray-700/50 w-[700px] max-w-[92vw] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700/30 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${status.bg}`}>{status.label}</span>
              {agent && <span>👤 {agent.name}</span>}
              {hasChain && <span className="text-purple-400">🔗 Pipeline ({pipelineSteps.length} steps)</span>}
              <span>📅 {utcDate(task.createdAt).toLocaleString()}</span>
              {task.status === 'completed' && (
                <span>⏱ {formatDuration(task.createdAt, task.updatedAt)}</span>
              )}
            </div>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-white text-lg shrink-0">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {task.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</h3>
              <MarkdownContent text={task.description} className="text-sm text-gray-300" />
            </div>
          )}

          {/* Chain progress indicator */}
          {isWorking && hasChain && chainProgress && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-blue-400 text-sm mb-2">
                <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span>Pipeline in progress — {chainProgress[3]}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${(parseInt(chainProgress[1]) / parseInt(chainProgress[2])) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-blue-400 tabular-nums">{chainProgress[1]}/{chainProgress[2]}</span>
              </div>
              {/* Step indicators */}
              <div className="flex gap-2 mt-2">
                {pipelineSteps.map((step, i) => {
                  const isDone = step.task.status === 'completed';
                  const isActive = step.task.status === 'in-progress';
                  return (
                    <div key={step.task.id} className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${isDone ? 'bg-green-500/20 text-green-400' : isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700/30 text-gray-500'}`}>
                      {step.icon} {step.label}
                      {isDone && ' ✓'}
                      {isActive && <span className="inline-block w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isWorking && !hasChain && (
            <div className="flex items-center gap-2 text-blue-400 text-sm py-4">
              <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span>Working...</span>
              <WorkingTimer since={task.updatedAt} />
            </div>
          )}

          {/* Pipeline section for completed chain tasks */}
          {hasChain && task.status === 'completed' && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pipeline Steps</h3>
              <div className="space-y-1">
                {pipelineSteps.map((step) => {
                  const isExpanded = expandedSteps.has(step.task.id);
                  const isDev = step.role === 'developer';
                  return (
                    <div key={step.task.id} className="border border-gray-700/30 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleStep(step.task.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700/20 transition-colors"
                      >
                        <span className="text-gray-500 text-xs w-4">{isExpanded ? '▼' : '▶'}</span>
                        <span>{step.icon}</span>
                        <span className="font-medium text-gray-200">Step {step.stepNum}: {step.label}</span>
                        <span className="text-gray-500 text-xs">({step.agentName})</span>
                        {isDev && <span className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">Main Output</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${step.task.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                          {step.task.status === 'completed' ? '✅' : step.task.status}
                        </span>
                      </button>
                      {isExpanded && step.task.result && (
                        <div className="px-4 pb-3 border-t border-gray-700/20">
                          <div className="bg-[#0f0f1a] rounded-lg border border-gray-700/40 p-3 mt-2 text-xs text-gray-300 leading-relaxed">
                            <MarkdownContent text={step.task.result} className="text-xs" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {task.status === 'completed' && (
            <>
              <DeliverableList taskId={task.id} />
              <WebValidationWarning taskId={task.id} />
            </>
          )}

          {/* Final/Draft/QA output view */}
          {finalOutputText && !finalOutputText.startsWith('⏳') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {hasChain ? 'Deliverable View' : 'Raw Output'}
                </h3>
                {hasChain && (
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      onClick={() => setActiveOutputTab('final')}
                      className={`px-2 py-0.5 rounded ${activeOutputTab === 'final' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700/40 text-gray-400'}`}
                    >최종본</button>
                    <button
                      onClick={() => setActiveOutputTab('qa')}
                      className={`px-2 py-0.5 rounded ${activeOutputTab === 'qa' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-700/40 text-gray-400'}`}
                    >QA</button>
                    <button
                      onClick={() => setActiveOutputTab('draft')}
                      className={`px-2 py-0.5 rounded ${activeOutputTab === 'draft' ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-700/40 text-gray-400'}`}
                    >초안</button>
                  </div>
                )}
              </div>
              {hasChain && (
                <div className="text-[11px] text-gray-500 mb-2">
                  연결: finalDeliverableId={threadSummary?.finalDeliverableId || '-'} · latestDeliverableByThread={threadSummary?.latestDeliverableByThread || '-'}
                </div>
              )}
              <div className="bg-[#0f0f1a] rounded-lg border border-gray-700/40 p-4 text-sm text-gray-200 leading-relaxed">
                <MarkdownContent text={finalOutputText} className="text-sm" />
              </div>
            </div>
          )}

          {!finalOutputText && !isWorking && task.status !== 'pending' && (
            <div className="text-gray-500 text-sm italic py-4">No result available</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700/30 flex justify-end gap-2">
          {previewCode && (
            <button
              onClick={() => setShowPreview(true)}
              className="px-3 py-1.5 text-sm bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg font-medium transition-colors"
            >
              ▶️ Run Preview
            </button>
          )}
          {finalOutputText && !finalOutputText.startsWith('⏳') && (
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-gray-700/30 transition-colors"
            >
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          )}
          <button
            onClick={handleRunAgain}
            className="px-3 py-1.5 text-sm bg-accent/20 text-accent hover:bg-accent/30 rounded-lg font-medium transition-colors"
          >
            🔄 Run Again
          </button>
          <button onClick={close} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/30">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function WebValidationWarning({ taskId }: { taskId: string }) {
  const [issues, setIssues] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/deliverables?taskId=${taskId}`)
      .then(r => r.json())
      .then((deliverables: any[]) => {
        const webOnes = deliverables.filter((d: any) => d.type === 'web');
        const allIssues: string[] = [];
        for (const d of webOnes) {
          const validation = d.metadata?.validation;
          if (validation && !validation.valid) {
            allIssues.push(...validation.issues);
          }
        }
        setIssues(allIssues);
      })
      .catch(() => {});
  }, [taskId]);

  if (issues.length === 0) return null;

  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
      <div className="flex items-center gap-2 text-orange-400 text-sm font-semibold mb-1">
        ⚠️ 실행 검증 경고
      </div>
      <ul className="text-xs text-orange-300 space-y-0.5 list-disc list-inside">
        {issues.map((issue, i) => <li key={i}>{issue}</li>)}
      </ul>
      <p className="text-xs text-orange-400/70 mt-2">
        브라우저에서 빈 화면이 될 수 있습니다. '수정 요청' 또는 '다시 실행'을 권장합니다.
      </p>
    </div>
  );
}

function WorkingTimer({ since }: { since: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="tabular-nums">{formatElapsed(since)}</span>;
}
