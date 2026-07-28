import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  FieldLabel,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  Tile,
} from '../../components/ui/PageShell';
import { api, type DateRangePreset, type FinanceOverview } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom' },
];

function Money({
  amount,
  tone = 'neutral',
}: {
  amount: number;
  tone?: 'receive' | 'pay' | 'neutral';
}) {
  const cls =
    tone === 'receive' ? 'text-success' : tone === 'pay' ? 'text-danger' : 'text-textPrimary';
  return <span className={`tabular-nums font-semibold ${cls}`}>Rs {formatMoney(amount)}</span>;
}

export function AccountsFinancePage() {
  const location = useLocation();
  const [tab, setTab] = useState<'overview' | 'chart'>(
    location.pathname.includes('/chart') ? 'chart' : 'overview',
  );
  useEffect(() => {
    setTab(location.pathname.includes('/chart') ? 'chart' : 'overview');
  }, [location.pathname]);

  const [preset, setPreset] = useState<DateRangePreset>('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const overview = await api.getFinanceOverview({
          preset,
          fromDate: preset === 'custom' ? fromDate || undefined : undefined,
          toDate: preset === 'custom' ? toDate || undefined : undefined,
        });
        if (!cancelled) setData(overview);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load finance overview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, fromDate, toDate]);

  return (
    <PageShell
      title="Accounts"
      subtitle="Finance command center — cash, banks, outstanding, and trial balance"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            tab === 'overview' ? 'bg-accent text-onAccent' : 'border border-border text-textSecondary'
          }`}
          onClick={() => setTab('overview')}
        >
          Finance Overview
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            tab === 'chart' ? 'bg-accent text-onAccent' : 'border border-border text-textSecondary'
          }`}
          onClick={() => setTab('chart')}
        >
          Chart of Accounts
        </button>
      </div>

      {tab === 'chart' ? (
        <Panel className="max-w-2xl space-y-3">
          <p className="text-sm text-textSecondary">
            Manage categories and ledger accounts (including named bank accounts).
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/accounts/manage/add?bank=1">
              <PrimaryButton type="button">Add Bank Account</PrimaryButton>
            </Link>
            <Link to="/accounts/manage/add">
              <SecondaryButton type="button">Add Account</SecondaryButton>
            </Link>
            <Link to="/accounts/manage/edit">
              <SecondaryButton type="button">Edit Account</SecondaryButton>
            </Link>
            <Link to="/accounts/manage/remove">
              <SecondaryButton type="button">Remove Account</SecondaryButton>
            </Link>
            <Link to="/accounts/categories/add">
              <SecondaryButton type="button">Add Category</SecondaryButton>
            </Link>
            <Link to="/accounts/categories/edit">
              <SecondaryButton type="button">Edit Category</SecondaryButton>
            </Link>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <FieldLabel>Revenue period</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPreset(p.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      preset === p.value
                        ? 'bg-accent text-onAccent'
                        : 'border border-border text-textSecondary'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {preset === 'custom' ? (
              <>
                <div>
                  <FieldLabel>From</FieldLabel>
                  <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>To</FieldLabel>
                  <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </>
            ) : null}
          </div>

          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          {loading || !data ? (
            <p className="text-sm text-textMuted">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">Cash in Hand</p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.cashInHand} />
                  </p>
                </Tile>
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">All Banks</p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.bankTotal} />
                  </p>
                </Tile>
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">Cash + Banks</p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.liquidTotal} />
                  </p>
                </Tile>
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">
                    Total Revenue ({data.financialSummary.range.label})
                  </p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.totalRevenue} tone="receive" />
                  </p>
                </Tile>
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">Customer Outstanding</p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.customerOutstanding} tone="receive" />
                  </p>
                  <p className="mt-1 text-xs text-success">To receive</p>
                </Tile>
                <Tile>
                  <p className="text-xs uppercase tracking-wide text-textMuted">Supplier Outstanding</p>
                  <p className="mt-1 text-xl">
                    <Money amount={data.supplierOutstanding} tone="pay" />
                  </p>
                  <p className="mt-1 text-xs text-danger">To pay</p>
                </Tile>
                <Tile className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-textMuted">Trial Balance</p>
                  <p className="mt-1 text-sm">
                    Debit Rs {formatMoney(data.trialBalance.totalDebit)} · Credit Rs{' '}
                    {formatMoney(data.trialBalance.totalCredit)}
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      data.trialBalance.isBalanced ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {data.trialBalance.isBalanced ? 'Balanced' : 'Unbalanced'}
                  </p>
                </Tile>
              </div>

              <Panel>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">
                  Bank Accounts
                </h2>
                {data.bankAccounts.length === 0 ? (
                  <p className="text-sm text-textMuted">
                    No bank accounts yet.{' '}
                    <Link to="/accounts/manage/add?bank=1" className="text-brand underline">
                      Add one
                    </Link>
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-textMuted">
                          <th className="py-2 pr-2">Account</th>
                          <th className="py-2 pr-2">Code</th>
                          <th className="py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.bankAccounts.map((a) => (
                          <tr key={a.id} className="border-b border-border/60">
                            <td className="py-2 pr-2 font-medium text-textPrimary">{a.name}</td>
                            <td className="py-2 pr-2 text-textSecondary">{a.code}</td>
                            <td className="py-2 text-right">
                              <Money amount={a.balance} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">
                  Recent Balance Activity
                </h2>
                {data.recentActivity.length === 0 ? (
                  <p className="text-sm text-textMuted">No recent vouchers.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-textMuted">
                          <th className="py-2 pr-2">Date</th>
                          <th className="py-2 pr-2">Voucher</th>
                          <th className="py-2 pr-2">Type</th>
                          <th className="py-2 pr-2">Account / party</th>
                          <th className="py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentActivity.map((row) => (
                          <tr key={row.id} className="border-b border-border/60">
                            <td className="py-2 pr-2 whitespace-nowrap">{formatDate(row.date)}</td>
                            <td className="py-2 pr-2">#{row.number}</td>
                            <td className="py-2 pr-2">{row.type}</td>
                            <td className="py-2 pr-2">{row.accountLabel}</td>
                            <td className="py-2 text-right tabular-nums">Rs {formatMoney(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
