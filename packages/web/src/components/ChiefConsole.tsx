import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useStore } from '../store';
import type { ChiefAction, ChiefCheckIn, ChiefNotification, ChiefChatMessage, ChiefInlineAction, Meeting } from '@clawhq/shared';
import { MarkdownContent } from '../lib/format/markdown';
import ChainPlanEditor from './ChainPlanEditor';
import { useT, t as tStatic } from '../i18n';

function extractHtmlFromResult(result: string): string | null {
  const htmlMatch = result.match(/```html\s*\n([\s\S]*?)```/);
  if (htmlMatch) return htmlMatch[1];
  if (result.trim().startsWith('<!DOCTYPE') || result.trim().startsWith('<html')) {
    return result.trim();
  }
  return null;
}

// Error Boundary to prevent full-page crash from hooks errors
class ChiefErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChiefConsole] Render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center space-y-2">
          <div className="text-red-400 text-sm">{tStatic('chief.renderError')}</div>
          <div className="text-xs text-gray-500">{this.state.error}</div>
          <button onClick={() => this.setState({ hasError: false, error: '' })}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs">
            {tStatic('chief.retry')}
          </button>
          <button onClick={() => window.location.reload()}
            className="px-3 py-1 bg-accent hover:bg-accent/80 text-white rounded text-xs ml-2">
            {tStatic('chief.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function getRoleLabel(role: string): string {
  const key = `role.${role}`;
  const val = tStatic(key);
  return val === key ? role : val;
}

const ACTION_ICONS: Record<string, string> = {
  create_task: '📋', create_agent: '🤖', start_meeting: '🏛️', assign_task: '🔗',
};
function getActionLabel(type: string): string {
  const map: Record<string, string> = {
    create_task: 'action.createTask',
    create_agent: 'action.createAgent',
    start_meeting: 'action.startMeeting',
    assign_task: 'action.assignTask',
  };
  return map[type] ? tStatic(map[type]) : type;
}
const STAGE_STYLES: Record<string, { icon: string; border: string; bg: string }> = {
  planning: { icon: '📐', border: 'border-blue-500/40', bg: 'bg-blue-500/10' },
  progress: { icon: '📊', border: 'border-cyan-500/40', bg: 'bg-cyan-500/10' },
  decision: { icon: '⚖️', border: 'border-yellow-500/40', bg: 'bg-yellow-500/10' },
  completion: { icon: '🎉', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
};

const NOTIF_STYLES: Record<string, { icon: string; border: string; bg: string }> = {
  task_complete: { icon: '✅', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
  task_failed: { icon: '❌', border: 'border-indigo-500/40', bg: 'bg-indigo-500/10' },
  meeting_complete: { icon: '🏛️', border: 'border-indigo-500/40', bg: 'bg-indigo-500/10' },
  meeting_review_complete: { icon: '🔍', border: 'border-purple-500/40', bg: 'bg-purple-500/10' },
  info: { icon: 'ℹ️', border: 'border-gray-500/40', bg: 'bg-gray-500/10' },
};

function getInlineActionCopy(action: ChiefInlineAction): { label: string; title?: string } {
  if (action.action === 'view_result') {
    if (action.params?.meetingId) {
      return {
        label: tStatic('action.viewResult'),
        title: tStatic('action.viewMeetingResult'),
      };
    }
    return {
      label: tStatic('action.viewResult'),
      title: tStatic('action.viewResultGeneric'),
    };
  }
  if (action.action === 'approve' || action.id.startsWith('approve')) {
    if (action.params?.mode === 'finalize_by_chief') {
      return {
        label: tStatic('action.chiefFinalize'),
        title: tStatic('action.chiefFinalizeDesc'),
      };
    }
    return {
      label: tStatic('action.confirmNext'),
      title: tStatic('action.confirmNextDesc'),
    };
  }
  return { label: action.label, title: undefined };
}

function formatMeetingPreview(meeting: Meeting): string {
  const report = (meeting.report || '').trim();
  if (report) return report;

  const header = `# ${meeting.title}`;
  const desc = meeting.description ? `\n${meeting.description}` : '';
  const proposals = meeting.proposals
    .map((p, i) => `## ${i + 1}. ${p.agentName}\n\n${p.content || '(내용 없음)'}`)
    .join('\n\n');
  return `${header}${desc}\n\n${proposals || '_아직 수집된 의견이 없습니다._'}`;
}

function formatMeetingFullResult(meeting: Meeting): string {
  const sections: string[] = [];
  sections.push(`# ${meeting.title}`);
  if (meeting.description) sections.push(meeting.description);
  sections.push(`**상태:** ${meeting.status} · **유형:** ${meeting.character || 'planning'} · **참여자:** ${meeting.participants?.length || 0}명`);

  if (meeting.report) {
    sections.push(`## 📋 종합 보고서\n\n${meeting.report}`);
  }

  if (meeting.proposals && meeting.proposals.length > 0) {
    const proposalText = meeting.proposals
      .map((p, i) => `### ${i + 1}. ${p.agentName}\n\n${p.content || '(내용 없음)'}`)
      .join('\n\n');
    sections.push(`## 💬 참여자 의견\n\n${proposalText}`);
  }

  const dp = (meeting as any).decisionPacket;
  if (dp) {
    const dpLines: string[] = ['## 📊 의사결정 패킷'];
    if (dp.recommendation) {
      dpLines.push(`### 추천안: ${dp.recommendation.name}`);
      if (dp.recommendation.summary) dpLines.push(dp.recommendation.summary);
      if (dp.recommendation.score != null) dpLines.push(`**점수:** ${Number(dp.recommendation.score).toFixed(2)}`);
    }
    if (dp.rankings && dp.rankings.length > 0) {
      dpLines.push(`### 순위`);
      dp.rankings.forEach((r: any, i: number) => {
        dpLines.push(`${i + 1}. **${r.name}** — 점수: ${Number(r.score).toFixed(2)}${r.summary ? ` · ${r.summary}` : ''}`);
      });
    }
    if (dp.reviewerScoreCards && dp.reviewerScoreCards.length > 0) {
      dpLines.push(`### 리뷰어별 점수표`);
      for (const card of dp.reviewerScoreCards) {
        dpLines.push(`**${card.reviewerName}** (${card.reviewerRole}):`);
        for (const s of card.scores) {
          dpLines.push(`- ${s.candidateName}: **${s.score}/10**${s.comment ? ` — ${s.comment}` : ''}`);
        }
      }
    }
    if (dp.tradeoffs) dpLines.push(`### 트레이드오프\n\n${dp.tradeoffs}`);
    sections.push(dpLines.join('\n\n'));
  }

  return sections.join('\n\n');
}

function MeetingResultModal({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'preview' | 'full'>('full');
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-indigo-500/40 bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-700/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-indigo-200">{viewMode === 'full' ? '📊 회의 결과 상세' : '📝 회의 결과 미리보기'}</h3>
          <div className="flex gap-1 ml-2">
            <button onClick={() => setViewMode('preview')} className={`px-2 py-0.5 rounded text-xs ${viewMode === 'preview' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>미리보기</button>
            <button onClick={() => setViewMode('full')} className={`px-2 py-0.5 rounded text-xs ${viewMode === 'full' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>상세</button>
          </div>
          <button onClick={onClose} className="ml-auto text-sm text-gray-400 hover:text-gray-200">닫기 ✕</button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(85vh-56px)]">
          <MarkdownContent text={viewMode === 'full' ? formatMeetingFullResult(meeting) : formatMeetingPreview(meeting)} className="text-sm" />
        </div>
      </div>
    </div>
  );
}

function ActionCard({ action, index, selectable, selected, onToggle }: {
  action: ChiefAction; index: number;
  selectable?: boolean; selected?: boolean; onToggle?: (i: number) => void;
}) {
  const hasResult = action.result != null;
  const ok = action.result?.ok;
  const borderClass = hasResult
    ? ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-indigo-500/30 bg-indigo-500/10'
    : selected ? 'border-accent/50 bg-accent/10' : 'border-gray-700/40 bg-gray-800/50';

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${borderClass} ${selectable ? 'cursor-pointer hover:border-accent/60' : ''}`}
      onClick={() => selectable && onToggle?.(index)}
    >
      {selectable && (
        <input type="checkbox" checked={selected} onChange={() => onToggle?.(index)}
          className="mt-0.5 accent-accent" onClick={(e) => e.stopPropagation()} />
      )}
      <span className="text-base flex-shrink-0">{ACTION_ICONS[action.type] || '⚡'}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-200">{getActionLabel(action.type)}</div>
        <div className="text-gray-400 space-x-1">
          {Object.entries(action.params).map(([k, v]) => (
            <span key={k} className="inline-block bg-gray-700/40 rounded px-1">{k}: {v}</span>
          ))}
        </div>
        {hasResult && (
          <div className={`mt-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {ok ? '✓' : '✗'} {action.result!.message}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineNotification({ notification, onViewMeetingResult, onPreviewHtml, onSendMessage }: { notification: ChiefNotification; onViewMeetingResult: (meetingId: string) => void; onPreviewHtml?: (html: string) => void; onSendMessage?: (msg: string) => void }) {
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const tasks = useStore((s) => s.tasks);
  const [acting, setActing] = useState<string | null>(null);
  const style = NOTIF_STYLES[notification.type] || NOTIF_STYLES.info;

  // Check if task result contains HTML for live preview
  const taskId = notification.taskId;
  const taskResult = taskId ? tasks.find(t => t.id === taskId)?.result : null;
  const previewableHtml = taskResult ? extractHtmlFromResult(taskResult) : null;

  // Filter: only keep view_result actions; decision buttons removed (use chat instead)
  const viewActions = notification.actions.filter((act) => act.action === 'view_result');
  const hasReviewAction = notification.actions.some((act) => act.id.startsWith('start-review-'));

  const onAction = async (actionId: string, action: string, params: Record<string, string>) => {
    setActing(actionId);
    if (action === 'view_result' && params.taskId && !params.meetingId) {
      setSelectedTask(params.taskId);
      setActing(null);
      return;
    }
    if (action === 'view_result' && params.meetingId) {
      onViewMeetingResult(params.meetingId);
      setActing(null);
      return;
    }
    setActing(null);
  };

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3 space-y-2`}>
      <div className="text-sm font-semibold text-gray-200">{notification.title}</div>
      <MarkdownContent text={notification.summary} className="text-xs text-gray-300" />
      {viewActions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {viewActions.map((act) => {
            const copy = getInlineActionCopy(act);
            return (
              <button
                key={act.id}
                onClick={() => onAction(act.id, act.action, act.params)}
                disabled={acting !== null}
                title={copy.title}
                className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-sm text-gray-200 disabled:opacity-40 transition-colors"
              >
                {acting === act.id ? tStatic('action.actioning') : copy.label}
              </button>
            );
          })}
          {previewableHtml && onPreviewHtml && (
            <button
              onClick={() => onPreviewHtml(previewableHtml)}
              className="px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-800/70 hover:bg-emerald-700 text-sm text-gray-200 transition-colors"
            >
              {tStatic('action.livePreview')}
            </button>
          )}
          {onSendMessage && notification.type !== 'meeting_complete' && /FAIL|불합격|수정\s*필요|critical|major/i.test(notification.summary) && (
            <button
              onClick={() => onSendMessage((localStorage.getItem('clawhq-lang') || 'en') === 'ko' ? '리뷰 피드백 반영해줘' : 'Apply the review feedback fixes')}
              className="px-3 py-1.5 rounded-lg border border-amber-600 bg-amber-800/70 hover:bg-amber-700 text-sm text-gray-200 transition-colors"
            >
              {tStatic('action.applyFix')}
            </button>
          )}
        </div>
      )}
      <div className="text-xs text-gray-500 mt-1">
        {hasReviewAction
          ? tStatic('action.chatHintReview')
          : tStatic('action.chatHintDecision')}
      </div>
    </div>
  );
}

function CheckInCard({ checkIn }: { checkIn: ChiefCheckIn }) {
  const respondToCheckIn = useStore((s) => s.respondToCheckIn);
  const dismissCheckIn = useStore((s) => s.dismissCheckIn);
  const [comment, setComment] = useState('');
  const [responding, setResponding] = useState(false);
  const style = STAGE_STYLES[checkIn.stage] || STAGE_STYLES.progress;

  const handleOption = async (optionId: string) => {
    setResponding(true);
    await respondToCheckIn(checkIn.id, optionId, comment || undefined);
    setResponding(false);
  };

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3 space-y-2`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
        <span>{style.icon}</span>
        <span>{tStatic('chief.checkInTitle')}</span>
        <button onClick={() => dismissCheckIn(checkIn.id)} className="ml-auto text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>
      {checkIn.message && (
        <MarkdownContent text={checkIn.message} className="text-sm text-gray-200" />
      )}
      {checkIn.options && checkIn.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {checkIn.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => handleOption(opt.id)}
              disabled={responding}
              className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-sm text-gray-200 disabled:opacity-40 transition-colors"
              title={opt.description}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={tStatic('chief.additionalComment')}
          className="flex-1 bg-gray-800/60 border border-gray-700/40 rounded px-2 py-1 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && comment.trim()) {
              handleOption(checkIn.options?.[0]?.id || 'ok');
            }
          }}
        />
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-gray-800/70 border border-gray-700/50 text-gray-100">
      <div className="text-[11px] mb-1 opacity-70">{tStatic('chief.chief')}</div>
      <div className="flex items-center gap-1">
        <span className="animate-pulse">{tStatic('chief.thinking')}</span>
        <span className="flex gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
    </div>
  );
}

function ChatMessage({ m, checkIn, onViewMeetingResult, onPreviewHtml, onSendMessage }: { m: ChiefChatMessage; checkIn?: ChiefCheckIn; onViewMeetingResult: (meetingId: string) => void; onPreviewHtml?: (html: string) => void; onSendMessage?: (msg: string) => void }) {
  const isUser = m.role === 'user';
  const hasNotification = m.notification != null;

  // Guard: skip rendering empty chief messages (no content and no notification)
  if (!isUser && !(m.content || '').trim() && !hasNotification) return null;

  return (
    <div className="space-y-2">
      {/* For notification messages, only render InlineNotification (avoids duplicate content) */}
      {hasNotification ? (
        <div className="max-w-[85%]">
          <InlineNotification notification={m.notification!} onViewMeetingResult={onViewMeetingResult} onPreviewHtml={onPreviewHtml} onSendMessage={onSendMessage} />
        </div>
      ) : (
        <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'ml-auto bg-accent/20 text-accent border border-accent/40'
            : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'
        }`}>
          <div className="text-[11px] mb-1 opacity-70">
            {isUser ? tStatic('chief.you') : tStatic('chief.chief')}
          </div>
          <MarkdownContent text={m.content} className="text-sm" />
        </div>
      )}
      {/* Check-in options */}
      {checkIn && (
        <div className="max-w-[85%]">
          <CheckInCard checkIn={checkIn} />
        </div>
      )}
    </div>
  );
}

function ChiefConsoleInner({ panel = false }: { panel?: boolean }) {
  const chiefMessages = useStore((s) => s.chiefMessages);
  const chiefSuggestions = useStore((s) => s.chiefSuggestions);
  const chiefMeetingDraft = useStore((s) => s.chiefMeetingDraft);
  const chiefThinking = useStore((s) => s.chiefThinking);
  const chiefExecutedActions = useStore((s) => s.chiefExecutedActions);
  const chiefCheckIns = useStore((s) => s.chiefCheckIns);
  const chiefChat = useStore((s) => s.chiefChat);
  const applyChiefPlan = useStore((s) => s.applyChiefPlan);
  const createMeeting = useStore((s) => s.createMeeting);
  const loadingChat = useStore((s) => s.loading['chiefChat']);
  const loadingApply = useStore((s) => s.loading['chiefApply']);
  const loadingMeeting = useStore((s) => s.loading['createMeeting']);

  const [input, setInput] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const t = useT();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const chainPlans = useStore((s) => s.chainPlans);
  const tasks = useStore((s) => s.tasks);
  const activeChainPlans = chainPlans.filter(p => {
    // Hide completed/cancelled plans
    if (p.status === 'completed' || p.status === 'cancelled') return false;
    // Hide plans whose task no longer exists or is completed with no pending chain steps
    const task = tasks.find(t => t.id === p.taskId);
    if (!task) return false;
    return true;
  });

  const hasSuggestions = chiefSuggestions.length > 0;
  const hasExecuted = chiefExecutedActions.length > 0;
  const hasCheckIns = chiefCheckIns.length > 0;
  const hasChainPlans = activeChainPlans.length > 0;

  const suggestionSummary = useMemo(
    () => chiefSuggestions.map((s) => `${getRoleLabel(s.role)} ${s.count}`).join(', '),
    [chiefSuggestions],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chiefMessages, chiefThinking, chiefCheckIns]);

  // Build check-in map for inline rendering
  const checkInByMsgId = useMemo(() => {
    const map = new Map<string, ChiefCheckIn>();
    for (const ci of chiefCheckIns) map.set(ci.id, ci);
    return map;
  }, [chiefCheckIns]);

  const handleViewMeetingResult = async (meetingId: string) => {
    // Navigate to Meetings tab and select this meeting
    useStore.getState().setSelectedMeetingId(meetingId);
    useStore.getState().setActiveView('meetings');
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    await chiefChat(msg);
  };

  // Use form onSubmit to prevent double-send from button click + Enter
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
  };

  return (
    <div className={`flex-1 min-h-0 flex overflow-hidden ${panel ? 'flex-col' : 'p-4 gap-4'}`}>
      {/* Chat area — main interaction */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${panel ? '' : 'border border-gray-700/40 rounded-xl bg-surface'}`}>
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200 flex items-center gap-2">
          {t('chief.console')}
          {chiefThinking && <span className="text-xs text-accent animate-pulse">{t('chief.processing')}</span>}
          {hasCheckIns && <span className="text-xs text-yellow-400">🔔 {chiefCheckIns.length}</span>}
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">
              {t('chief.welcome')}
              <div className="mt-3 space-y-1 text-xs text-gray-600">
                <div>{t('chief.example1')}</div>
                <div>{t('chief.example2')}</div>
                <div>{t('chief.example3')}</div>
              </div>
            </div>
          )}
          {chiefMessages.map((m) => (
            <ChatMessage key={m.id} m={m} checkIn={checkInByMsgId.get(m.id)} onViewMeetingResult={handleViewMeetingResult} onPreviewHtml={setPreviewHtml} onSendMessage={(msg) => { setInput(''); chiefChat(msg); }} />
          ))}
          {chiefThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        {/* Input — form-based to prevent double-send */}
        <form ref={formRef} onSubmit={handleSubmit} className="p-3 border-t border-gray-700/30 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chief.placeholder')}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
          <button type="submit" disabled={!input.trim() || loadingChat}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loadingChat ? '...' : t('chief.send')}
          </button>
        </form>
      </div>

      {/* Side panel — proposals & actions */}
      <div className={`${panel ? 'border-t border-gray-700/30 p-3 overflow-y-auto space-y-3 max-h-48' : 'w-72 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto space-y-4'} ${!hasSuggestions && !hasExecuted && !hasChainPlans && panel ? 'hidden' : ''}`}>

        {/* Executed actions results */}
        {hasExecuted && (
          <div>
            <h3 className="text-sm font-semibold text-emerald-300 mb-2">{t('chief.executionResults')}</h3>
            <div className="space-y-2">
              {chiefExecutedActions.map((a, idx) => (
                <ActionCard key={idx} action={a} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* Legacy keyword-mode suggestions */}
        {hasSuggestions && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">{t('chief.teamSuggestion')}</h3>
            <div className="space-y-2 mb-4">
              {chiefSuggestions.map((s, idx) => (
                <div key={`${s.role}-${idx}`} className="flex items-center justify-between text-sm bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2">
                  <span>{getRoleLabel(s.role)}</span>
                  <span className="font-semibold">{s.count}명</span>
                </div>
              ))}
            </div>
            <button onClick={() => applyChiefPlan(chiefSuggestions)} disabled={!hasSuggestions || loadingApply}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
              {loadingApply ? t('chief.applying') : t('chief.apply')}
            </button>
            <p className="mt-2 text-xs text-gray-400">{suggestionSummary}</p>
          </div>
        )}

        {chiefMeetingDraft && (
          <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
            <div className="text-sm font-semibold text-indigo-200 mb-1">{t('chief.kickoff')}</div>
            <button onClick={() => createMeeting(chiefMeetingDraft.title, chiefMeetingDraft.description, chiefMeetingDraft.participantIds, chiefMeetingDraft.character)}
              disabled={loadingMeeting}
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40">
              {loadingMeeting ? t('chief.starting') : t('chief.startMeeting')}
            </button>
          </div>
        )}

        {/* Chain Plan Editors */}
        {hasChainPlans && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">{t('chief.chainPlans')}</h3>
            {activeChainPlans.map(plan => (
              <ChainPlanEditor key={plan.id} plan={plan} />
            ))}
          </div>
        )}

        {!hasSuggestions && !hasExecuted && !hasChainPlans && !panel && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">{t('chief.guide')}</h3>
            <div className="text-xs text-gray-400 space-y-2">
              <p>{t('chief.guideDesc')}</p>
              <ul className="list-disc list-inside space-y-1 text-gray-500">
                <li>{t('chief.guideInstruct')}</li>
                <li>{t('chief.guideComplete')}</li>
                <li>{t('chief.guideMeeting')}</li>
                <li>{t('chief.guideRevise')}</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* MeetingResultModal removed from inline — results now shown in chat */}

      {/* Live Preview Modal */}
      {previewHtml && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPreviewHtml(null)}>
          <div className="bg-gray-900 rounded-lg w-[90vw] h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-3 border-b border-gray-700">
              <span className="text-white font-medium">{t('action.livePreview')}</span>
              <button onClick={() => setPreviewHtml(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <iframe
              srcDoc={previewHtml}
              className="flex-1 bg-white rounded-b-lg"
              sandbox="allow-scripts allow-same-origin"
              title="Live Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChiefConsole({ panel = false }: { panel?: boolean }) {
  return (
    <ChiefErrorBoundary>
      <ChiefConsoleInner panel={panel} />
    </ChiefErrorBoundary>
  );
}
