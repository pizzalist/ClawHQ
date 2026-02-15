import { useEffect, useState, useCallback } from 'react';
import type { DecisionItem } from '@ai-office/shared';
import DecisionQueue from './DecisionQueue';
import ProposalCompare from './ProposalCompare';
import DecisionHistory from './DecisionHistory';
import { toast } from '../Toast';

type Tab = 'queue' | 'history';

export default function DecisionsView() {
  const [tab, setTab] = useState<Tab>('queue');
  const [pending, setPending] = useState<DecisionItem[]>([]);
  const [history, setHistory] = useState<DecisionItem[]>([]);
  const [selected, setSelected] = useState<DecisionItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('/api/decisions/pending'),
        fetch('/api/decisions/history'),
      ]);
      setPending(await pRes.json());
      setHistory(await hRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const handleDecide = async (action: 'approved' | 'revised' | 'rejected', proposalId?: string) => {
    if (!selected) return;
    try {
      await fetch(`/api/decisions/${selected.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, chosenProposalId: proposalId }),
      });
      const labels = { approved: '✅ Approved', revised: '🔄 Sent for revision', rejected: '❌ Rejected' };
      toast(labels[action], action === 'approved' ? 'success' : action === 'rejected' ? 'error' : 'info');
      setSelected(null);
      load();
    } catch {
      toast('Failed to save decision', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {selected ? (
        <ProposalCompare
          item={selected}
          onDecide={handleDecide}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          {/* Sub-tabs */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setTab('queue')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                tab === 'queue'
                  ? 'bg-accent/20 text-accent font-semibold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
              }`}
            >
              📥 Queue {pending.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-accent text-white rounded-full font-bold">
                  {pending.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('history')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                tab === 'history'
                  ? 'bg-accent/20 text-accent font-semibold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
              }`}
            >
              📜 History
            </button>
          </div>

          {tab === 'queue' && (
            <DecisionQueue items={pending} onSelect={setSelected} />
          )}
          {tab === 'history' && (
            <DecisionHistory items={history} />
          )}
        </>
      )}
    </div>
  );
}
