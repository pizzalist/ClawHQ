import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ChiefAction, ChiefCheckIn, ChiefNotification, ChiefChatMessage, ChiefInlineAction, Meeting } from '@ai-office/shared';
import { MarkdownContent } from '../lib/format/markdown';
import ChainPlanEditor from './ChainPlanEditor';

const ROLE_LABELS: Record<string, string> = {
  pm: 'PM', developer: '개발', reviewer: '리뷰어',
  designer: '디자이너', devops: 'DevOps', qa: 'QA',
};

const ACTION_ICONS: Record<string, string> = {
  create_task: '📋', create_agent: '🤖', start_meeting: '🏛️', assign_task: '🔗',
};
const ACTION_LABELS: Record<string, string> = {
  create_task: '작업 생성', create_agent: '에이전트 생성', start_meeting: '미팅 시작', assign_task: '작업 배정',
};
const STAGE_STYLES: Record<string, { icon: string; border: string; bg: string }> = {
  planning: { icon: '📐', border: 'border-blue-500/40', bg: 'bg-blue-500/10' },
  progress: { icon: '📊', border: 'border-cyan-500/40', bg: 'bg-cyan-500/10' },
  decision: { icon: '⚖️', border: 'border-yellow-500/40', bg: 'bg-yellow-500/10' },
  completion: { icon: '🎉', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
};

const NOTIF_STYLES: Record<string, { icon: string; border: string; bg: string }> = {
  task_complete: { icon: '✅', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
  task_failed: { icon: '❌', border: 'border-red-500/40', bg: 'bg-red-500/10' },
  meeting_complete: { icon: '🏛️', border: 'border-indigo-500/40', bg: 'bg-indigo-500/10' },
  meeting_review_complete: { icon: '🔍', border: 'border-purple-500/40', bg: 'bg-purple-500/10' },
  info: { icon: 'ℹ️', border: 'border-gray-500/40', bg: 'bg-gray-500/10' },
};

function getInlineActionCopy(action: ChiefInlineAction): { label: string; title?: string } {
  if (action.action === 'view_result') {
    if (action.params?.meetingId) {
      return {
        label: '👁 미리보기 (모달)',
        title: '회의 결과를 모달에서 미리 봅니다. 대화 본문에는 추가되지 않습니다.',
      };
    }
    return {
      label: '👁 결과 미리보기',
      title: '결과를 미리 확인합니다. 확정을 누르기 전에는 실행되지 않습니다.',
    };
  }
  if (action.action === 'approve' || action.id.startsWith('approve')) {
    return {
      label: '✅ 확정 · 다음 단계 실행',
      title: '미리보기 내용을 승인하고 다음 단계를 실제로 진행합니다.',
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

function MeetingResultModal({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-indigo-500/40 bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-700/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-indigo-200">📝 회의 결과 미리보기</h3>
          <span className="text-xs text-gray-400">(대화 스트림에 추가되지 않음)</span>
          <button onClick={onClose} className="ml-auto text-sm text-gray-400 hover:text-gray-200">닫기 ✕</button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(85vh-56px)]">
          <MarkdownContent text={formatMeetingPreview(meeting)} className="text-sm" />
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
    ? ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'
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
        <div className="font-semibold text-gray-200">{ACTION_LABELS[action.type] || action.type}</div>
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

function InlineNotification({ notification, onPreviewMeeting }: { notification: ChiefNotification; onPreviewMeeting: (meetingId: string) => void }) {
  const handleAction = useStore((s) => s.handleChiefInlineAction);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [acting, setActing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const style = NOTIF_STYLES[notification.type] || NOTIF_STYLES.info;

  const [dismissReason, setDismissReason] = useState<string | null>(null);

  if (dismissed) {
    return (
      <div className={`rounded-xl border ${style.border} ${style.bg} p-2 opacity-50`}>
        <div className="text-xs text-gray-400">{dismissReason || '✓ 처리됨'}</div>
      </div>
    );
  }

  const onAction = async (actionId: string, action: string, params: Record<string, string>) => {
    setActing(actionId);
    // Special: view_result opens preview modals client-side (no chat pollution)
    if (action === 'view_result' && params.taskId && !params.meetingId) {
      setSelectedTask(params.taskId);
      setActing(null);
      return;
    }
    if (action === 'view_result' && params.meetingId) {
      onPreviewMeeting(params.meetingId);
      setActing(null);
      return;
    }
    // All other actions (approve/revise/start-review etc.) go to server
    await handleAction(notification.id, actionId, params);
    setActing(null);
    // Dismiss after handling (except view actions) with contextual reason
    if (action !== 'view_result' && !actionId.startsWith('view-')) {
      if (action === 'approve' || actionId.startsWith('approve')) {
        setDismissReason('✅ 확정됨 — 다음 단계 안내가 아래에 표시됩니다');
      } else if (action === 'request_revision' || actionId.startsWith('revise')) {
        setDismissReason('🔄 수정 요청됨 — 수정 방향을 입력해주세요');
      } else {
        setDismissReason('✓ 처리됨');
      }
      setDismissed(true);
    }
  };

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3 space-y-2`}>
      <div className="text-sm font-semibold text-gray-200">{notification.title}</div>
      <MarkdownContent text={notification.summary} className="text-xs text-gray-300" />
      <div className="flex flex-wrap gap-2 mt-1">
        {notification.actions.map((act) => {
          const copy = getInlineActionCopy(act);
          return (
            <button
              key={act.id}
              onClick={() => onAction(act.id, act.action, act.params)}
              disabled={acting !== null}
              title={copy.title}
              className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-sm text-gray-200 disabled:opacity-40 transition-colors"
            >
              {acting === act.id ? '처리 중...' : copy.label}
            </button>
          );
        })}
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
        <span>총괄자 확인 요청</span>
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
          placeholder="추가 의견 (선택)"
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
      <div className="text-[11px] mb-1 opacity-70">총괄자</div>
      <div className="flex items-center gap-1">
        <span className="animate-pulse">생각하는 중</span>
        <span className="flex gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
    </div>
  );
}

function ChatMessage({ m, checkIn, onPreviewMeeting }: { m: ChiefChatMessage; checkIn?: ChiefCheckIn; onPreviewMeeting: (meetingId: string) => void }) {
  const isUser = m.role === 'user';
  const hasNotification = m.notification != null;
  const notifStyle = hasNotification ? NOTIF_STYLES[m.notification!.type] || NOTIF_STYLES.info : null;

  // Guard: skip rendering empty chief messages (no content and no notification)
  if (!isUser && !(m.content || '').trim() && !hasNotification) return null;

  return (
    <div className="space-y-2">
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
        isUser
          ? 'ml-auto bg-accent/20 text-accent border border-accent/40'
          : hasNotification
            ? `${notifStyle!.bg} border ${notifStyle!.border} text-gray-100`
            : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'
      }`}>
        <div className="text-[11px] mb-1 opacity-70">
          {isUser ? '나' : hasNotification ? `${notifStyle!.icon} 총괄자` : '총괄자'}
        </div>
        <MarkdownContent text={m.content} className="text-sm" />
      </div>
      {/* Inline action buttons for notifications */}
      {hasNotification && m.notification!.actions.length > 0 && (
        <div className="max-w-[85%]">
          <InlineNotification notification={m.notification!} onPreviewMeeting={onPreviewMeeting} />
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

export default function ChiefConsole({ panel = false }: { panel?: boolean }) {
  const chiefMessages = useStore((s) => s.chiefMessages);
  const chiefSuggestions = useStore((s) => s.chiefSuggestions);
  const chiefMeetingDraft = useStore((s) => s.chiefMeetingDraft);
  const chiefThinking = useStore((s) => s.chiefThinking);
  const chiefProposedActions = useStore((s) => s.chiefProposedActions);
  const chiefExecutedActions = useStore((s) => s.chiefExecutedActions);
  const chiefPendingMessageId = useStore((s) => s.chiefPendingMessageId);
  const chiefCheckIns = useStore((s) => s.chiefCheckIns);
  const meetings = useStore((s) => s.meetings);
  const chiefChat = useStore((s) => s.chiefChat);
  const approveProposal = useStore((s) => s.approveProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const applyChiefPlan = useStore((s) => s.applyChiefPlan);
  const createMeeting = useStore((s) => s.createMeeting);
  const loadingChat = useStore((s) => s.loading['chiefChat']);
  const loadingApprove = useStore((s) => s.loading['chiefApprove']);
  const loadingApply = useStore((s) => s.loading['chiefApply']);
  const loadingMeeting = useStore((s) => s.loading['createMeeting']);

  const [input, setInput] = useState('');
  const [selectedActionIndices, setSelectedActionIndices] = useState<Set<number>>(new Set());
  const [previewMeetingId, setPreviewMeetingId] = useState<string | null>(null);
  const [savedScrollTop, setSavedScrollTop] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const chainPlans = useStore((s) => s.chainPlans);
  const activeChainPlans = chainPlans.filter(p => p.status !== 'completed' && p.status !== 'cancelled');

  const hasSuggestions = chiefSuggestions.length > 0;
  const hasProposal = chiefProposedActions.length > 0 && chiefPendingMessageId != null;
  const hasExecuted = chiefExecutedActions.length > 0;
  const hasCheckIns = chiefCheckIns.length > 0;
  const hasChainPlans = activeChainPlans.length > 0;

  const suggestionSummary = useMemo(
    () => chiefSuggestions.map((s) => `${ROLE_LABELS[s.role] || s.role} ${s.count}명`).join(', '),
    [chiefSuggestions],
  );

  useEffect(() => {
    if (chiefProposedActions.length > 0) {
      setSelectedActionIndices(new Set(chiefProposedActions.map((_, i) => i)));
    }
  }, [chiefProposedActions]);

  useEffect(() => {
    if (!previewMeetingId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chiefMessages, chiefThinking, chiefCheckIns, previewMeetingId]);

  // Build check-in map for inline rendering
  const checkInByMsgId = useMemo(() => {
    const map = new Map<string, ChiefCheckIn>();
    for (const ci of chiefCheckIns) map.set(ci.id, ci);
    return map;
  }, [chiefCheckIns]);

  const previewMeeting = useMemo(
    () => (previewMeetingId ? meetings.find((m) => m.id === previewMeetingId) || null : null),
    [meetings, previewMeetingId],
  );

  const openMeetingPreview = (meetingId: string) => {
    const currentTop = chatScrollRef.current?.scrollTop ?? 0;
    setSavedScrollTop(currentTop);
    setPreviewMeetingId(meetingId);
  };

  const closeMeetingPreview = () => {
    setPreviewMeetingId(null);
    requestAnimationFrame(() => {
      if (chatScrollRef.current && savedScrollTop != null) {
        chatScrollRef.current.scrollTop = savedScrollTop;
      }
      setSavedScrollTop(null);
    });
  };

  useEffect(() => {
    if (!previewMeetingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMeetingPreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewMeetingId, savedScrollTop]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || chiefThinking) return;
    setInput('');
    await chiefChat(msg);
  };

  // Use form onSubmit to prevent double-send from button click + Enter
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
  };

  const toggleAction = (idx: number) => {
    setSelectedActionIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleApprove = async () => {
    if (!chiefPendingMessageId) return;
    const indices = selectedActionIndices.size === chiefProposedActions.length
      ? undefined : Array.from(selectedActionIndices);
    await approveProposal(chiefPendingMessageId, indices);
  };

  const handleReject = async () => {
    if (!chiefPendingMessageId) return;
    await rejectProposal(chiefPendingMessageId);
  };

  return (
    <div className={`flex-1 min-h-0 flex overflow-hidden ${panel ? 'flex-col' : 'p-4 gap-4'}`}>
      {/* Chat area — main interaction */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${panel ? '' : 'border border-gray-700/40 rounded-xl bg-surface'}`}>
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200 flex items-center gap-2">
          🧠 총괄자 콘솔
          {chiefThinking && <span className="text-xs text-accent animate-pulse">처리 중...</span>}
          {hasCheckIns && <span className="text-xs text-yellow-400">🔔 {chiefCheckIns.length}</span>}
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">
              총괄자에게 자연스럽게 말해보세요. 모든 업무 지시, 결과 확인, 의사결정이 여기서 이루어집니다.
              <div className="mt-3 space-y-1 text-xs text-gray-600">
                <div>💡 예: "웹사이트 만들어줘"</div>
                <div>💡 예: "현재 진행 상황 알려줘"</div>
                <div>💡 예: "PM 2명, 개발자 3명으로 팀 꾸려줘"</div>
              </div>
            </div>
          )}
          {chiefMessages.map((m) => (
            <ChatMessage key={m.id} m={m} checkIn={checkInByMsgId.get(m.id)} onPreviewMeeting={openMeetingPreview} />
          ))}
          {chiefThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        {/* Input — form-based to prevent double-send */}
        <form ref={formRef} onSubmit={handleSubmit} className="p-3 border-t border-gray-700/30 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="총괄자에게 지시하세요..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            disabled={chiefThinking}
          />
          <button type="submit" disabled={!input.trim() || loadingChat || chiefThinking}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loadingChat ? '...' : '전송'}
          </button>
        </form>
      </div>

      {/* Side panel — proposals & actions */}
      <div className={`${panel ? 'border-t border-gray-700/30 p-3 overflow-y-auto space-y-3 max-h-48' : 'w-72 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto space-y-4'} ${!hasSuggestions && !hasProposal && !hasExecuted && !hasChainPlans && panel ? 'hidden' : ''}`}>

        {/* LLM Proposal awaiting approval */}
        {hasProposal && (
          <div>
            <h3 className="text-sm font-semibold text-yellow-300 mb-2">📋 제안 — 승인 대기</h3>
            <p className="text-xs text-gray-400 mb-2">실행할 액션을 선택하세요.</p>
            <div className="space-y-2 mb-3">
              {chiefProposedActions.map((a, idx) => (
                <ActionCard key={idx} action={a} index={idx} selectable
                  selected={selectedActionIndices.has(idx)} onToggle={toggleAction} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleApprove} disabled={selectedActionIndices.size === 0 || loadingApprove}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
                {loadingApprove ? '실행 중...' : `✅ 승인 (${selectedActionIndices.size}건)`}
              </button>
              <button onClick={handleReject}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-semibold">
                ✗
              </button>
            </div>
          </div>
        )}

        {/* Executed actions results */}
        {hasExecuted && (
          <div>
            <h3 className="text-sm font-semibold text-emerald-300 mb-2">⚡ 실행 결과</h3>
            <div className="space-y-2">
              {chiefExecutedActions.map((a, idx) => (
                <ActionCard key={idx} action={a} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* Legacy keyword-mode suggestions */}
        {hasSuggestions && !hasProposal && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">팀 편성 제안</h3>
            <div className="space-y-2 mb-4">
              {chiefSuggestions.map((s, idx) => (
                <div key={`${s.role}-${idx}`} className="flex items-center justify-between text-sm bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2">
                  <span>{ROLE_LABELS[s.role] || s.role}</span>
                  <span className="font-semibold">{s.count}명</span>
                </div>
              ))}
            </div>
            <button onClick={() => applyChiefPlan(chiefSuggestions)} disabled={!hasSuggestions || loadingApply}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
              {loadingApply ? '적용 중...' : '✅ 적용'}
            </button>
            <p className="mt-2 text-xs text-gray-400">{suggestionSummary}</p>
          </div>
        )}

        {chiefMeetingDraft && (
          <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
            <div className="text-sm font-semibold text-indigo-200 mb-1">킥오프 미팅</div>
            <button onClick={() => createMeeting(chiefMeetingDraft.title, chiefMeetingDraft.description, chiefMeetingDraft.participantIds, chiefMeetingDraft.character)}
              disabled={loadingMeeting}
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40">
              {loadingMeeting ? '시작 중...' : '🏛️ 시작'}
            </button>
          </div>
        )}

        {/* Chain Plan Editors */}
        {hasChainPlans && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">🔗 체인 플랜</h3>
            {activeChainPlans.map(plan => (
              <ChainPlanEditor key={plan.id} plan={plan} />
            ))}
          </div>
        )}

        {!hasSuggestions && !hasProposal && !hasExecuted && !hasChainPlans && !panel && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">💡 가이드</h3>
            <div className="text-xs text-gray-400 space-y-2">
              <p>모든 업무가 Chief를 통해 이루어집니다:</p>
              <ul className="list-disc list-inside space-y-1 text-gray-500">
                <li>🗣️ 자연어로 지시 → Chief가 계획 제안</li>
                <li>✅ 결과 완료 → Chief가 알림 + 확정 요청</li>
                <li>⚖️ 미팅 결과 → Chief가 선택지 제시</li>
                <li>🔄 수정 필요 → Chief에게 말하면 재작업</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {previewMeeting && <MeetingResultModal meeting={previewMeeting} onClose={closeMeetingPreview} />}
    </div>
  );
}
