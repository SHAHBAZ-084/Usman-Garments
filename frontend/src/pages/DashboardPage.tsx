import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageShell, Panel, PrimaryButton, Tile } from '../components/ui/PageShell';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { api, type DashboardPayload, type DateRangePreset } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom' },
];

const QUICK_ACTIONS = [
  { label: 'New Sale', to: '/sales/new' },
  { label: 'Add Product', to: '/products/add' },
  { label: 'Add Purchase', to: '/purchases/new' },
  { label: 'Print Barcode', to: '/products/scan' },
  { label: 'Add Expense', to: '/finance/expenses/new' },
  { label: 'Receive Payment', to: '/customers/pay' },
  { label: 'Pay Supplier', to: '/purchases/pay' },
] as const;

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Tile className="border-l-4 border-brand/60">
      <p className="text-xs font-medium text-textSecondary">{label}</p>
      <p className="mt-1 text-lg font-semibold text-textPrimary">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-textMuted">{sub}</p> : null}
    </Tile>
  );
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DashboardPage() {
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [fromDate, setFromDate] = useState(todayInput());
  const [toDate, setToDate] = useState(todayInput());
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getShopDashboard({
        preset,
        fromDate: preset === 'custom' ? fromDate : undefined,
        toDate: preset === 'custom' ? toDate : undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [preset, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell title="Dashboard" subtitle="Shop overview — all figures from unified financial summary">
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-xs font-medium text-textMuted">Period</p>
            <SegmentedControl
              value={preset}
              onChange={(v) => setPreset(v as DateRangePreset)}
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
          </div>
          {preset === 'custom' ? (
            <>
              <label className="text-xs">
                From
                <input type="date" className="ml-1 rounded border border-border px-2 py-1 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label className="text-xs">
                To
                <input type="date" className="ml-1 rounded border border-border px-2 py-1 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
              <PrimaryButton type="button" onClick={() => void load()} disabled={loading}>
                Apply
              </PrimaryButton>
            </>
          ) : null}
          {loading ? <span className="text-xs text-textMuted">Updating…</span> : null}
        </div>
        {data ? (
          <p className="mt-2 text-xs text-textMuted">Showing: {data.range.label}</p>
        ) : null}
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <MetricTile label="Gross Sales" value={data ? formatMoney(data.grossSales) : '—'} />
        <MetricTile label="Discounts" value={data ? formatMoney(data.discounts) : '—'} />
        <MetricTile label="Returns" value={data ? formatMoney(data.saleReturns) : '—'} />
        <MetricTile label="Net Sales" value={data ? formatMoney(data.netSales) : '—'} />
        <MetricTile label="COGS" value={data ? formatMoney(data.costOfGoodsSold) : '—'} />
        <MetricTile label="Gross Profit" value={data ? formatMoney(data.grossProfit) : '—'} />
        <MetricTile label="Expenses" value={data ? formatMoney(data.expenses) : '—'} />
        <MetricTile label="Other Income" value={data ? formatMoney(data.otherIncome) : '—'} />
        <MetricTile label="Net Profit" value={data ? formatMoney(data.netProfit) : '—'} />
        <MetricTile label="Cash Received" value={data ? formatMoney(data.cashReceived) : '—'} />
        <MetricTile label="Udhaar Sales" value={data ? formatMoney(data.udhaarSales) : '—'} />
        <MetricTile label="Customer Outstanding" value={data ? formatMoney(data.customerOutstanding) : '—'} />
        <MetricTile label="Supplier Outstanding" value={data ? formatMoney(data.supplierOutstanding) : '—'} />
        <MetricTile label="Stock Cost Value" value={data ? formatMoney(data.stockCostValue) : '—'} />
        <MetricTile
          label="Expected Selling Value"
          value={data ? formatMoney(data.expectedSellingValue) : '—'}
          sub="Potential margin on unsold inventory — not actual profit"
        />
        <MetricTile label="Invoices" value={data ? String(data.invoiceCount) : '—'} />
        <MetricTile label="Low Stock" value={data ? String(data.lowStockCount) : '—'} />
        <MetricTile label="Out of Stock" value={data ? String(data.outOfStockCount) : '—'} />
      </div>

      {data ? (
        <Panel className="mt-4">
          <p className="mb-2 text-sm font-semibold">Purchases (separate from sales)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile label="Today" value={formatMoney(data.purchases.today)} />
            <MetricTile label="This Month" value={formatMoney(data.purchases.month)} />
            <MetricTile label="This Year" value={formatMoney(data.purchases.year)} />
            <MetricTile label="Lifetime" value={formatMoney(data.purchases.lifetime)} />
          </div>
        </Panel>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Sales chart</h2>
          {data?.salesChart.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.salesChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l) => formatDate(l)} />
                <Bar dataKey="netSales" fill="#78716c" name="Net Sales" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-textMuted">No sales in selected period.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Top selling products</h2>
          {data?.topSellingProducts.length ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-textMuted">
                  <th className="py-1 pr-2 font-medium">Product</th>
                  <th className="py-1 pr-2 font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topSellingProducts.map((p) => (
                  <tr key={p.productId} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2">{p.name}</td>
                    <td className="py-1.5 pr-2">{p.quantitySold}</td>
                    <td className="py-1.5 text-right">{formatMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-textMuted">No sales data.</p>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Recent sales</h2>
          {data?.recentSales.length ? (
            <ul className="space-y-2 text-sm">
              {data.recentSales.map((s) => (
                <li key={s.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <Link to={`/sales/${s.id}`} className="font-medium text-brand hover:underline">
                    {s.invoiceNumber}
                  </Link>
                  <span>{formatMoney(s.totalAmount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-textMuted">No recent sales.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Recent expenses</h2>
          {data?.recentExpenses.length ? (
            <ul className="space-y-2 text-sm">
              {data.recentExpenses.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="truncate">{e.description}</span>
                  <span>{formatMoney(e.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-textMuted">No recent expenses.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Low stock</h2>
          {data?.lowStockProducts.length ? (
            <ul className="space-y-2 text-sm">
              {data.lowStockProducts.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <Link to={`/products/${p.id}`} className="truncate hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-danger">{p.currentStock} left</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-textMuted">All stocked up.</p>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="inline-flex items-center rounded-md border border-border bg-bgSecondary px-3 py-1.5 text-sm font-medium text-textPrimary shadow-sm hover:bg-bgAccent"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
