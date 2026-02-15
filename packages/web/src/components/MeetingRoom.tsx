import { useState } from 'react';
import { useStore } from '../store';
import type { Meeting, MeetingProposal, MeetingReview, MeetingCharacter } from '@ai-office/shared';
import Spinner from './Spinner';

const MEETING_CHARACTER_LABELS: Record<MeetingCharacter, string> = {
  brainstorm: '🧠 브레인스토밍 (자유 토론)',
  planning: '📋 기획 회의',
  review: '🔍 검토 회의',
  retrospective: '🔄 회고',
};

function ReviewCard({ review }: { review: MeetingReview }) {
  return (
    <div className={`mt-2 p-3 rounded-lg border ${review.isDevilsAdvocate ? 'border-red-500/40 bg-red-500/5' : 'border-gray-600/40 bg-gray-800/30'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium">
          {review.isDevilsAdvocate ? '😈 깐깐이' : '🔍'} {review.reviewerName}
        </span>
        <span className={`ml-auto text-lg font-bold ${review.score >= 7 ? 'text-green-400' : review.score >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>
          {review.score}/10
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-2">{review.summary}</p>
      {review.pros.length > 0 && review.pros.map((p, i) => (
        <div key={`pro-${i}`} className="text-xs text-green-400/80 flex items-start gap-1">
          <span>✅</span><span>{p}</span>
        </div>
      ))}
      {review.cons.length > 0 && review.cons.map((c, i) => (
        <div key={`con-${i}`} className="text-xs text-red-400/80 flex items-start gap-1">
          <span>❌</span><span>{c}</span>
        </div>
      ))}
      {review.risks.length > 0 && review.risks.map((r, i) => (
        <div key={`risk-${i}`} className="text-xs text-yellow-400/80 flex items-start gap-1">
          <span>⚠️</span><span>{r}</span>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({ proposal, meeting, onChoose }: { proposal: MeetingProposal; meeting: Meeting; onChoose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const avgScore = proposal.reviews && proposal.reviews.length > 0
    ? (proposal.reviews.reduce((s, r) => s + r.score, 0) / proposal.reviews.length).toFixed(1)
    : null;
  const isWinner = meeting.decision?.winnerId === proposal.agentId;

  return (
    <div className={`flex-1 min-w-[300px] p-4 rounded-xl border transition-all ${
      isWinner ? 'border-green-500/60 bg-green-500/10 ring-2 ring-green-500/30' : 'border-gray-700/50 bg-surface'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-gray-200">{proposal.agentName}</span>
          {avgScore && (
            <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full ${
              parseFloat(avgScore) >= 7 ? 'bg-green-500/20 text-green-400' :
              parseFloat(avgScore) >= 4 ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              Avg: {avgScore}
            </span>
          )}
        </div>
        {isWinner && <span className="text-green-400 text-sm font-bold">🏆 Winner</span>}
      </div>

      <div className={`text-xs text-gray-300 whitespace-pre-wrap ${expanded ? '' : 'max-h-48 overflow-hidden'}`}>
        {proposal.content}
      </div>
      {proposal.content.length > 500 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-accent hover:underline mt-1">
          {expanded ? 'Show less' : 'Show more...'}
        </button>
      )}

      {proposal.reviews && proposal.reviews.length > 0 && (
        <div className="mt-3 border-t border-gray-700/30 pt-2">
          <div className="text-xs font-semibold text-gray-400 mb-1">Reviews</div>
          {proposal.reviews.map((r, i) => <ReviewCard key={i} review={r} />)}
        </div>
      )}

      {meeting.status === 'completed' && !meeting.decision && (
        <button
          onClick={onChoose}
          className="mt-3 w-full py-2 bg-accent hover:bg-accent/80 text-white text-sm font-bold rounded-lg transition-all hover:scale-[1.02] active:scale-95"
        >
          ✅ 이 제안 채택
        </button>
      )}
    </div>
  );
}

function MeetingReport({ report }: { report: string }) {
  return (
    <div className="mt-5 p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
      <h3 className="text-sm font-semibold text-indigo-300 mb-2">📝 회의 결과 보고서</h3>
      <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">{report}</pre>
    </div>
  );
}

function MeetingDetail({ meeting }: { meeting: Meeting }) {
  const decideMeeting = useStore(s => s.decideMeeting);
  const agents = useStore(s => s.agents);
  const agentMap = new Map(agents.map(a => [a.id, a]));

  const statusColors: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    reviewing: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-green-500/20 text-green-400',
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold">{meeting.title}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[meeting.status] || ''}`}>
          {meeting.status}
        </span>
      </div>
      {meeting.description && <p className="text-sm text-gray-400 mb-3">{meeting.description}</p>}

      <div className="text-xs text-gray-500 mb-2">
        참가자: {meeting.participants.map(id => agentMap.get(id)?.name || id).join(', ')}
      </div>
      {meeting.character && (
        <div className="text-xs text-indigo-300 mb-3">유형: {MEETING_CHARACTER_LABELS[meeting.character]}</div>
      )}

      {meeting.status === 'active' && meeting.proposals.length < meeting.participants.length && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <Spinner />
          <span className="text-sm text-blue-300">
            제안서 생성 중... {meeting.proposals.length}/{meeting.participants.length}
          </span>
        </div>
      )}

      {meeting.status === 'reviewing' && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <Spinner />
          <span className="text-sm text-yellow-300">리뷰 진행 중...</span>
        </div>
      )}

      {meeting.status === 'completed' && !meeting.decision && (
        <div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
          <span className="text-sm text-accent font-semibold">🗳️ 제안서가 준비됐어요! 아래에서 채택해 주세요.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {meeting.proposals.map((p, i) => (
          <ProposalCard
            key={i}
            proposal={p}
            meeting={meeting}
            onChoose={() => decideMeeting(meeting.id, p.agentId, '')}
          />
        ))}
      </div>

      {meeting.report && <MeetingReport report={meeting.report} />}
    </div>
  );
}

function NewMeetingForm({ onClose }: { onClose: () => void }) {
  const agents = useStore(s => s.agents);
  const createMeeting = useStore(s => s.createMeeting);
  const loading = useStore(s => s.loading['createMeeting']);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [character, setCharacter] = useState<MeetingCharacter>('planning');

  const candidates = agents.filter(a => a.role === 'pm' || a.role === 'reviewer' || a.role === 'developer' || a.role === 'designer');

  const toggle = (id: string) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const submit = async () => {
    if (!title.trim() || selected.length < 2) return;
    await createMeeting(title, description, selected, character);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-gray-700/50 rounded-xl p-6 w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">🏛️ 새 미팅 시작</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">회의 제목</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="예: 신규 프로젝트 기획 회의"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">안건 / 설명</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="회의에서 다룰 내용을 적어주세요"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm h-24 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">회의 성격 (사용자 확인)</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MEETING_CHARACTER_LABELS) as MeetingCharacter[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCharacter(c)}
                  className={`text-left px-3 py-2 text-xs rounded-lg border transition-all ${
                    character === c ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200' : 'border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {MEETING_CHARACTER_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">참가자 선택 (최소 2명)</label>
            <div className="flex flex-wrap gap-2">
              {candidates.map(a => (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    selected.includes(a.id)
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {a.name} ({a.role})
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">취소</button>
          <button
            onClick={submit}
            disabled={!title.trim() || selected.length < 2 || loading}
            className="px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-all"
          >
            {loading ? '시작 중...' : '🚀 회의 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MeetingRoom() {
  const meetings = useStore(s => s.meetings);
  const [showNew, setShowNew] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const selectedMeeting = selectedMeetingId ? meetings.find(m => m.id === selectedMeetingId) : null;

  const statusIcon: Record<string, string> = { active: '🔵', reviewing: '🟡', completed: '🟢' };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/30">
        <h2 className="text-sm font-semibold text-gray-300">🏛️ 미팅 룸</h2>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-xs font-semibold rounded-lg transition-all"
        >
          + 새 미팅
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 border-r border-gray-700/30 overflow-y-auto shrink-0">
          {meetings.length === 0 && (
            <div className="p-4 text-sm text-gray-500 text-center">
              아직 미팅이 없어요.<br />새 미팅을 시작해보세요.
            </div>
          )}
          {meetings.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedMeetingId(m.id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors ${
                selectedMeetingId === m.id ? 'bg-gray-700/30' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{statusIcon[m.status] || '⚪'}</span>
                <span className="text-sm font-medium text-gray-200 truncate">{m.title}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {m.proposals.length} proposals · {m.status}
                {m.status === 'completed' && !m.decision && ' · ⚡ 결정 필요'}
              </div>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedMeeting ? (
            <MeetingDetail meeting={selectedMeeting} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              미팅을 선택하거나 새로 시작하세요
            </div>
          )}
        </div>
      </div>

      {showNew && <NewMeetingForm onClose={() => setShowNew(false)} />}
    </div>
  );
}
