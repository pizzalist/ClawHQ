import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useStore } from '../store';
import type { ChiefAction, ChiefCheckIn, ChiefNotification, ChiefChatMessage, ChiefInlineAction, Meeting } from '@ai-office/shared';
import { MarkdownContent } from '../lib/format/markdown';
import ChainPlanEditor from './ChainPlanEditor';

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
          <div className="text-red-400 text-sm">⚠️ 화면 오류 발생</div>
          <div className="text-xs text-gray-500">{this.state.error}</div>
          <button onClick={() => this.setState({ hasError: false, error: '' })}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs">
            다시 시도
          </button>
          <button onClick={() => window.location.reload()}
            className="px-3 py-1 bg-accent hover:bg-accent/80 text-white rounded text-xs ml-2">
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
        label: '📊 결과 보기',
        title: '회의 결과를 상세히 봅니다 (점수표, 참여자 의견 포함).',
      };
    }
    return {
      label: '📊 결과 보기',
      title: '결과를 확인합니다.',
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

function InlineNotification({ notification, onViewMeetingResult }: { notification: ChiefNotification; onViewMeetingResult: (meetingId: string) => void }) {
  const setSelectedTask = useStore((s) => s.setSelectedTask);
  const [acting, setActing] = useState<string | null>(null);
  const style = NOTIF_STYLES[notification.type] || NOTIF_STYLES.info;

  // Filter: only keep view_result actions; decision buttons removed (use chat instead)
  const viewActions = notification.actions.filter((act) => act.action === 'view_result');

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
                {acting === act.id ? '처리 중...' : copy.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="text-xs text-gray-500 mt-1">
        💬 채팅으로 '확정', '리뷰 시작', '수정 요청' 등을 입력하세요
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

function ChatMessage({ m, checkIn, onViewMeetingResult }: { m: ChiefChatMessage; checkIn?: ChiefCheckIn; onViewMeetingResult: (meetingId: string) => void }) {
  const isUser = m.role === 'user';
  const hasNotification = m.notification != null;

  // Guard: skip rendering empty chief messages (no content and no notification)
  if (!isUser && !(m.content || '').trim() && !hasNotification) return null;

  return (
    <div className="space-y-2">
      {/* For notification messages, only render InlineNotification (avoids duplicate content) */}
      {hasNotification ? (
        <div className="max-w-[85%]">
          <InlineNotification notification={m.notification!} onViewMeetingResult={onViewMeetingResult} />
        </div>
      ) : (
        <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'ml-auto bg-accent/20 text-accent border border-accent/40'
            : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'
        }`}>
          <div className="text-[11px] mb-1 opacity-70">
            {isUser ? '나' : '총괄자'}
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const chainPlans = useStore((s) => s.chainPlans);
  const activeChainPlans = chainPlans.filter(p => p.status !== 'completed' && p.status !== 'cancelled');

  const hasSuggestions = chiefSuggestions.length > 0;
  const hasExecuted = chiefExecutedActions.length > 0;
  const hasCheckIns = chiefCheckIns.length > 0;
  const hasChainPlans = activeChainPlans.length > 0;

  const suggestionSummary = useMemo(
    () => chiefSuggestions.map((s) => `${ROLE_LABELS[s.role] || s.role} ${s.count}명`).join(', '),
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
    // Fetch meeting data and display full result inline in chat
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) throw new Error('Failed to fetch meeting');
      const meeting: Meeting = await res.json();
      const resultText = formatMeetingFullResult(meeting);
      const resultMsg: ChiefChatMessage = {
        id: `meeting-result-${meetingId}-${Date.now()}`,
        role: 'chief',
        content: resultText,
        createdAt: new Date().toISOString(),
      };
      useStore.setState((s) => ({ chiefMessages: [...s.chiefMessages, resultMsg] }));
    } catch {
      const errorMsg: ChiefChatMessage = {
        id: `meeting-result-error-${Date.now()}`,
        role: 'chief',
        content: '⚠️ 회의 결과를 불러올 수 없습니다.',
        createdAt: new Date().toISOString(),
      };
      useStore.setState((s) => ({ chiefMessages: [...s.chiefMessages, errorMsg] }));
    }
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
            <ChatMessage key={m.id} m={m} checkIn={checkInByMsgId.get(m.id)} onViewMeetingResult={handleViewMeetingResult} />
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
          />
          <button type="submit" disabled={!input.trim() || loadingChat}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loadingChat ? '...' : '전송'}
          </button>
        </form>
      </div>

      {/* Side panel — proposals & actions */}
      <div className={`${panel ? 'border-t border-gray-700/30 p-3 overflow-y-auto space-y-3 max-h-48' : 'w-72 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto space-y-4'} ${!hasSuggestions && !hasExecuted && !hasChainPlans && panel ? 'hidden' : ''}`}>

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
        {hasSuggestions && (
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

        {!hasSuggestions && !hasExecuted && !hasChainPlans && !panel && (
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

      {/* MeetingResultModal removed from inline — results now shown in chat */}
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
