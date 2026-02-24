import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { toast } from './Toast';

type Role = 'pm' | 'developer' | 'reviewer' | 'designer' | 'devops' | 'qa';

interface ModelSettings {
  chiefModel: string;
  defaultModelByRole: Record<Role, string>;
}

const roleOrder: Role[] = ['pm', 'developer', 'reviewer', 'designer', 'devops', 'qa'];

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const t = useT();
  const [models, setModels] = useState<string[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
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
        setSettings(settingsJson as ModelSettings);
      } catch {
        if (!cancelled) toast('Failed to load settings', 'error');
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const updateRoleModel = (role: Role, model: string) => {
    if (!settings) return;
    setSettings({
      ...settings,
      defaultModelByRole: {
        ...settings.defaultModelByRole,
        [role]: model,
      },
    });
  };

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      setSettings(json);
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
        className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>

        <div className="p-5 space-y-6 text-gray-200">
          {!settings ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold mb-2">{t('settings.chiefModel')}</h3>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2"
                  value={settings.chiefModel}
                  onChange={(e) => setSettings({ ...settings, chiefModel: e.target.value })}
                >
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-3">{t('settings.agentModels')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {roleOrder.map((role) => (
                    <label key={role} className="block">
                      <div className="text-xs text-gray-400 mb-1">{t(`settings.role.${role}`)}</div>
                      <select
                        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2"
                        value={settings.defaultModelByRole[role]}
                        onChange={(e) => updateRoleModel(role, e.target.value)}
                      >
                        {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200">Close</button>
          <button
            onClick={onSave}
            disabled={!settings || saving}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          >
            {saving ? '...' : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
