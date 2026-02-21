import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { Meeting, MeetingProposal, MeetingCharacter, DecisionPacket } from '@clawhq/shared';
import Spinner from './Spinner';
import { MarkdownContent } from '../lib/format/markdown';
import { useT, t as tStatic } from '../i18n';

const MEETING_CHARACTER_KEYS: Record<MeetingCharacter, string> = {
  brainstorm: 'meetingChar.brainstorm',
  planning: 'meetingChar.planning',
  review: 'meetingChar.review',
  retrospective: 'meetingChar.retrospective',
  kickoff: 'meetingChar.kickoff',
  architecture: 'meetingChar.architecture',
  design: 'meetingChar.design',
  'sprint-planning': 'meetingChar.sprintPlanning',
  estimation: 'meetingChar.estimation',
  demo: 'meetingChar.demo',
  postmortem: 'meetingChar.postmortem',
  'code-review': 'meetingChar.codeReview',
  daily: 'meetingChar.daily',
};

function getMeetingCharLabel(c: MeetingCharacter): string {
  return tStatic(MEETING_CHARACTER_KEYS[c] || 'meetingChar.planning');
}

const ROLE_ICONS: Record<string, string> = {
  pm: '📋', developer: '💻', reviewer: '🔍', designer: '🎨', devops: '🛠️', qa: '🧪',
};

function ContributionCard({ contribution }: { contribution: MeetingProposal }) {
  const [expanded, setExpanded] = useState(false);
  const agents = useStore(s => s.agents);
  const agent = agents.find(a => a.id === contribution.agentId);
  const roleIcon = ROLE_ICONS[agent?.role || ''] || '👤';

  return (
    <div className="p-4 rounded-xl border border-gray-700/50 bg-surface">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{roleIcon}</span>
        <span className="text-sm font-semibold text-gray-200">{contribution.agentName}</span>
        {agent && <span className="text-xs text-gray-500">({agent.role})</span>}
      </div>
      <div className={`text-xs text-gray-300 whitespace-pre-wrap leading-relaxed ${expanded ? '' : 'max-h-48 overflow-hidden'}`}>
        {contribution.content}
      </div>
      {contribution.content.length > 500 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-accent hover:underline mt-1">
          {expanded ? tStatic('meeting.viewLess') : tStatic('meeting.viewMore')}
        </button>
      )}
    </div>
  );
}

function MeetingReport({ report }: { report: string }) {
  return (
    <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
      <h3 className="text-sm font-semibold text-indigo-300 mb-3">{tStatic('meeting.report')}</h3>
      <MarkdownContent text={report} className="text-sm text-gray-200" />
    </div>
  );
}

function ReviewScoringPanel({ meeting, packet }: { meeting: Meeting; packet: DecisionPacket }) {
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const candidateNames = meeting.sourceCandidates?.map(c => c.name) || [];
  const candidateMap = new Map((meeting.sourceCandidates || []).map(c => [c.name, c]));
  const rows = candidateNames.map((name) => {
    const scores = packet.reviewerScoreCards
      .map(card => card.scores.find(s => s.candidateName === name)?.score)
      .filter((v): v is number => typeof v === 'number');
    const total = scores.reduce((a, b) => a + b, 0);
    const avg = scores.length > 0 ? total / scores.length : 0;
    const candidate = candidateMap.get(name);
    return { name, summary: candidate?.summary || '', scores, total, avg };
  }).sort((a, b) => b.avg - a.avg);

  return (
    <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-4">
      <h3 className="text-sm font-semibold text-purple-300">{tStatic('meeting.scoringResult')}</h3>

      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{tStatic('meeting.candidateTable')}</h4>
        <div className="overflow-x-auto rounded-lg border border-gray-700/50">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/70 text-gray-300">
              <tr>
                <th className="text-left px-3 py-2">{tStatic('meeting.candidate')}</th>
                <th className="text-left px-3 py-2">{tStatic('meeting.description')}</th>
                <th className="text-left px-3 py-2">{tStatic('meeting.reviewerScores')}</th>
                <th className="text-right px-3 py-2">{tStatic('meeting.total')}</th>
                <th className="text-right px-3 py-2">{tStatic('meeting.average')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.name} className="border-t border-gray-700/40 text-gray-200">
                    <td className="px-3 py-2 font-medium">
                      <button
                        onClick={() => setExpandedCandidate(expandedCandidate === r.name ? null : r.name)}
                        className="text-left hover:text-accent transition-colors"
                        title="클릭하여 상세 보기"
                      >
                        {r.name} {r.summary ? (expandedCandidate === r.name ? '▾' : '▸') : ''}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate" title={r.summary}>
                      {r.summary ? r.summary.slice(0, 60) + (r.summary.length > 60 ? '...' : '') : '-'}
                    </td>
                    <td className="px-3 py-2">{r.scores.length > 0 ? r.scores.map((s) => s.toFixed(1)).join(' / ') : '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.total.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.avg.toFixed(2)}</td>
                  </tr>
                  {expandedCandidate === r.name && r.summary && (
                    <tr key={`${r.name}-detail`} className="bg-gray-800/30">
                      <td colSpan={5} className="px-4 py-3 text-xs text-gray-300 whitespace-pre-wrap">
                        <span className="text-gray-500 font-semibold">{tStatic('meeting.detail')}</span> {r.summary}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <h4 className="text-xs font-semibold text-emerald-300 uppercase tracking-wider mb-1">{tStatic('meeting.topRecommendation')}</h4>
          <div className="text-sm font-semibold text-emerald-200">{packet.recommendation?.name || '-'}</div>
          <div className="text-xs text-emerald-100/80 mt-1">평균 {Number(packet.recommendation?.score || 0).toFixed(2)}</div>
          {packet.recommendation?.summary && (
            <p className="text-xs text-emerald-100/80 mt-2 whitespace-pre-wrap">{packet.recommendation.summary}</p>
          )}
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1">{tStatic('meeting.alternatives')}</h4>
          {packet.alternatives.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-100/90">
              {packet.alternatives.map((a, i) => (
                <li key={`${a.name}-${i}`}>
                  {i + 1}. {a.name} <span className="opacity-80">(평균 {Number(a.score || 0).toFixed(2)})</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-amber-100/80">{tStatic('meeting.none')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingDetail({ meeting }: { meeting: Meeting }) {
  const agents = useStore(s => s.agents);
  const agentMap = new Map(agents.map(a => [a.id, a]));

  const statusColors: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    reviewing: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-green-500/20 text-green-400',
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">{meeting.title}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[meeting.status] || ''}`}>
          {meeting.status === 'active' ? tStatic('meeting.active') : meeting.status === 'completed' ? tStatic('meeting.completed') : meeting.status}
        </span>
      </div>
      {meeting.description && <p className="text-sm text-gray-400">{meeting.description}</p>}

      <div className="text-xs text-gray-500">
        {tStatic('meeting.participantsList')}: {meeting.participants.map(id => agentMap.get(id)?.name || id).join(', ')}
      </div>
      {meeting.character && (
        <div className="text-xs text-indigo-300">{tStatic('meeting.type')}: {getMeetingCharLabel(meeting.character)}</div>
      )}

      {meeting.status === 'active' && meeting.proposals.length < meeting.participants.length && (
        <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <Spinner />
          <span className="text-sm text-blue-300">
            {tStatic('meeting.collecting')} {meeting.proposals.length}/{meeting.participants.length}
          </span>
        </div>
      )}

      {/* Structured review scoring UI (no markdown table) */}
      {meeting.decisionPacket && meeting.sourceCandidates && meeting.sourceCandidates.length > 0 && (
        <ReviewScoringPanel meeting={meeting} packet={meeting.decisionPacket} />
      )}

      {/* Show consolidated report first if available */}
      {meeting.report && <MeetingReport report={meeting.report} />}

      {/* Individual contributions */}
      {meeting.proposals.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {tStatic('meeting.contributions')} ({meeting.proposals.length})
          </h3>
          <div className="space-y-3">
            {meeting.proposals.map((p, i) => (
              <ContributionCard key={i} contribution={p} />
            ))}
          </div>
        </div>
      )}
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

  const candidates = agents.filter(a => ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'].includes(a.role));

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
        <h2 className="text-lg font-bold mb-4">{tStatic('meeting.newTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{tStatic('meeting.titleLabel')}</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={tStatic('meeting.titlePlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{tStatic('meeting.descLabel')}</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={tStatic('meeting.descPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm h-24 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{tStatic('meeting.characterLabel')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MEETING_CHARACTER_KEYS) as MeetingCharacter[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCharacter(c)}
                  className={`text-left px-3 py-2 text-xs rounded-lg border transition-all ${
                    character === c ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200' : 'border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {getMeetingCharLabel(c)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{tStatic('meeting.selectParticipants')}</label>
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
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">{tStatic('meeting.cancel')}</button>
          <button
            onClick={submit}
            disabled={!title.trim() || selected.length < 2 || loading}
            className="px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-all"
          >
            {loading ? tStatic('meeting.startingMeeting') : tStatic('meeting.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MeetingRoom() {
  const meetings = useStore(s => s.meetings);
  const [showNew, setShowNew] = useState(false);
  const [selectedMeetingId, setLocalSelectedMeetingId] = useState<string | null>(null);
  const storeSelectedMeetingId = useStore(s => s.selectedMeetingId);

  // Allow store to pre-select a meeting (e.g. from "결과 보기" button)
  useEffect(() => {
    if (storeSelectedMeetingId) {
      setLocalSelectedMeetingId(storeSelectedMeetingId);
      useStore.getState().setSelectedMeetingId(null);
    }
  }, [storeSelectedMeetingId]);

  const setSelectedMeetingId = setLocalSelectedMeetingId;
  const selectedMeeting = selectedMeetingId ? meetings.find(m => m.id === selectedMeetingId) : null;

  const statusIcon: Record<string, string> = { active: '🔵', reviewing: '🟡', completed: '🟢' };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/30">
        <h2 className="text-sm font-semibold text-gray-300">{tStatic('meeting.room')}</h2>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-xs font-semibold rounded-lg transition-all"
        >
          {tStatic('meeting.new')}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 border-r border-gray-700/30 overflow-y-auto shrink-0">
          {meetings.length === 0 && (
            <div className="p-4 text-sm text-gray-500 text-center">
              {tStatic('meeting.empty').split('\n')[0]}<br />{tStatic('meeting.empty').split('\n')[1]}
            </div>
          )}
          {meetings.map(m => (
            <div
              key={m.id}
              className={`w-full text-left px-3 py-3 border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors ${
                selectedMeetingId === m.id ? 'bg-gray-700/30' : ''
              }`}
            >
              <button onClick={() => setSelectedMeetingId(m.id)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <span>{statusIcon[m.status] || '⚪'}</span>
                  <span className="text-sm font-medium text-gray-200 truncate">{m.title}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {m.proposals.length} {tStatic('meeting.participants')} · {m.status === 'active' ? tStatic('meeting.active') : m.status === 'completed' ? tStatic('meeting.completed') : m.status}
                </div>
              </button>
              {m.status === 'completed' && (
                <button
                  onClick={() => setSelectedMeetingId(m.id)}
                  className="mt-2 px-2 py-1 text-[11px] rounded border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
                >
                  {tStatic('meeting.viewResult')}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedMeeting ? (
            <MeetingDetail meeting={selectedMeeting} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              {tStatic('meeting.select')}
            </div>
          )}
        </div>
      </div>

      {showNew && <NewMeetingForm onClose={() => setShowNew(false)} />}
    </div>
  );
}
