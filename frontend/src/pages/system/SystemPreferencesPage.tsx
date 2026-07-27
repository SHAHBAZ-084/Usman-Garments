import { FormEvent, useEffect, useState } from 'react';
import { PageShell, Panel, PrimaryButton, Tile, FieldLabel, TextInput } from '../../components/ui/PageShell';
import { useTheme } from '../../contexts/ThemeContext';
import { api, SystemPreferences } from '../../lib/api';

type PrefForm = Omit<SystemPreferences, 'updatedAt'>;

type NumericPrefKey = Exclude<keyof PrefForm, 'closingDate'>;

const PREF_FIELDS: { key: NumericPrefKey; label: string; hint?: string }[] = [
  { key: 'daamiPercent', label: 'Daami (%)' },
  { key: 'paleDariPercent', label: 'Pale Dari (%)' },
  { key: 'brokeryPercent', label: 'Brokery (%)' },
  { key: 'marketFeeRate', label: 'Market Fee (per bag)' },
  { key: 'bardanaRate', label: 'Bardana Rate' },
  { key: 'taxPercent', label: 'Tax (%)' },
  { key: 'kaatPercent', label: 'Kaat (%)' },
  { key: 'mazduriPercent', label: 'Mazduri (%)' },
  { key: 'commissionPercent', label: 'Commission (%)' },
  { key: 'dalaliPercent', label: 'Dalali (%)' },
  { key: 'sutliRate', label: 'Sutli' },
  { key: 'markeetFeeRate', label: 'Markeet Fee' },
  { key: 'kantaRate', label: 'Kanta' },
];

export function SystemPreferencesPage() {
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState<PrefForm | null>(null);
  const [closingDate, setClosingDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSystemPreferences().then((prefs) => {
      const { updatedAt: _, ...rest } = prefs;
      setForm(rest);
      setClosingDate(prefs.closingDate ?? '');
    }).catch(() => setError('Failed to load preferences'));
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {} as Partial<PrefForm>;
      for (const field of PREF_FIELDS) {
        payload[field.key] = Number(form[field.key]) || 0;
      }
      payload.closingDate = closingDate.trim() || null;
      const updated = await api.updateSystemPreferences(payload);
      const { updatedAt: _, ...rest } = updated;
      setForm(rest);
      setClosingDate(updated.closingDate ?? '');
      setMessage('Preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="System Preference" subtitle="Shop-wide settings">
      <Panel className="max-w-2xl">
        <Tile>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-textPrimary">Appearance</p>
              <p className="mt-1 text-xs text-textMuted">Choose light or dark theme for the whole app.</p>
            </div>
            <div className="flex rounded-lg border border-border bg-surface2 p-1">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  theme === 'light'
                    ? 'bg-accent text-onAccent'
                    : 'text-textSecondary hover:text-textPrimary'
                }`}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  theme === 'dark'
                    ? 'bg-accent text-onAccent'
                    : 'text-textSecondary hover:text-textPrimary'
                }`}
              >
                Dark
              </button>
            </div>
          </div>
        </Tile>

        {form ? (
          <form className="mt-6 space-y-4" onSubmit={onSave}>
            <p className="text-sm text-textSecondary">
              Shop-wide numeric defaults. Values are stored for future use and reporting.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {PREF_FIELDS.map((field) => (
                <div key={field.key}>
                  <FieldLabel>{field.label}</FieldLabel>
                  <TextInput
                    type="number"
                    step="any"
                    min="0"
                    value={String(form[field.key])}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, [field.key]: e.target.value === '' ? 0 : Number(e.target.value) } : prev,
                      )
                    }
                  />
                  {field.hint ? <p className="mt-1 text-xs text-textMuted">{field.hint}</p> : null}
                </div>
              ))}
              <div>
                <FieldLabel>Closing Date</FieldLabel>
                <TextInput value={closingDate} onChange={(e) => setClosingDate(e.target.value)} placeholder="e.g. 2026-06-30" />
              </div>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-success">{message}</p> : null}
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save preferences'}
            </PrimaryButton>
          </form>
        ) : error ? (
          <p className="mt-4 text-sm text-danger">{error}</p>
        ) : (
          <p className="mt-4 text-sm text-textMuted">Loading…</p>
        )}
      </Panel>
    </PageShell>
  );
}
