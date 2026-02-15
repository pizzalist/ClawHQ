import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ChiefAction, ChiefCheckIn } from '@ai-office/shared';

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

export default function ChiefConsole() {
  const chiefMessages = useStore((s) => s.chiefMessages);
  const chiefSuggestions = useStore((s) => s.chiefSuggestions);
  const chiefMeetingDraft = useStore((s) => s.chiefMeetingDraft);
  const chiefThinking = useStore((s) => s.chiefThinking);
  const chiefProposedActions = useStore((s) => s.chiefProposedActions);
  const chiefExecutedActions = useStore((s) => s.chiefExecutedActions);
  const chiefPendingMessageId = useStore((s) => s.chiefPendingMessageId);
  const chiefCheckIns = useStore((s) => s.chiefCheckIns);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const hasSuggestions = chiefSuggestions.length > 0;
  const hasProposal = chiefProposedActions.length > 0 && chiefPendingMessageId != null;
  const hasExecuted = chiefExecutedActions.length > 0;
  const hasCheckIns = chiefCheckIns.length > 0;

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chiefMessages, chiefThinking, chiefCheckIns]);

  const send = async () => {
    if (!input.trim() || chiefThinking) return;
    setInput('');
    await chiefChat(input.trim());
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

  // Find which check-in corresponds to which message (by ID match)
  const checkInByMsgId = useMemo(() => {
    const map = new Map<string, ChiefCheckIn>();
    for (const ci of chiefCheckIns) map.set(ci.id, ci);
    return map;
  }, [chiefCheckIns]);

  return (
    <div className="flex-1 min-h-0 p-4 flex gap-4 overflow-hidden">
      {/* Chat area */}
      <div className="flex-1 min-w-0 border border-gray-700/40 rounded-xl bg-surface flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200 flex items-center gap-2">
          🧠 총괄자 운영 콘솔
          {chiefThinking && <span className="text-xs text-accent animate-pulse">처리 중...</span>}
          {hasCheckIns && <span className="text-xs text-yellow-400">🔔 확인 요청 {chiefCheckIns.length}건</span>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">총괄자에게 목표를 말하면 LLM이 팀 구성, 작업, 미팅을 <b>제안</b>합니다. 진행 중에도 매 단계마다 확인을 요청합니다.</div>
          )}
          {chiefMessages.map((m) => {
            const relatedCheckIn = checkInByMsgId.get(m.id);
            return (
              <div key={m.id} className="space-y-2">
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'ml-auto bg-accent/20 text-accent border border-accent/40' : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'}`}>
                  <div className="text-[11px] mb-1 opacity-70">{m.role === 'user' ? '나' : '총괄자'}</div>
                  {m.content}
                </div>
                {/* Inline check-in options right after the message */}
                {relatedCheckIn && (
                  <div className="max-w-[85%]">
                    <CheckInCard checkIn={relatedCheckIn} />
                  </div>
                )}
              </div>
            );
          })}
          {chiefThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-gray-700/30 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="예: 신규 웹서비스 런칭을 위한 팀을 구성해줘"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            disabled={chiefThinking}
          />
          <button onClick={send} disabled={!input.trim() || loadingChat || chiefThinking}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loadingChat ? '전송 중...' : '전송'}
          </button>
        </div>
      </div>

      {/* Side panel */}
      <div className="w-80 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto space-y-4">

        {/* LLM Proposal awaiting approval */}
        {hasProposal && (
          <div>
            <h3 className="text-sm font-semibold text-yellow-300 mb-2">📋 총괄자 제안 — 승인 대기</h3>
            <p className="text-xs text-gray-400 mb-2">실행할 액션을 선택하고 승인하세요.</p>
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
                ✗ 거절
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

        {/* Pending check-ins summary */}
        {hasCheckIns && !hasProposal && (
          <div>
            <h3 className="text-sm font-semibold text-yellow-300 mb-2">🔔 확인 대기 ({chiefCheckIns.length}건)</h3>
            <p className="text-xs text-gray-400 mb-2">채팅에서 각 확인 요청에 응답해주세요.</p>
            <div className="space-y-1">
              {chiefCheckIns.map(ci => {
                const sty = STAGE_STYLES[ci.stage] || STAGE_STYLES.progress;
                return (
                  <div key={ci.id} className={`text-xs px-2 py-1.5 rounded border ${sty.border} ${sty.bg} text-gray-300`}>
                    {sty.icon} {ci.message.split('\n')[0].slice(0, 50)}...
                  </div>
                );
              })}
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
              {loadingApply ? '적용 중...' : '✅ 제안 적용'}
            </button>
            <p className="mt-3 text-xs text-gray-400">예상 편성: {suggestionSummary}</p>
          </div>
        )}

        {chiefMeetingDraft && (
          <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
            <div className="text-sm font-semibold text-indigo-200 mb-1">킥오프 미팅 연결</div>
            <div className="text-xs text-gray-300 mb-3">팀 생성 후 바로 미팅을 시작합니다.</div>
            <button onClick={() => createMeeting(chiefMeetingDraft.title, chiefMeetingDraft.description, chiefMeetingDraft.participantIds, chiefMeetingDraft.character)}
              disabled={loadingMeeting}
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40">
              {loadingMeeting ? '시작 중...' : '🏛️ 킥오프 미팅 시작'}
            </button>
          </div>
        )}

        {!hasSuggestions && !hasProposal && !hasExecuted && !hasCheckIns && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">💡 사용 가이드</h3>
            <div className="text-xs text-gray-400 space-y-2">
              <p>총괄자는 매 단계마다 확인을 요청합니다:</p>
              <ul className="list-disc list-inside space-y-1 text-gray-500">
                <li>📐 <b>계획</b> — 팀 구성과 작업 제안 → 승인</li>
                <li>📊 <b>진행</b> — 작업 완료 보고 → 확인/수정</li>
                <li>⚖️ <b>결정</b> — 대안 제시 → 선택</li>
                <li>🎉 <b>완료</b> — 최종 결과 → 확정</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
