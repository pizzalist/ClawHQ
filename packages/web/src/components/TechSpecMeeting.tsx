/**
 * TechSpecMeeting — 4-panel tech spec discussion UI
 *
 * Shows each role's contribution in a color-coded panel,
 * highlights conflicts, and displays the synthesized spec.
 */

import { useState } from 'react';
import type { Meeting, TechSpecMeetingData, TechSpecRole, TechSpecConflict } from '@ai-office/shared';
import { TECH_SPEC_ROLES } from '@ai-office/shared';
import Spinner from './Spinner';

interface Props {
  meeting: Meeting;
  onApprove?: (meetingId: string) => void;
  onRequestChanges?: (meetingId: string, role: TechSpecRole) => void;
  onReject?: (meetingId: string) => void;
}

const ROLE_ORDER: TechSpecRole[] = ['cto', 'frontend-lead', 'backend-lead', 'qa-devils-advocate'];

export default function TechSpecMeeting({ meeting, onApprove, onRequestChanges, onReject }: Props) {
  const [expandedRole, setExpandedRole] = useState<TechSpecRole | null>(null);
  const [showSynthesis, setShowSynthesis] = useState(false);

  // Parse tech spec data from meeting proposals
  const techSpec = meeting.techSpec || parseTechSpec(meeting);

  if (!techSpec) {
    return (
      <div className="p-6 text-center text-gray-400">
        <p>No tech spec data available for this meeting.</p>
      </div>
    );
  }

  const completedCount = techSpec.participants.filter(p => p.status === 'done').length;
  const totalCount = techSpec.participants.length;
  const allDone = completedCount === totalCount;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            📐 Tech Spec: {meeting.title}
          </h2>
          <p className="text-sm text-gray-400 mt-1">{meeting.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={meeting.status} />
          <span className="text-xs text-gray-500">
            {completedCount}/{totalCount} specs complete
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-700/30 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-accent transition-all duration-500"
          style={{ width: `${(completedCount / Math.max(totalCount, 1)) * 100}%` }}
        />
      </div>

      {/* 4-Panel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ROLE_ORDER.map(role => {
          const participant = techSpec.participants.find(p => p.role === role);
          const config = TECH_SPEC_ROLES[role];
          const isExpanded = expandedRole === role;

          return (
            <div
              key={role}
              className="rounded-lg border overflow-hidden transition-all duration-200 cursor-pointer hover:shadow-lg"
              style={{
                borderColor: `${config.color}40`,
                background: `linear-gradient(135deg, ${config.color}08, transparent)`,
              }}
              onClick={() => setExpandedRole(isExpanded ? null : role)}
            >
              {/* Panel Header */}
              <div
                className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: `${config.color}30`, backgroundColor: `${config.color}15` }}
              >
                <span className="text-lg">{config.emoji}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-white">{config.label}</span>
                  {participant && (
                    <span className="text-xs text-gray-400 ml-2">({participant.agentName})</span>
                  )}
                </div>
                <ParticipantStatus status={participant?.status || 'pending'} color={config.color} />
              </div>

              {/* Panel Content */}
              <div className={`px-3 py-2 ${isExpanded ? 'max-h-[600px]' : 'max-h-32'} overflow-y-auto transition-all duration-300`}>
                {participant?.status === 'working' && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-4 justify-center">
                    <Spinner size={16} /> Generating spec...
                  </div>
                )}
                {participant?.status === 'pending' && (
                  <p className="text-gray-500 text-sm py-4 text-center">Waiting to start...</p>
                )}
                {participant?.status === 'error' && (
                  <p className="text-red-400 text-sm py-2">{participant.spec || 'Error generating spec'}</p>
                )}
                {participant?.status === 'done' && participant.spec && (
                  <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {isExpanded ? participant.spec : truncate(participant.spec, 200)}
                    {!isExpanded && participant.spec.length > 200 && (
                      <span className="text-accent text-xs ml-1">Click to expand ↓</span>
                    )}
                  </div>
                )}
              </div>

              {/* Re-run button */}
              {participant?.status === 'done' && onRequestChanges && meeting.status === 'completed' && (
                <div className="px-3 pb-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRequestChanges(meeting.id, role); }}
                    className="text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 transition-colors"
                  >
                    🔄 Re-run
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Conflicts Section */}
      {techSpec.conflicts.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
          <h3 className="text-sm font-semibold text-yellow-400 flex items-center gap-1 mb-2">
            ⚡ Conflicts Detected ({techSpec.conflicts.length})
          </h3>
          <div className="space-y-2">
            {techSpec.conflicts.map((conflict, i) => (
              <ConflictRow key={i} conflict={conflict} />
            ))}
          </div>
        </div>
      )}

      {/* Synthesis Section */}
      {allDone && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-accent flex items-center gap-1">
              🔗 Unified Specification
            </h3>
            {techSpec.synthesisStatus === 'done' && techSpec.synthesis && (
              <button
                onClick={() => setShowSynthesis(!showSynthesis)}
                className="text-xs text-accent/80 hover:text-accent"
              >
                {showSynthesis ? 'Collapse' : 'Expand'}
              </button>
            )}
          </div>

          {techSpec.synthesisStatus === 'pending' && (
            <p className="text-gray-500 text-sm">Waiting for all specs to complete...</p>
          )}
          {techSpec.synthesisStatus === 'working' && (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Spinner size={14} /> CTO is synthesizing specs...
            </div>
          )}
          {techSpec.synthesisStatus === 'done' && techSpec.synthesis && (
            <div className={`text-sm text-gray-300 whitespace-pre-wrap leading-relaxed ${showSynthesis ? '' : 'max-h-40 overflow-hidden'}`}>
              {techSpec.synthesis}
              {!showSynthesis && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#0f0f1a] to-transparent" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Decision Actions */}
      {meeting.status === 'completed' && techSpec.synthesisStatus === 'done' && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-700/30">
          <span className="text-xs text-gray-500 mr-auto">Final Decision:</span>
          {onApprove && (
            <button
              onClick={() => onApprove(meeting.id)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
            >
              ✅ Approve Spec
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(meeting.id)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
            >
              ❌ Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    reviewing: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-green-500/20 text-green-400',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[status] || 'bg-gray-700 text-gray-400'}`}>
      {status}
    </span>
  );
}

function ParticipantStatus({ status, color }: { status: string; color: string }) {
  if (status === 'working') return <Spinner size={14} />;
  if (status === 'done') return <span className="text-xs" style={{ color }}>✓</span>;
  if (status === 'error') return <span className="text-xs text-red-400">✗</span>;
  return <span className="text-xs text-gray-600">○</span>;
}

function ConflictRow({ conflict }: { conflict: TechSpecConflict }) {
  return (
    <div className="text-xs">
      <span className="text-yellow-300 font-medium">{conflict.topic}:</span>
      <div className="flex flex-wrap gap-2 mt-1">
        {conflict.positions.map((pos, i) => {
          const config = TECH_SPEC_ROLES[pos.role];
          return (
            <span
              key={i}
              className="px-2 py-0.5 rounded-full text-[10px]"
              style={{ backgroundColor: `${config.color}20`, color: config.color }}
            >
              {config.emoji} {pos.stance}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---- Utilities ----

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Parse tech spec data from the proposals field envelope.
 */
function parseTechSpec(meeting: Meeting): TechSpecMeetingData | null {
  if (meeting.techSpec) return meeting.techSpec;
  // Try parsing from proposals array (which may contain our envelope)
  const proposals = meeting.proposals as any;
  if (proposals && typeof proposals === 'object' && '_techSpec' in proposals) {
    return proposals._techSpec as TechSpecMeetingData;
  }
  return null;
}
