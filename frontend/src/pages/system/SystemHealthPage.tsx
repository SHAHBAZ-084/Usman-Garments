import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell, Panel, PrimaryButton, SecondaryButton, Feedback, Tile } from '../../components/ui/PageShell';
import { api } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      {label}: {ok ? 'OK' : 'Issue'}
    </span>
  );
}

const DISMISS_KEY = 'usman-mall-health-dismissed';

type DismissedState = {
  database?: string;
  trialBalance?: string;
  stock: Record<string, string>;
};

function mismatchSignature(m: { productId: number; expected: number; actual: number }) {
  return `${m.productId}:${m.expected}:${m.actual}`;
}

function readDismissed(): DismissedState {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return { stock: {} };
    const parsed = JSON.parse(raw) as Partial<DismissedState>;
    return {
      database: parsed.database,
      trialBalance: parsed.trialBalance,
      stock: parsed.stock ?? {},
    };
  } catch {
    return { stock: {} };
  }
}

function writeDismissed(next: DismissedState) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function SystemHealthPage() {
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.getSystemHealth>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restorePath, setRestorePath] = useState('');
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState<DismissedState>(() => readDismissed());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await api.getSystemHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const databaseKey = report ? report.databaseIntegrity.detail : '';
  const trialKey = report
    ? `${report.trialBalance.totalDebit}:${report.trialBalance.totalCredit}:${report.trialBalance.ok}`
    : '';

  const showDatabaseAlert = Boolean(
    report && !report.databaseIntegrity.ok && dismissed.database !== databaseKey,
  );
  const showTrialAlert = Boolean(report && !report.trialBalance.ok && dismissed.trialBalance !== trialKey);

  const visibleMismatches = useMemo(() => {
    if (!report) return [];
    return report.stockReconciliation.mismatches.filter(
      (m) => dismissed.stock[String(m.productId)] !== mismatchSignature(m),
    );
  }, [report, dismissed]);

  function dismissDatabase() {
    const next = { ...dismissed, database: databaseKey };
    setDismissed(next);
    writeDismissed(next);
  }

  function dismissTrial() {
    const next = { ...dismissed, trialBalance: trialKey };
    setDismissed(next);
    writeDismissed(next);
  }

  function dismissStock(productId: number, signature: string) {
    const next = {
      ...dismissed,
      stock: { ...dismissed.stock, [String(productId)]: signature },
    };
    setDismissed(next);
    writeDismissed(next);
  }

  async function agreeStock(m: { productId: number; expected: number; actual: number; name: string }) {
    setMessage('');
    try {
      await api.reconcileHealthStock(m.productId);
      dismissStock(m.productId, mismatchSignature(m));
      setMessage(`Cleared stock mismatch for ${m.name}. Records start fresh from here.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not clear stock mismatch');
    }
  }

  const stockSettled =
    !report ||
    report.stockReconciliation.ok ||
    report.stockReconciliation.mismatches.every(
      (m) => dismissed.stock[String(m.productId)] === mismatchSignature(m),
    );

  async function createBackupNow() {
    setBackupBusy(true);
    setMessage('');
    try {
      await api.createBackup();
      setMessage('Backup created successfully.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromBackup() {
    const folder = restorePath.trim();
    if (!folder) {
      setMessage('Enter the full path to a backup folder.');
      return;
    }
    const confirmed = window.confirm(
      'Restore will replace your current database and uploaded images with the selected backup.\n\n' +
        'A safety copy of your current data is created automatically first.\n\n' +
        'The app will need to restart after restore.\n\n' +
        'This cannot be undone except by restoring another backup. Continue?',
    );
    if (!confirmed) return;

    setRestoreBusy(true);
    setMessage('');
    try {
      await api.validateBackup(folder);
      const result = await api.restoreBackup(folder);
      setMessage(`Restore complete. Safety copy: ${result.safetyBackupPath}. Restarting…`);
      setTimeout(() => restartApp(), 1500);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoreBusy(false);
    }
  }

  function pickRecentBackup(folderPath: string) {
    setRestorePath(folderPath);
  }

  function restartApp() {
    if (window.usmanGarments?.restartApp) {
      void window.usmanGarments.restartApp();
    } else {
      window.location.reload();
    }
  }

  async function openLogsFolder() {
    try {
      const { path: logsPath } = await api.getLogsPath();
      setMessage(`Logs folder: ${logsPath}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not resolve logs path');
    }
  }

  return (
    <PageShell
      title="System Health"
      subtitle="Database integrity, accounting balance, backups, and recovery"
      actions={
        <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </SecondaryButton>
      }
    >
      {error ? <Feedback variant="error" className="mb-3">{error}</Feedback> : null}
      {message ? <Feedback variant={message.includes('fail') ? 'error' : 'success'} className="mb-3">{message}</Feedback> : null}

      {report ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusBadge ok={report.databaseIntegrity.ok || !showDatabaseAlert} label="Database" />
            <StatusBadge ok={report.trialBalance.ok || !showTrialAlert} label="Trial balance" />
            <StatusBadge ok={stockSettled} label="Stock reconciliation" />
          </div>

          {showDatabaseAlert ? (
            <Panel className="mb-4 border-red-200 bg-red-50/60">
              <h2 className="mb-1 text-sm font-semibold text-red-900">Database health alert</h2>
              <p className="mb-3 text-sm text-red-900/80">{report.databaseIntegrity.detail}</p>
              <SecondaryButton type="button" onClick={dismissDatabase}>
                Agreed — dismiss notification
              </SecondaryButton>
            </Panel>
          ) : null}

          {showTrialAlert ? (
            <Panel className="mb-4 border-amber-200 bg-amber-50/60">
              <h2 className="mb-1 text-sm font-semibold text-amber-950">Trial balance alert</h2>
              <p className="mb-3 text-sm text-amber-950/80">
                Debit {formatMoney(report.trialBalance.totalDebit)} does not match credit{' '}
                {formatMoney(report.trialBalance.totalCredit)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton type="button" onClick={dismissTrial}>
                  Agreed — dismiss notification
                </SecondaryButton>
                <Link to="/accounts/trial-balance" className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm">
                  Open trial balance
                </Link>
              </div>
            </Panel>
          ) : null}

          {visibleMismatches.length > 0 ? (
            <Panel className="mb-4 border-amber-200 bg-amber-50/50">
              <h2 className="mb-2 text-sm font-semibold">Stock mismatch alerts</h2>
              <p className="mb-3 text-xs text-textMuted">
                Monitor only — review each note and Agree when you have seen it. Adjusting inventory is optional and separate.
              </p>
              <ul className="space-y-3 text-sm">
                {visibleMismatches.map((m) => (
                  <li key={m.productId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface2 p-3">
                    <p className="font-medium">
                      {m.name}: movements expect {m.expected}, on-hand is {m.actual}
                    </p>
                    <SecondaryButton type="button" onClick={() => agreeStock(m)}>
                      Agree — seen
                    </SecondaryButton>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Tile>
              <p className="text-xs text-textMuted">Data location</p>
              <p className="mt-1 text-sm font-medium capitalize">{report.dataLocation.mode}</p>
              <p className="mt-1 break-all text-xs text-textSecondary">{report.dataLocation.dataRoot}</p>
            </Tile>
            <Tile>
              <p className="text-xs text-textMuted">Database size</p>
              <p className="mt-1 text-lg font-semibold">{formatBytes(report.databaseSizeBytes)}</p>
            </Tile>
            <Tile>
              <p className="text-xs text-textMuted">Free disk space</p>
              <p className="mt-1 text-lg font-semibold">
                {report.freeDiskSpaceBytes != null ? formatBytes(report.freeDiskSpaceBytes) : 'Unknown'}
              </p>
            </Tile>
            <Tile>
              <p className="text-xs text-textMuted">Last backup</p>
              <p className="mt-1 text-sm font-medium">
                {report.backup.lastBackupAt ? formatDate(report.backup.lastBackupAt) : 'Never'}
              </p>
            </Tile>
            <Tile>
              <p className="text-xs text-textMuted">Trial balance</p>
              <p className="mt-1 text-sm">
                Dr {formatMoney(report.trialBalance.totalDebit)} / Cr {formatMoney(report.trialBalance.totalCredit)}
              </p>
            </Tile>
            <Tile>
              <p className="text-xs text-textMuted">Stock check</p>
              <p className="mt-1 text-sm">
                {report.stockReconciliation.productsChecked} products — {report.stockReconciliation.mismatches.length}{' '}
                mismatch(es)
              </p>
            </Tile>
          </div>

          <Panel className="mt-4">
            <h2 className="mb-3 text-sm font-semibold">Recovery actions</h2>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="button" onClick={() => void createBackupNow()} disabled={backupBusy}>
                {backupBusy ? 'Creating…' : 'Create Backup Now'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={restartApp}>
                Restart App
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => void openLogsFolder()}>
                Open Logs Folder
              </SecondaryButton>
              <Link to="/system/settings" className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm">
                Backup settings
              </Link>
            </div>
          </Panel>

          <Panel className="mt-4 border-amber-200 bg-amber-50/50">
            <h2 className="mb-2 text-sm font-semibold text-amber-900">Restore from backup</h2>
            <p className="mb-3 text-xs text-amber-900/80">
              Destructive: replaces current database and uploads. A safety copy is created automatically before restore.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[280px] flex-1 flex-col text-xs">
                Backup folder path
                <input
                  type="text"
                  className="mt-1 rounded border border-border px-2 py-1.5 text-sm"
                  value={restorePath}
                  onChange={(e) => setRestorePath(e.target.value)}
                  placeholder="C:\Backups\usman-mall-backup-..."
                />
              </label>
              <SecondaryButton type="button" onClick={() => void restoreFromBackup()} disabled={restoreBusy}>
                {restoreBusy ? 'Restoring…' : 'Restore backup'}
              </SecondaryButton>
            </div>
          </Panel>

          {report.recentBackups.length > 0 ? (
            <Panel className="mt-4">
              <h2 className="mb-2 text-sm font-semibold">Recent backups</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-textMuted">
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Size</th>
                    <th className="py-1 pr-2">Path</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {report.recentBackups.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2">{formatDate(b.createdAt)}</td>
                      <td className="py-1.5 pr-2">{formatBytes(b.totalSize)}</td>
                      <td className="py-1.5 break-all text-xs text-textMuted">{b.folderPath}</td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="text-xs text-brand underline"
                          onClick={() => pickRecentBackup(b.folderPath)}
                        >
                          Use for restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : null}
        </>
      ) : loading ? (
        <p className="text-sm text-textMuted">Running health checks…</p>
      ) : null}
    </PageShell>
  );
}
