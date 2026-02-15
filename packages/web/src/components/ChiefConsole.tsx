import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ChiefAction, ChiefCheckIn, ChiefNotification, ChiefChatMessage } from '@ai-office/shared';

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

/** Compact inline display of a proposed action */
function InlineActionBadge({ action }: { action: ChiefAction }) {
  const hasResult = action.result != null;
  const ok = action.result?.ok;

  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${
      hasResult
        ? ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'
        : 'border-gray-700/40 bg-gray-800/50'
    }`}>
      <span>{ACTION_ICONS[action.type] || '⚡'}</span>
      <span className="font-medium text-gray-200">{ACTION_LABELS[action.type] || action.type}</span>
      <span className="text-gray-500">
        {Object.entries(action.params).map(([k, v]) => `${k}=${v}`).join(' ')}
      </span>
      {hasResult && (
        <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
          {ok ? '✓' : '✗'} {action.result!.message}
        </span>
      )}
    </div>
  );
}

function InlineNotification({ notification }: { notification: ChiefNotification }) {
  const handleAction = useStore((s) => s.handleChiefInlineAction);
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [acting, setActing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const style = NOTIF_STYLES[notification.type] || NOTIF_STYLES.info;

  if (dismissed) {
    return (
      <div className={`rounded-lg border ${style.border} ${style.bg} px-3 py-1.5 opacity-50`}>
        <span className="text-xs text-gray-400">✓ 처리됨</span>
      </div>
    );
  }

  const onAction = async (actionId: string, action: string, params: Record<string, string>) => {
    setActing(actionId);
    if (action === 'view_result' && params.taskId) {
      setSelectedTask(params.taskId);
      setActing(null);
      return;
    }
    await handleAction(notification.id, actionId, params);
    setActing(null);
    if (action !== 'view_result') {
      setDismissed(true);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {notification.actions.map((act) => (
        <button
          key={act.id}
          onClick={() => onAction(act.id, act.action, act.params)}
          disabled={acting !== null}
          className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-xs text-gray-200 disabled:opacity-40 transition-colors"
        >
          {acting === act.id ? '처리 중...' : act.label}
        </button>
      ))}
    </div>
  );
}

function CheckInCard({ checkIn }: { checkIn: ChiefCheckIn }) {
  const respondToCheckIn = useStore((s) => s.respondToCheckIn);
  const dismissCheckIn = useStore((s) => s.dismissCheckIn);
  const [comment, setComment] = useState('');
  const [responding, setResponding] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const style = STAGE_STYLES[checkIn.stage] || STAGE_STYLES.progress;

  if (dismissed) {
    return (
      <div className={`rounded-lg border ${style.border} ${style.bg} px-3 py-1.5 opacity-50`}>
        <span className="text-xs text-gray-400">✓ 처리됨</span>
      </div>
    );
  }

  const handleOption = async (optionId: string) => {
    setResponding(true);
    await respondToCheckIn(checkIn.id, optionId, comment || undefined);
    setResponding(false);
    setDismissed(true);
  };

  return (
    <div className="mt-1 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {checkIn.options?.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleOption(opt.id)}
            disabled={responding}
            className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-xs text-gray-200 disabled:opacity-40 transition-colors"
            title={opt.description}
          >
            {opt.label}
          </button>
        ))}
        <button onClick={() => { dismissCheckIn(checkIn.id); setDismissed(true); }}
          className="px-2 py-1.5 text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>
      <div className="flex gap-1.5">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="추가 의견..."
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

/** Inline proposed actions with approve/reject buttons, shown inside chat */
function InlineProposal({ actions, messageId }: { actions: ChiefAction[]; messageId: string }) {
  const approveProposal = useStore((s) => s.approveProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const loadingApprove = useStore((s) => s.loading['chiefApprove']);
  const [handled, setHandled] = useState(false);

  if (handled) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 opacity-60 mt-2">
        <span className="text-xs text-emerald-400">✓ 승인 완료</span>
      </div>
    );
  }

  const handleApprove = async () => {
    await approveProposal(messageId);
    setHandled(true);
  };

  const handleReject = async () => {
    await rejectProposal(messageId);
    setHandled(true);
  };

  return (
    <div className="mt-2 space-y-1.5">
      <div className="space-y-1">
        {actions.map((a, i) => <InlineActionBadge key={i} action={a} />)}
      </div>
      <div className="flex gap-1.5">
        <button onClick={handleApprove} disabled={loadingApprove}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors">
          {loadingApprove ? '실행 중...' : `✅ 승인 (${actions.length}건)`}
        </button>
        <button onClick={handleReject}
          className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold transition-colors">
          ✗ 거절
        </button>
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

function ChatMessage({ m, checkIn, proposedActions, pendingMessageId }: {
  m: ChiefChatMessage;
  checkIn?: ChiefCheckIn;
  proposedActions?: ChiefAction[];
  pendingMessageId?: string | null;
}) {
  const isUser = m.role === 'user';
  const hasNotification = m.notification != null;
  const notifStyle = hasNotification ? NOTIF_STYLES[m.notification!.type] || NOTIF_STYLES.info : null;
  const hasProposal = proposedActions && proposedActions.length > 0 && pendingMessageId === m.id;

  return (
    <div className="space-y-1">
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
        {m.content}
        {/* Inline notification action buttons */}
        {hasNotification && m.notification!.actions.length > 0 && (
          <InlineNotification notification={m.notification!} />
        )}
        {/* Inline check-in options */}
        {checkIn && <CheckInCard checkIn={checkIn} />}
        {/* Inline proposed actions with approve/reject */}
        {hasProposal && <InlineProposal actions={proposedActions!} messageId={pendingMessageId!} />}
      </div>
    </div>
  );
}

export default function ChiefConsole() {
  const chiefMessages = useStore((s) => s.chiefMessages);
  const chiefThinking = useStore((s) => s.chiefThinking);
  const chiefProposedActions = useStore((s) => s.chiefProposedActions);
  const chiefPendingMessageId = useStore((s) => s.chiefPendingMessageId);
  const chiefCheckIns = useStore((s) => s.chiefCheckIns);
  const chiefChat = useStore((s) => s.chiefChat);
  const loadingChat = useStore((s) => s.loading['chiefChat']);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const hasCheckIns = chiefCheckIns.length > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chiefMessages, chiefThinking, chiefCheckIns]);

  const checkInByMsgId = useMemo(() => {
    const map = new Map<string, ChiefCheckIn>();
    for (const ci of chiefCheckIns) map.set(ci.id, ci);
    return map;
  }, [chiefCheckIns]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || chiefThinking) return;
    setInput('');
    await chiefChat(msg);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
  };

  return (
    <div className="flex-1 min-h-0 p-4 overflow-hidden">
      <div className="h-full border border-gray-700/40 rounded-xl bg-surface flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200 flex items-center gap-2">
          🧠 총괄자 콘솔
          {chiefThinking && <span className="text-xs text-accent animate-pulse">처리 중...</span>}
          {hasCheckIns && <span className="text-xs text-yellow-400">🔔 {chiefCheckIns.length}</span>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">
              총괄자에게 자연스럽게 말해보세요. 모든 업무 지시, 결과 확인, 의사결정이 여기서 이루어집니다.
              <div className="mt-3 space-y-1 text-xs text-gray-600">
                <div>💡 예: &quot;웹사이트 만들어줘&quot;</div>
                <div>💡 예: &quot;현재 진행 상황 알려줘&quot;</div>
                <div>💡 예: &quot;PM 2명, 개발자 3명으로 팀 꾸려줘&quot;</div>
              </div>
            </div>
          )}
          {chiefMessages.map((m) => (
            <ChatMessage
              key={m.id}
              m={m}
              checkIn={checkInByMsgId.get(m.id)}
              proposedActions={chiefProposedActions}
              pendingMessageId={chiefPendingMessageId}
            />
          ))}
          {chiefThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="p-3 border-t border-gray-700/30 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="총괄자에게 지시하세요... (승인: 응/ㅇ/확인)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            disabled={chiefThinking}
          />
          <button type="submit" disabled={!input.trim() || loadingChat || chiefThinking}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loadingChat ? '...' : '전송'}
          </button>
        </form>
      </div>
    </div>
  );
}
