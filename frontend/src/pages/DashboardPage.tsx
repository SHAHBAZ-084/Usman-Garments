import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell, Tile } from '../components/ui/PageShell';
import { api } from '../lib/api';
import { formatLedgerAmount, formatVoucherNumber, formatVoucherTypeLabel, voucherTypeColorClass } from '../lib/format';

type DashboardSummary = Awaited<ReturnType<typeof api.getDashboardSummary>>;

type MetricTone = 'cash' | 'receivables' | 'payables' | 'vouchers';

const METRIC_STYLES: Record<MetricTone, { card: string; value: string }> = {
  cash: {
    card: 'border-l-4 border-metricCashAccent bg-metricCashBg',
    value: 'text-metricCashAccent',
  },
  receivables: {
    card: 'border-l-4 border-metricReceivablesAccent bg-metricReceivablesBg',
    value: 'text-metricReceivablesAccent',
  },
  payables: {
    card: 'border-l-4 border-metricPayablesAccent bg-metricPayablesBg',
    value: 'text-metricPayablesAccent',
  },
  vouchers: {
    card: 'border-l-4 border-metricVouchersAccent bg-metricVouchersBg',
    value: 'text-metricVouchersAccent',
  },
};

const VOUCHER_ACTIONS = [
  { label: 'Payment Voucher', to: '/vouchers/payment', card: 'border-l-4 border-voucherPayment bg-bgDanger hover:border-voucherPayment', title: 'text-voucherPayment' },
  { label: 'Receipt Voucher', to: '/vouchers/receipt', card: 'border-l-4 border-voucherReceipt bg-bgSuccess hover:border-voucherReceipt', title: 'text-voucherReceipt' },
  { label: 'Journal Voucher', to: '/vouchers/journal', card: 'border-l-4 border-voucherJournal bg-bgAccent hover:border-voucherJournal', title: 'text-voucherJournal' },
] as const;

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: MetricTone;
}) {
  const style = METRIC_STYLES[tone];
  return (
    <Tile className={style.card}>
      <p className="text-xs font-medium text-textSecondary">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold leading-tight ${style.value}`}>{value}</p>
    </Tile>
  );
}

function ActionCard({
  to,
  title,
  description,
  cardClassName,
  titleClassName,
}: {
  to: string;
  title: string;
  description: string;
  cardClassName: string;
  titleClassName: string;
}) {
  return (
    <Link
      to={to}
      className={`rounded-lg border border-border p-3 shadow-sm transition ${cardClassName}`}
    >
      <h3 className={`text-sm font-semibold ${titleClassName}`}>{title}</h3>
      <p className="mt-1 text-xs text-textSecondary">{description}</p>
    </Link>
  );
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .getDashboardSummary()
      .then(setSummary)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, []);

  return (
    <PageShell title="Dashboard" subtitle="Accounting dashboard">
      {loadError ? <p className="mb-4 text-sm text-danger">{loadError}</p> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Cash Balance"
          value={summary ? formatLedgerAmount(summary.cashBalance) : '—'}
          tone="cash"
        />
        <MetricCard
          label="Receivables"
          value={summary ? formatLedgerAmount(summary.receivables) : '—'}
          tone="receivables"
        />
        <MetricCard
          label="Payables"
          value={summary ? formatLedgerAmount(summary.payables) : '—'}
          tone="payables"
        />
        <MetricCard
          label="Vouchers Today"
          value={summary ? String(summary.vouchersToday) : '—'}
          tone="vouchers"
        />
      </div>

      <Tile className="mt-4">
        <h2 className="mb-3 text-base font-semibold text-textPrimary">Recent vouchers</h2>

        {!summary ? (
          <p className="text-sm text-textMuted">Loading…</p>
        ) : summary.recentVouchers.length === 0 ? (
          <p className="text-sm text-textMuted">No vouchers posted yet this year.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-textMuted">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentVouchers.map((v) => (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs font-semibold text-financial">
                      {formatVoucherNumber(v.number, v.type)}
                    </td>
                    <td className="py-2 pr-3 text-textSecondary">{v.accountLabel}</td>
                    <td className={`py-2 pr-3 font-medium ${voucherTypeColorClass(v.type)}`}>
                      {formatVoucherTypeLabel(v.type)}
                    </td>
                    <td className="py-2 text-right font-medium text-textPrimary">
                      {formatLedgerAmount(v.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">New voucher</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {VOUCHER_ACTIONS.map((action) => (
            <ActionCard
              key={action.to}
              to={action.to}
              title={action.label}
              description="Open voucher form"
              cardClassName={action.card}
              titleClassName={action.title}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
