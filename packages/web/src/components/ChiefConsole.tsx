import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ChiefAction } from '@ai-office/shared';

const ROLE_LABELS: Record<string, string> = {
  pm: 'PM',
  developer: '개발',
  reviewer: '리뷰어',
  designer: '디자이너',
  devops: 'DevOps',
  qa: 'QA',
};

const ACTION_ICONS: Record<string, string> = {
  create_task: '📋',
  create_agent: '🤖',
  start_meeting: '🏛️',
  assign_task: '🔗',
};

function ActionCard({ action }: { action: ChiefAction }) {
  const ok = action.result?.ok;
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${ok ? 'bg-emerald-500/10 border-emerald-500/30' : ok === false ? 'bg-red-500/10 border-red-500/30' : 'bg-gray-800/50 border-gray-700/40'}`}>
      <span className="text-base">{ACTION_ICONS[action.type] || '⚡'}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-200">{action.type.replace(/_/g, ' ')}</div>
        <div className="text-gray-400 truncate">
          {Object.entries(action.params).map(([k, v]) => `${k}: ${v}`).join(' | ')}
        </div>
        {action.result && (
          <div className={`mt-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {ok ? '✓' : '✗'} {action.result.message}
          </div>
        )}
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
  const chiefActions = useStore((s) => s.chiefActions);
  const chiefChat = useStore((s) => s.chiefChat);
  const applyChiefPlan = useStore((s) => s.applyChiefPlan);
  const createMeeting = useStore((s) => s.createMeeting);
  const loadingChat = useStore((s) => s.loading['chiefChat']);
  const loadingApply = useStore((s) => s.loading['chiefApply']);
  const loadingMeeting = useStore((s) => s.loading['createMeeting']);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const hasSuggestions = chiefSuggestions.length > 0;
  const suggestionSummary = useMemo(
    () => chiefSuggestions.map((s) => `${ROLE_LABELS[s.role] || s.role} ${s.count}명`).join(', '),
    [chiefSuggestions],
  );

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chiefMessages, chiefThinking, chiefActions]);

  const send = async () => {
    if (!input.trim() || chiefThinking) return;
    const message = input.trim();
    setInput('');
    await chiefChat(message);
  };

  const apply = async () => {
    if (!hasSuggestions) return;
    await applyChiefPlan(chiefSuggestions);
  };

  const startKickoffMeeting = async () => {
    if (!chiefMeetingDraft || chiefMeetingDraft.participantIds.length < 2) return;
    await createMeeting(
      chiefMeetingDraft.title,
      chiefMeetingDraft.description,
      chiefMeetingDraft.participantIds,
      chiefMeetingDraft.character,
    );
  };

  return (
    <div className="flex-1 min-h-0 p-4 flex gap-4 overflow-hidden">
      {/* Chat area */}
      <div className="flex-1 min-w-0 border border-gray-700/40 rounded-xl bg-surface flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200 flex items-center gap-2">
          🧠 총괄자 운영 콘솔
          {chiefThinking && <span className="text-xs text-accent animate-pulse">처리 중...</span>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">총괄자에게 현재 상황이나 목표를 자유롭게 요청해보세요. LLM이 직접 팀 구성, 작업 생성, 미팅을 시작합니다.</div>
          )}
          {chiefMessages.map((m) => (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'ml-auto bg-accent/20 text-accent border border-accent/40' : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'}`}>
              <div className="text-[11px] mb-1 opacity-70">{m.role === 'user' ? '나' : '총괄자'}</div>
              {m.content}
            </div>
          ))}
          {chiefThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-gray-700/30 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="예: 신규 웹서비스 런칭을 위한 팀을 구성하고 킥오프 미팅 시작해줘"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            disabled={chiefThinking}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loadingChat || chiefThinking}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loadingChat ? '전송 중...' : '전송'}
          </button>
        </div>
      </div>

      {/* Side panel */}
      <div className="w-80 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto space-y-4">
        {/* Executed Actions */}
        {chiefActions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">⚡ 실행된 액션</h3>
            <div className="space-y-2">
              {chiefActions.map((a, idx) => (
                <ActionCard key={idx} action={a} />
              ))}
            </div>
          </div>
        )}

        {/* Legacy suggestions panel (for demo/keyword mode) */}
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
            <button
              onClick={apply}
              disabled={!hasSuggestions || loadingApply}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
            >
              {loadingApply ? '적용 중...' : '✅ 제안 적용'}
            </button>
            <p className="mt-3 text-xs text-gray-400">예상 편성: {suggestionSummary}</p>
          </div>
        )}

        {chiefMeetingDraft && (
          <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
            <div className="text-sm font-semibold text-indigo-200 mb-1">킥오프 미팅 연결</div>
            <div className="text-xs text-gray-300 mb-3">팀 생성 후 바로 미팅을 시작해 초기 실행 계획을 정렬할 수 있습니다.</div>
            <button
              onClick={startKickoffMeeting}
              disabled={loadingMeeting}
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40"
            >
              {loadingMeeting ? '시작 중...' : '🏛️ 킥오프 미팅 시작'}
            </button>
          </div>
        )}

        {!hasSuggestions && chiefActions.length === 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-2">💡 사용 가이드</h3>
            <div className="text-xs text-gray-400 space-y-2">
              <p>총괄자에게 자연어로 지시하면 자동으로 실행합니다:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>"PM 1명, 개발자 2명으로 팀 구성해줘"</li>
                <li>"경쟁사 분석 작업 만들어줘"</li>
                <li>"킥오프 미팅 시작해"</li>
                <li>"현재 상황 보고해줘"</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
