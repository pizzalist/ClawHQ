import { useMemo, useState } from 'react';
import { useStore } from '../store';

const ROLE_LABELS: Record<string, string> = {
  pm: 'PM',
  developer: '개발',
  reviewer: '리뷰어',
  designer: '디자이너',
  devops: 'DevOps',
  qa: 'QA',
};

export default function ChiefConsole() {
  const chiefMessages = useStore((s) => s.chiefMessages);
  const chiefSuggestions = useStore((s) => s.chiefSuggestions);
  const chiefMeetingDraft = useStore((s) => s.chiefMeetingDraft);
  const chiefChat = useStore((s) => s.chiefChat);
  const applyChiefPlan = useStore((s) => s.applyChiefPlan);
  const createMeeting = useStore((s) => s.createMeeting);
  const loadingChat = useStore((s) => s.loading['chiefChat']);
  const loadingApply = useStore((s) => s.loading['chiefApply']);
  const loadingMeeting = useStore((s) => s.loading['createMeeting']);

  const [input, setInput] = useState('');

  const hasSuggestions = chiefSuggestions.length > 0;
  const suggestionSummary = useMemo(
    () => chiefSuggestions.map((s) => `${ROLE_LABELS[s.role] || s.role} ${s.count}명`).join(', '),
    [chiefSuggestions],
  );

  const send = async () => {
    if (!input.trim()) return;
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
      <div className="flex-1 min-w-0 border border-gray-700/40 rounded-xl bg-surface flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/30 text-sm font-semibold text-gray-200">🧠 총괄자 운영 콘솔</div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chiefMessages.length === 0 && (
            <div className="text-sm text-gray-500">총괄자에게 현재 상황이나 목표를 자유롭게 요청해보세요.</div>
          )}
          {chiefMessages.map((m) => (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'ml-auto bg-accent/20 text-accent border border-accent/40' : 'bg-gray-800/70 border border-gray-700/50 text-gray-100'}`}>
              <div className="text-[11px] mb-1 opacity-70">{m.role === 'user' ? '나' : '총괄자'}</div>
              {m.content}
            </div>
          ))}
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
            placeholder="예: 신규 웹서비스 런칭을 위한 팀을 구성해줘"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loadingChat}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loadingChat ? '전송 중...' : '전송'}
          </button>
        </div>
      </div>

      <div className="w-80 shrink-0 border border-gray-700/40 rounded-xl bg-surface p-4 overflow-y-auto">
        <h3 className="text-sm font-semibold text-gray-200 mb-2">팀 편성 제안</h3>
        {hasSuggestions ? (
          <div className="space-y-2 mb-4">
            {chiefSuggestions.map((s, idx) => (
              <div key={`${s.role}-${idx}`} className="flex items-center justify-between text-sm bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2">
                <span>{ROLE_LABELS[s.role] || s.role}</span>
                <span className="font-semibold">{s.count}명</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 mb-4">아직 제안이 없습니다. 왼쪽에서 총괄자와 대화해 주세요.</p>
        )}

        <button
          onClick={apply}
          disabled={!hasSuggestions || loadingApply}
          className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
        >
          {loadingApply ? '적용 중...' : '✅ 제안 적용'}
        </button>

        {hasSuggestions && (
          <p className="mt-3 text-xs text-gray-400">예상 편성: {suggestionSummary}</p>
        )}

        {chiefMeetingDraft && (
          <div className="mt-4 p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
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
      </div>
    </div>
  );
}
