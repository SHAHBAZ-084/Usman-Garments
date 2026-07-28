import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FieldLabel,
  Feedback,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  Tile,
} from '../../components/ui/PageShell';
import { isProtectedSettingsField } from '../../config/protectedSettingsFields';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccessComboListener } from '../../hooks/useAccessComboListener';
import { api, type BusinessSettings } from '../../lib/api';

const emptyForm = {
  businessName: 'Usman Mall',
  tagline: 'Quality Clothes, Your Style',
  ownerName: '',
  phone: '0300-6195469',
  whatsapp: '0300-6195469',
  address: 'Al-Nisa Road, Chishtian',
  invoiceFooter: 'Thank you for shopping at Usman Mall',
  returnPolicy:
    'Returns accepted within 7 days with original receipt. Items must be unused and in original condition.',
  invoicePrefix: 'UM-',
  currency: 'PKR',
  receiptSize: 'THERMAL_80' as BusinessSettings['receiptSize'],
  a4InvoiceEnabled: true,
  printerName: '' as string,
  barcodeLabelSize: '50x30',
  lowStockLimit: 5,
  backupFolderPath: '',
  themeMode: 'light' as BusinessSettings['themeMode'],
};

export function SettingsPage() {
  const { theme, setTheme, refreshThemeFromServer } = useTheme();
  const [form, setForm] = useState(emptyForm);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [identityEditActive, setIdentityEditActive] = useState(false);
  const [accessPromptOpen, setAccessPromptOpen] = useState(false);
  const [accessInput, setAccessInput] = useState('');
  const [accessError, setAccessError] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [passphraseMessage, setPassphraseMessage] = useState('');

  const refreshAccessStatus = useCallback(async () => {
    try {
      const status = await api.getIdentityAccessStatus();
      setIdentityEditActive(status.active);
    } catch {
      setIdentityEditActive(false);
    }
  }, []);

  useAccessComboListener({
    enabled: !loading && !identityEditActive,
    onMatch: () => {
      setAccessError('');
      setAccessInput('');
      setAccessPromptOpen(true);
    },
  });

  useEffect(() => {
    void refreshAccessStatus();
    return () => {
      void api.endIdentityAccess().catch(() => undefined);
    };
  }, [refreshAccessStatus]);

  useEffect(() => {
    if (!identityEditActive) return;

    function onActivity() {
      void api.touchIdentityAccess().then((status) => setIdentityEditActive(status.active)).catch(() => setIdentityEditActive(false));
    }

    const timer = window.setInterval(onActivity, 60_000);
    window.addEventListener('mousedown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('mousedown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [identityEditActive]);

  function identityFieldLocked(key: keyof typeof form) {
    return isProtectedSettingsField(key) && !identityEditActive;
  }

  async function submitAccessPrompt(event: FormEvent) {
    event.preventDefault();
    setAccessBusy(true);
    setAccessError('');
    try {
      const result = await api.verifyIdentityAccess(accessInput);
      if (!result.ok) {
        setAccessError('Incorrect passphrase.');
        return;
      }
      setIdentityEditActive(true);
      setAccessPromptOpen(false);
      setAccessInput('');
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setAccessBusy(false);
    }
  }

  async function onChangePassphrase(event: FormEvent) {
    event.preventDefault();
    setPassphraseMessage('');
    setError('');
    try {
      await api.changeIdentityPassphrase(currentPassphrase, newPassphrase);
      setPassphraseMessage('Passphrase updated.');
      setCurrentPassphrase('');
      setNewPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update passphrase');
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (cancelled) return;
        setForm({
          businessName: settings.businessName,
          tagline: settings.tagline,
          ownerName: settings.ownerName,
          phone: settings.phone,
          whatsapp: settings.whatsapp,
          address: settings.address,
          invoiceFooter: settings.invoiceFooter,
          returnPolicy: settings.returnPolicy,
          invoicePrefix: settings.invoicePrefix,
          currency: settings.currency,
          receiptSize: settings.receiptSize,
          a4InvoiceEnabled: settings.a4InvoiceEnabled,
          printerName: settings.printerName ?? '',
          barcodeLabelSize: settings.barcodeLabelSize,
          lowStockLimit: settings.lowStockLimit,
          backupFolderPath: settings.backupFolderPath,
          themeMode: settings.themeMode,
        });
        setLogoUrl(settings.logoUrl);
        if (settings.themeMode !== theme) {
          await refreshThemeFromServer();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patchField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const saved = await api.updateSettings({
        ...form,
        printerName: form.printerName.trim() ? form.printerName.trim() : null,
        themeMode: theme,
      });
      setForm((prev) => ({
        ...prev,
        businessName: saved.businessName,
        tagline: saved.tagline,
        ownerName: saved.ownerName,
        phone: saved.phone,
        whatsapp: saved.whatsapp,
        address: saved.address,
        invoiceFooter: saved.invoiceFooter,
        returnPolicy: saved.returnPolicy,
        invoicePrefix: saved.invoicePrefix,
        currency: saved.currency,
        receiptSize: saved.receiptSize,
        a4InvoiceEnabled: saved.a4InvoiceEnabled,
        printerName: saved.printerName ?? '',
        barcodeLabelSize: saved.barcodeLabelSize,
        lowStockLimit: saved.lowStockLimit,
        backupFolderPath: saved.backupFolderPath,
        themeMode: saved.themeMode,
      }));
      setLogoUrl(saved.logoUrl);
      setMessage('Settings saved.');
      window.dispatchEvent(new CustomEvent('usman-mall-settings-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function onLogoChange(file: File | null) {
    if (!file) return;
    setError('');
    setMessage('');
    try {
      const saved = await api.uploadLogo(file);
      setLogoUrl(saved.logoUrl);
      setMessage('Logo uploaded.');
      window.dispatchEvent(new CustomEvent('usman-mall-settings-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    }
  }

  function onThemeChange(next: 'light' | 'dark') {
    setTheme(next);
    patchField('themeMode', next);
  }

  if (loading) {
    return (
      <PageShell title="Settings" subtitle="Business settings">
        <p className="text-sm text-textMuted">Loading…</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Settings" subtitle="Business, invoice, printer, and appearance">
      {identityEditActive ? (
        <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-950 dark:text-amber-100">
          Developer Edit Mode active — protected business fields are editable for this session.
        </div>
      ) : null}

      {accessPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Panel className="w-full max-w-sm">
            <form onSubmit={submitAccessPrompt} className="space-y-3">
              <TextInput
                type="password"
                autoFocus
                value={accessInput}
                onChange={(e) => setAccessInput(e.target.value)}
              />
              {accessError ? <Feedback variant="error">{accessError}</Feedback> : null}
              <div className="flex justify-end gap-2">
                <SecondaryButton type="button" onClick={() => setAccessPromptOpen(false)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit" disabled={accessBusy || !accessInput}>
                  {accessBusy ? 'Checking…' : 'Continue'}
                </PrimaryButton>
              </div>
            </form>
          </Panel>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSave}>
        <Panel className={`max-w-3xl space-y-4 ${identityEditActive ? 'ring-2 ring-amber-500/40' : ''}`}>
          <Tile>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Business Info</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Business name</FieldLabel>
                <TextInput
                  value={form.businessName}
                  onChange={(e) => patchField('businessName', e.target.value)}
                  readOnly={identityFieldLocked('businessName')}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Tagline</FieldLabel>
                <TextInput value={form.tagline} onChange={(e) => patchField('tagline', e.target.value)} />
              </div>
              <div>
                <FieldLabel>Owner name</FieldLabel>
                <TextInput value={form.ownerName} onChange={(e) => patchField('ownerName', e.target.value)} />
              </div>
              <div>
                <FieldLabel>Phone</FieldLabel>
                <TextInput
                  value={form.phone}
                  onChange={(e) => patchField('phone', e.target.value)}
                  readOnly={identityFieldLocked('phone')}
                />
              </div>
              <div>
                <FieldLabel>WhatsApp</FieldLabel>
                <TextInput value={form.whatsapp} onChange={(e) => patchField('whatsapp', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Address</FieldLabel>
                <TextInput
                  value={form.address}
                  onChange={(e) => patchField('address', e.target.value)}
                  readOnly={identityFieldLocked('address')}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Shop logo</FieldLabel>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border bg-surface1 text-lg font-semibold text-textPrimary">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Shop logo" className="h-full w-full object-cover" />
                    ) : (
                      'UM'
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => onLogoChange(e.target.files?.[0] ?? null)}
                    className="text-sm text-textSecondary"
                  />
                </div>
              </div>
            </div>
          </Tile>

          <Tile>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Invoice</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Invoice footer</FieldLabel>
                <TextInput value={form.invoiceFooter} onChange={(e) => patchField('invoiceFooter', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Return and exchange policy</FieldLabel>
                <textarea
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  rows={3}
                  value={form.returnPolicy}
                  onChange={(e) => patchField('returnPolicy', e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Invoice prefix</FieldLabel>
                <TextInput
                  value={form.invoicePrefix}
                  onChange={(e) => patchField('invoicePrefix', e.target.value)}
                  readOnly={identityFieldLocked('invoicePrefix')}
                  required
                />
              </div>
              <div>
                <FieldLabel>Currency</FieldLabel>
                <TextInput
                  value={form.currency}
                  onChange={(e) => patchField('currency', e.target.value)}
                  readOnly={identityFieldLocked('currency')}
                  required
                />
              </div>
              <div>
                <FieldLabel>Receipt size</FieldLabel>
                <select
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={form.receiptSize}
                  onChange={(e) => patchField('receiptSize', e.target.value as typeof form.receiptSize)}
                >
                  <option value="THERMAL_58">Thermal 58mm</option>
                  <option value="THERMAL_80">Thermal 80mm</option>
                  <option value="A4">A4</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-textPrimary">
                  <input
                    type="checkbox"
                    checked={form.a4InvoiceEnabled}
                    onChange={(e) => patchField('a4InvoiceEnabled', e.target.checked)}
                  />
                  Enable A4 invoice option
                </label>
              </div>
            </div>
          </Tile>

          <Tile>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Printer</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Printer name</FieldLabel>
                <TextInput
                  value={form.printerName}
                  onChange={(e) => patchField('printerName', e.target.value)}
                  placeholder="Optional Windows printer name"
                />
              </div>
              <div>
                <FieldLabel>Barcode label size</FieldLabel>
                <select
                  className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                  value={
                    ['40x30', '50x25', '50x30', 'a4'].includes(form.barcodeLabelSize)
                      ? form.barcodeLabelSize
                      : 'custom'
                  }
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      const current = form.barcodeLabelSize;
                      const isPreset = ['40x30', '50x25', '50x30', 'a4'].includes(current);
                      patchField('barcodeLabelSize', isPreset ? '60x40' : current);
                    } else {
                      patchField('barcodeLabelSize', e.target.value);
                    }
                  }}
                >
                  <option value="40x30">40 × 30 mm (thermal)</option>
                  <option value="50x25">50 × 25 mm (thermal)</option>
                  <option value="50x30">50 × 30 mm (thermal)</option>
                  <option value="a4">A4 sheet (grid)</option>
                  <option value="custom">Custom size…</option>
                </select>
                {!['40x30', '50x25', '50x30', 'a4'].includes(form.barcodeLabelSize) ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel>Width (mm)</FieldLabel>
                      <TextInput
                        type="number"
                        min={20}
                        max={200}
                        value={String(Number(form.barcodeLabelSize.split('x')[0]) || 60)}
                        onChange={(e) => {
                          const w = Math.max(20, Math.min(200, Number(e.target.value) || 60));
                          const h = Number(form.barcodeLabelSize.split('x')[1]) || 40;
                          patchField('barcodeLabelSize', `${w}x${h}`);
                        }}
                      />
                    </div>
                    <div>
                      <FieldLabel>Height (mm)</FieldLabel>
                      <TextInput
                        type="number"
                        min={15}
                        max={200}
                        value={String(Number(form.barcodeLabelSize.split('x')[1]) || 40)}
                        onChange={(e) => {
                          const h = Math.max(15, Math.min(200, Number(e.target.value) || 40));
                          const w = Number(form.barcodeLabelSize.split('x')[0]) || 60;
                          patchField('barcodeLabelSize', `${w}x${h}`);
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                <p className="mt-1 text-xs text-textMuted">
                  Default size for bulk and single label printing. Override per print if needed.
                </p>
              </div>
            </div>
          </Tile>

          <Tile>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Inventory</h2>
            <div className="max-w-xs">
              <FieldLabel>Low-stock limit</FieldLabel>
              <TextInput
                type="number"
                min={1}
                value={String(form.lowStockLimit)}
                onChange={(e) => patchField('lowStockLimit', Number(e.target.value) || 1)}
                required
              />
            </div>
          </Tile>

          <Tile>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Backup</h2>
            <div>
              <FieldLabel>Backup folder path</FieldLabel>
              <TextInput
                value={form.backupFolderPath}
                onChange={(e) => patchField('backupFolderPath', e.target.value)}
                placeholder="e.g. D:\UsmanMall\Backups"
              />
              <p className="mt-1 text-xs text-textMuted">
                Manual backups are stored here when set; otherwise defaults to the app data folder. See{' '}
                <Link to="/system/health" className="text-brand underline">
                  System Health
                </Link>{' '}
                for backup history and restore.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true);
                  setMessage('');
                  try {
                    await api.createBackup(form.backupFolderPath || undefined);
                    setMessage('Backup created successfully.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Backup failed');
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                {backupBusy ? 'Backing up…' : 'Create backup now'}
              </SecondaryButton>
            </div>
          </Tile>

          <Tile>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-textPrimary">Appearance</p>
                <p className="mt-1 text-xs text-textMuted">Light or dark. Saved to business settings and cached locally.</p>
              </div>
              <div className="flex rounded-lg border border-border bg-surface1 p-1">
                <button
                  type="button"
                  onClick={() => onThemeChange('light')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    theme === 'light' ? 'bg-accent text-onAccent' : 'text-textSecondary hover:text-textPrimary'
                  }`}
                >
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => onThemeChange('dark')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    theme === 'dark' ? 'bg-accent text-onAccent' : 'text-textSecondary hover:text-textPrimary'
                  }`}
                >
                  Dark
                </button>
              </div>
            </div>
          </Tile>

          {identityEditActive ? (
            <Tile>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Access passphrase</h2>
              <form className="grid max-w-md gap-3" onSubmit={onChangePassphrase}>
                <div>
                  <FieldLabel>Current passphrase</FieldLabel>
                  <TextInput
                    type="password"
                    value={currentPassphrase}
                    onChange={(e) => setCurrentPassphrase(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel>New passphrase</FieldLabel>
                  <TextInput
                    type="password"
                    value={newPassphrase}
                    onChange={(e) => setNewPassphrase(e.target.value)}
                    minLength={4}
                    required
                  />
                </div>
                {passphraseMessage ? <Feedback variant="success">{passphraseMessage}</Feedback> : null}
                <PrimaryButton type="submit">Update passphrase</PrimaryButton>
              </form>
            </Tile>
          ) : null}

          {error ? <Feedback variant="error">{error}</Feedback> : null}
          {message ? <Feedback variant="success">{message}</Feedback> : null}

          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => window.location.reload()}>
              Reset
            </SecondaryButton>
          </div>
        </Panel>
      </form>
    </PageShell>
  );
}
