import { useState } from 'react';
import { useStore } from '../store';
import type { ChainPlan, ChainStep, AgentRole } from '@ai-office/shared';

const ROLE_OPTIONS: Array<{ value: AgentRole; label: string; emoji: string }> = [
  { value: 'pm', label: 'PM (기획)', emoji: '📋' },
  { value: 'developer', label: '개발', emoji: '💻' },
  { value: 'reviewer', label: '리뷰', emoji: '🔍' },
  { value: 'designer', label: '디자인', emoji: '🎨' },
  { value: 'devops', label: 'DevOps', emoji: '🔧' },
  { value: 'qa', label: 'QA', emoji: '🧪' },
];

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  proposed: { bg: 'border-yellow-500/40 bg-yellow-500/10', label: '📝 제안됨 — 편집 가능' },
  confirmed: { bg: 'border-blue-500/40 bg-blue-500/10', label: '✅ 확정됨' },
  running: { bg: 'border-cyan-500/40 bg-cyan-500/10', label: '⚡ 실행 중' },
  completed: { bg: 'border-green-500/40 bg-green-500/10', label: '🎉 완료' },
  cancelled: { bg: 'border-gray-500/40 bg-gray-500/10', label: '🚫 취소됨' },
};

function StepRow({
  step, index, total, editable, isCurrent,
  onRemove, onMoveUp, onMoveDown, onEdit,
}: {
  step: ChainStep; index: number; total: number; editable: boolean; isCurrent: boolean;
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void;
  onEdit: (s: ChainStep) => void;
}) {
  const roleInfo = ROLE_OPTIONS.find(r => r.value === step.role);
  const [editing, setEditing] = useState(false);
  const [editRole, setEditRole] = useState(step.role);
  const [editReason, setEditReason] = useState(step.reason);

  const saveEdit = () => {
    const newLabel = ROLE_OPTIONS.find(r => r.value === editRole)?.label || editRole;
    onEdit({ ...step, role: editRole, label: newLabel, reason: editReason });
    setEditing(false);
  };

  if (editing && editable) {
    return (
      <div className="flex flex-col gap-1 p-2 bg-gray-800/50 rounded-lg border border-accent/30">
        <div className="flex gap-2 items-center">
          <select value={editRole} onChange={e => setEditRole(e.target.value as AgentRole)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200">
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.emoji} {r.label}</option>)}
          </select>
          <input value={editReason} onChange={e => setEditReason(e.target.value)}
            placeholder="이유"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs" />
          <button onClick={saveEdit} className="text-xs text-accent hover:underline">저장</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">취소</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800/40 rounded-lg group">
      <span className="text-gray-500 text-xs w-5 text-center">{index + 1}</span>
      <span className="text-base">{roleInfo?.emoji || '⚡'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-gray-200">{step.label}</div>
        <div className="text-[10px] text-gray-500">{step.reason}</div>
      </div>
      {editable && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {index > 0 && (
            <button onClick={onMoveUp} className="text-[10px] text-gray-500 hover:text-gray-300 px-1" title="위로">↑</button>
          )}
          {index < total - 1 && (
            <button onClick={onMoveDown} className="text-[10px] text-gray-500 hover:text-gray-300 px-1" title="아래로">↓</button>
          )}
          <button onClick={() => setEditing(true)} className="text-[10px] text-gray-500 hover:text-accent px-1" title="편집">✎</button>
          {total > 1 && (
            <button onClick={onRemove} className="text-[10px] text-gray-500 hover:text-red-400 px-1" title="삭제">✕</button>
          )}
        </div>
      )}
      {!editable && isCurrent && (
        <span className="text-[10px] text-cyan-400">◀ 현재</span>
      )}
    </div>
  );
}

export default function ChainPlanEditor({ plan }: { plan: ChainPlan }) {
  const editChainSteps = useStore(s => s.editChainSteps);
  const setAutoExecute = useStore(s => s.setChainAutoExecute);
  const confirmPlan = useStore(s => s.confirmChainPlan);
  const advancePlan = useStore(s => s.advanceChainPlan);
  const cancelPlan = useStore(s => s.cancelChainPlan);

  const allStepsCompleted = plan.steps.length > 0 && plan.currentStep >= plan.steps.length - 1;
  const effectiveStatus = (plan.status === 'running' || plan.status === 'confirmed') && allStepsCompleted
    ? 'completed'
    : plan.status;

  const editable = plan.status === 'proposed';
  const canConfirm = plan.status === 'proposed';
  const canAdvance = (plan.status === 'running' || plan.status === 'confirmed') && !plan.autoExecute && plan.currentStep < plan.steps.length - 1;
  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.proposed;

  const [localSteps, setLocalSteps] = useState<ChainStep[]>(plan.steps);
  const stepsChanged = JSON.stringify(localSteps) !== JSON.stringify(plan.steps);

  const handleRemove = (idx: number) => {
    setLocalSteps(prev => prev.filter((_, i) => i !== idx));
  };
  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    setLocalSteps(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };
  const handleMoveDown = (idx: number) => {
    setLocalSteps(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };
  const handleEdit = (idx: number, step: ChainStep) => {
    setLocalSteps(prev => prev.map((s, i) => i === idx ? step : s));
  };
  const handleAdd = () => {
    setLocalSteps(prev => [...prev, {
      role: 'developer' as AgentRole,
      label: '개발',
      reason: '추가 단계',
    }]);
  };
  const handleSave = async () => {
    await editChainSteps(plan.id, localSteps);
  };

  return (
    <div className={`rounded-xl border ${statusStyle.bg} p-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-200">
          🔗 체인 플랜: {plan.taskTitle}
        </div>
        <span className="text-[10px] text-gray-400">{statusStyle.label}</span>
      </div>

      {/* Progress bar for running plans */}
      {(plan.status === 'running' || plan.status === 'confirmed') && plan.currentStep >= 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all"
              style={{ width: `${((plan.currentStep + 1) / plan.steps.length) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400">{plan.currentStep + 1}/{plan.steps.length}</span>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-1">
        {(editable ? localSteps : plan.steps).map((step, idx) => (
          <StepRow
            key={idx}
            step={step}
            index={idx}
            total={(editable ? localSteps : plan.steps).length}
            editable={editable}
            isCurrent={idx === plan.currentStep && (plan.status === 'running' || plan.status === 'confirmed')}
            onRemove={() => handleRemove(idx)}
            onMoveUp={() => handleMoveUp(idx)}
            onMoveDown={() => handleMoveDown(idx)}
            onEdit={(s) => handleEdit(idx, s)}
          />
        ))}
      </div>

      {/* Add step button */}
      {editable && (
        <button onClick={handleAdd}
          className="w-full text-xs text-gray-500 hover:text-accent border border-dashed border-gray-700 rounded-lg py-1 hover:border-accent/40 transition-colors">
          + 단계 추가
        </button>
      )}

      {/* Auto-execute toggle */}
      <div className="flex items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={plan.autoExecute}
            onChange={e => setAutoExecute(plan.id, e.target.checked)}
            className="accent-accent"
            disabled={plan.status === 'completed' || plan.status === 'cancelled'}
          />
          자동 실행 (단계 완료 시 다음 자동 진행)
        </label>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {stepsChanged && editable && (
          <button onClick={handleSave}
            className="flex-1 px-3 py-1.5 bg-accent/20 text-accent rounded-lg text-xs font-semibold hover:bg-accent/30">
            💾 변경 저장
          </button>
        )}
        {canConfirm && (
          <button onClick={() => confirmPlan(plan.id)}
            className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
            ✅ 확정 & 실행
          </button>
        )}
        {canAdvance && (
          <button onClick={() => advancePlan(plan.id)}
            className="flex-1 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold">
            ▶️ 다음 단계 진행
          </button>
        )}
        {plan.status !== 'completed' && plan.status !== 'cancelled' && (
          <button onClick={() => cancelPlan(plan.id)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs">
            취소
          </button>
        )}
      </div>
    </div>
  );
}
