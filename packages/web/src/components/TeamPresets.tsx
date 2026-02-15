import { useState } from 'react';
import { TEAM_PRESETS, ROLE_EMOJI, ROLE_LABELS } from '@ai-office/shared';
import { useStore } from '../store';

export default function TeamPresets({ onClose }: { onClose: () => void }) {
  const applyPreset = useStore((s) => s.applyPreset);
  const loading = useStore((s) => s.loading['applyPreset']);
  const [applied, setApplied] = useState<string | null>(null);

  const handleApply = async (presetId: string) => {
    setApplied(presetId);
    await applyPreset(presetId);
    setTimeout(onClose, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] border border-gray-700/50 rounded-xl w-[520px] max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">🏗️ Team Presets</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
        </div>
        <div className="p-4 space-y-3">
          {TEAM_PRESETS.map((preset) => (
            <div
              key={preset.id}
              className="bg-[#0f0f1a] border border-gray-700/30 rounded-lg p-4 hover:border-accent/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">{preset.name}</h3>
                  <p className="text-xs text-gray-500">{preset.description}</p>
                </div>
                <button
                  onClick={() => handleApply(preset.id)}
                  disabled={!!loading}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    applied === preset.id
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-accent/20 text-accent hover:bg-accent/30'
                  } disabled:opacity-50`}
                >
                  {applied === preset.id ? '✓ Applied' : 'Apply'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {preset.agents.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-800/60 rounded text-xs text-gray-400"
                  >
                    {ROLE_EMOJI[a.role]} {a.name}
                    <span className="text-gray-600">({ROLE_LABELS[a.role]})</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-gray-700/30 text-xs text-gray-600 text-center">
          ⚠️ Applying a preset replaces all current agents
        </div>
      </div>
    </div>
  );
}
