import { useState } from 'react';
import { useStore } from '../store';
import type { Meeting, MeetingProposal, MeetingReview } from '@ai-office/shared';
import Spinner from './Spinner';

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
      {review.pros.length > 0 && (
        <div className="mb-1">
          {review.pros.map((p, i) => (
            <div key={i} className="text-xs text-green-400/80 flex items-start gap-1">
              <span>✅</span><span>{p}</span>
            </div>
          ))}
        </div>
      )}
      {review.cons.length > 0 && (
        <div className="mb-1">
          {review.cons.map((c, i) => (
            <div key={i} className="text-xs text-red-400/80 flex items-start gap-1">
              <span>❌</span><span>{c}</span>
            </div>
          ))}
        </div>
      )}
      {review.risks.length > 0 && (
        <div>
          {review.risks.map((r, i) => (
            <div key={i} className="text-xs text-yellow-400/80 flex items-start gap-1">
              <span>⚠️</span><span>{r}</span>
            </div>
          ))}
        </div>
      )}
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
          ✅ Choose This Proposal
        </button>
      )}
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
      {meeting.description && <p className="text-sm text-gray-400 mb-4">{meeting.description}</p>}

      <div className="text-xs text-gray-500 mb-3">
        Participants: {meeting.participants.map(id => agentMap.get(id)?.name || id).join(', ')}
      </div>

      {meeting.status === 'active' && meeting.proposals.length < meeting.participants.length && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <Spinner />
          <span className="text-sm text-blue-300">
            Generating proposals... {meeting.proposals.length}/{meeting.participants.length} complete
          </span>
        </div>
      )}

      {meeting.status === 'reviewing' && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <Spinner />
          <span className="text-sm text-yellow-300">Reviews in progress...</span>
        </div>
      )}

      {meeting.status === 'completed' && !meeting.decision && (
        <div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
          <span className="text-sm text-accent font-semibold">🗳️ Proposals ready! Choose the best one below.</span>
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

  const pmAgents = agents.filter(a => a.role === 'pm' || a.role === 'developer' || a.role === 'designer');

  const toggle = (id: string) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const submit = async () => {
    if (!title.trim() || selected.length < 2) return;
    await createMeeting(title, description, selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-gray-700/50 rounded-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">🏛️ New Planning Meeting</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q1 Product Strategy"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe what proposals should cover..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm h-24 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Select Participants (min 2)</label>
            <div className="flex flex-wrap gap-2">
              {pmAgents.map(a => (
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
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button
            onClick={submit}
            disabled={!title.trim() || selected.length < 2 || loading}
            className="px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-all"
          >
            {loading ? 'Starting...' : '🚀 Start Meeting'}
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
        <h2 className="text-sm font-semibold text-gray-300">🏛️ Meetings</h2>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-xs font-semibold rounded-lg transition-all"
        >
          + New Meeting
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Meeting list */}
        <div className="w-64 border-r border-gray-700/30 overflow-y-auto shrink-0">
          {meetings.length === 0 && (
            <div className="p-4 text-sm text-gray-500 text-center">
              No meetings yet.<br />Start one to get proposals!
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
                {m.status === 'completed' && !m.decision && ' · ⚡ Needs decision'}
              </div>
            </button>
          ))}
        </div>

        {/* Meeting detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedMeeting ? (
            <MeetingDetail meeting={selectedMeeting} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Select a meeting or create a new one
            </div>
          )}
        </div>
      </div>

      {showNew && <NewMeetingForm onClose={() => setShowNew(false)} />}
    </div>
  );
}
