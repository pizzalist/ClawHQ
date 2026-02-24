import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { toast } from './Toast';

interface ModelSettings {
  chiefModel: string;
}

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const t = useT();
  const [models, setModels] = useState<string[]>([]);
  const [chiefModel, setChiefModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const [modelsRes, settingsRes] = await Promise.all([
          fetch('/api/models'),
          fetch('/api/settings'),
        ]);

        const modelsJson = await modelsRes.json();
        const settingsJson = await settingsRes.json();
        if (cancelled) return;

        setModels(Array.isArray(modelsJson.models) ? modelsJson.models : []);
        setChiefModel(settingsJson.chiefModel || '');
      } catch {
        if (!cancelled) toast('Failed to load settings', 'error');
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chiefModel }),
      });
      const json = await res.json();
      setChiefModel(json.chiefModel);
      toast(t('settings.saved'), 'success');
      onClose();
    } catch {
      toast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>

        <div className="p-5 space-y-4 text-gray-200">
          {!chiefModel ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : (
            <section>
              <h3 className="text-sm font-semibold mb-2">{t('settings.chiefModel')}</h3>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2"
                value={chiefModel}
                onChange={(e) => setChiefModel(e.target.value)}
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                {t('settings.chiefModelDesc')}
              </p>
            </section>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200">Close</button>
          <button
            onClick={onSave}
            disabled={!chiefModel || saving}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          >
            {saving ? '...' : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
