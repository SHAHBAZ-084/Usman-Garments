import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClickableMetricTile,
  FieldLabel,
  PageShell,
  Panel,
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
      title="Finance Overview"
      subtitle="Cash, banks, money to receive / pay — tap a card for details"
      wide
      actions={
        <Link
          to="/accounts/e-payment"
          className="inline-flex items-center rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm font-semibold text-textPrimary hover:bg-accent/20"
        >
          Add E-payment methods
        </Link>
      }
    >
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
            <ClickableMetricTile
              label="Cash in Hand"
              value={`Rs ${formatMoney(data.cashInHand)}`}
              to="/reports/sales/payment-methods"
              accent="success"
            />
            <ClickableMetricTile
              label="All Banks & E-pay"
              value={`Rs ${formatMoney(data.bankTotal)}`}
              to="/accounts/e-payment"
            />
            <ClickableMetricTile
              label="Cash + Banks"
              value={`Rs ${formatMoney(data.liquidTotal)}`}
              to="/reports/sales/daily"
              accent="info"
            />
            <ClickableMetricTile
              label={`Revenue (${data.financialSummary.range.label})`}
              value={`Rs ${formatMoney(data.totalRevenue)}`}
              to={`/reports/sales/daily?preset=${preset}`}
              accent="success"
            />
            <ClickableMetricTile
              label="Customer Outstanding"
              value={`Rs ${formatMoney(data.customerOutstanding)}`}
              to="/reports/customers/balances"
              accent="warning"
            />
            <ClickableMetricTile
              label="Supplier Outstanding"
              value={`Rs ${formatMoney(data.supplierOutstanding)}`}
              to="/reports/suppliers/outstanding"
              accent="danger"
            />
            <ClickableMetricTile
              label="Trial Balance"
              value={data.trialBalance.isBalanced ? 'Balanced' : 'Check books'}
              to="/reports/trial-balance"
              accent={data.trialBalance.isBalanced ? 'success' : 'danger'}
            />
            <Tile className="flex flex-col justify-center">
              <p className="text-xs uppercase tracking-wide text-textMuted">Books check</p>
              <p className="mt-1 text-sm text-textSecondary">
                Debit Rs {formatMoney(data.trialBalance.totalDebit)} · Credit Rs{' '}
                {formatMoney(data.trialBalance.totalCredit)}
              </p>
            </Tile>
          </div>

          <Panel>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-textMuted">
                Bank & E-payment accounts
              </h2>
              <Link to="/accounts/e-payment" className="text-sm font-medium text-accent underline">
                Add account
              </Link>
            </div>
            {data.bankAccounts.length === 0 ? (
              <p className="text-sm text-textMuted">
                No bank / e-payment accounts yet.{' '}
                <Link to="/accounts/e-payment" className="text-brand underline">
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
                    {data.recentActivity.map((row) => {
                      const dir = row.direction ?? 'neutral';
                      const amountClass =
                        dir === 'in' ? 'text-success font-semibold' : dir === 'out' ? 'text-danger font-semibold' : '';
                      const prefix = dir === 'in' ? '+ ' : dir === 'out' ? '− ' : '';
                      return (
                        <tr key={row.id} className="border-b border-border/60">
                          <td className="py-2 pr-2 whitespace-nowrap">{formatDate(row.date)}</td>
                          <td className="py-2 pr-2">#{row.number}</td>
                          <td className="py-2 pr-2">{row.type}</td>
                          <td className="py-2 pr-2">{row.accountLabel}</td>
                          <td className={`py-2 text-right tabular-nums ${amountClass}`}>
                            {prefix}Rs {formatMoney(row.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </PageShell>
  );
}
