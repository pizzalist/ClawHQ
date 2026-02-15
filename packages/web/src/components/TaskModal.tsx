import { useState } from 'react';
import { useStore } from '../store';
import { ROLE_EMOJI } from '@ai-office/shared';

export default function TaskModal({ onClose, preAssignId }: { onClose: () => void; preAssignId?: string | null }) {
  const agents = useStore((s) => s.agents);
  const createTask = useStore((s) => s.createTask);
  const loading = useStore((s) => s.loading['createTask']);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(preAssignId || '');

  const submit = async () => {
    if (!title.trim()) return;
    await createTask(title.trim(), description.trim(), assigneeId || null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a2e] rounded-xl border border-gray-700/50 w-[480px] max-w-[90vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-700/30 flex items-center justify-between">
          <h2 className="text-lg font-bold">📋 New Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Title *</label>
            <input
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit()}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Description</label>
            <textarea
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details, context, requirements..."
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Assign to</label>
            <select
              className="w-full bg-[#0f0f1a] border border-gray-700/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Auto-assign</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {ROLE_EMOJI[a.role]} {a.name} ({a.state})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-700/30 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/30">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || loading}
            className="px-4 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
