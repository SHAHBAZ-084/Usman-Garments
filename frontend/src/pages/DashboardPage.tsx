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
import {
  HandCoins,
  Package,
  Plus,
  Receipt,
  ScanBarcode,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import {
  ClickableMetricTile,
  Feedback,
  LoadingState,
  MetricSkeletonGrid,
  PageShell,
  Panel,
  PrimaryButton,
} from '../components/ui/PageShell';
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
  { label: 'New Sale', to: '/sales/new', icon: ShoppingCart },
  { label: 'Add Product', to: '/products/add', icon: Plus },
  { label: 'Add Purchase', to: '/purchases/new', icon: Package },
  { label: 'Print Barcode', to: '/products/scan', icon: ScanBarcode },
  { label: 'Add Expense', to: '/finance/expenses/new', icon: Wallet },
  { label: 'Receive Payment', to: '/customers/pay', icon: HandCoins },
  { label: 'Pay Supplier', to: '/purchases/pay', icon: Receipt },
] as const;

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DashboardPage() {
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [fromDate, setFromDate] = useState(todayInput());
  const [toDate, setToDate] = useState(todayInput());
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ lastBackupAt: string | null; ok: boolean } | null>(null);
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
      try {
        const health = await api.getSystemHealth();
        setBackupStatus({
          lastBackupAt: health.backup.lastBackupAt,
          ok: Boolean(health.backup.lastBackupAt),
        });
      } catch {
        setBackupStatus(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [preset, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const dash = data;

  return (
    <PageShell title="Dashboard" subtitle="Shop overview — tap any figure to open its report">
      {error ? <Feedback variant="error" className="mb-3">{error}</Feedback> : null}
      {backupStatus ? (
        <Feedback variant={backupStatus.ok ? 'info' : 'warning'} className="mb-3">
          Last backup: {backupStatus.lastBackupAt ? formatDate(backupStatus.lastBackupAt) : 'Never'} —{' '}
          <Link to="/system/health" className="font-medium underline">
            System Health
          </Link>
        </Feedback>
      ) : null}

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
          {loading ? <LoadingState label="Updating…" /> : null}
        </div>
        {dash ? (
          <p className="mt-2 text-xs text-textMuted">Showing: {dash.range.label}</p>
        ) : null}
      </Panel>

      {loading && !dash ? (
        <MetricSkeletonGrid count={18} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <ClickableMetricTile label="Gross Sales" value={dash ? formatMoney(dash.grossSales) : '—'} to="/reports/sales/range" />
          <ClickableMetricTile label="Discounts" value={dash ? formatMoney(dash.discounts) : '—'} to="/reports/sales/range" accent="info" />
          <ClickableMetricTile label="Returns" value={dash ? formatMoney(dash.saleReturns) : '—'} to="/reports/sales/returns-exchanges" accent="warning" />
          <ClickableMetricTile label="Net Sales" value={dash ? formatMoney(dash.netSales) : '—'} to="/reports/sales/range" accent="success" />
          <ClickableMetricTile label="COGS" value={dash ? formatMoney(dash.costOfGoodsSold) : '—'} to="/reports/sales/product-profit" />
          <ClickableMetricTile label="Gross Profit" value={dash ? formatMoney(dash.grossProfit) : '—'} to="/reports/sales/product-profit" accent="success" />
          <ClickableMetricTile label="Expenses" value={dash ? formatMoney(dash.expenses) : '—'} to="/reports/expenses/range" accent="warning" />
          <ClickableMetricTile label="Other Income" value={dash ? formatMoney(dash.otherIncome) : '—'} to="/reports/other-income" accent="success" />
          <ClickableMetricTile label="Net Profit" value={dash ? formatMoney(dash.netProfit) : '—'} to="/reports/sales/product-profit" accent={dash && dash.netProfit >= 0 ? 'success' : 'danger'} />
          <ClickableMetricTile label="Cash Received" value={dash ? formatMoney(dash.cashReceived) : '—'} to="/reports/sales/payment-methods" accent="success" />
          <ClickableMetricTile label="Udhaar Sales" value={dash ? formatMoney(dash.udhaarSales) : '—'} to="/reports/sales/udhaar" accent="warning" />
          <ClickableMetricTile label="Customer Outstanding" value={dash ? formatMoney(dash.customerOutstanding) : '—'} to="/reports/customers/balances" accent="warning" />
          <ClickableMetricTile label="Supplier Outstanding" value={dash ? formatMoney(dash.supplierOutstanding) : '—'} to="/reports/suppliers/outstanding" accent="warning" />
          <ClickableMetricTile label="Stock Cost Value" value={dash ? formatMoney(dash.stockCostValue) : '—'} to="/reports/stock/valuation" />
          <ClickableMetricTile
            label="Expected Selling Value"
            value={dash ? formatMoney(dash.expectedSellingValue) : '—'}
            sub="Potential margin on unsold inventory — not actual profit"
            to="/reports/stock/valuation"
            accent="info"
          />
          <ClickableMetricTile label="Invoices" value={dash ? String(dash.invoiceCount) : '—'} to="/sales" />
          <ClickableMetricTile label="Low Stock" value={dash ? String(dash.lowStockCount) : '—'} to="/reports/stock/low" accent="warning" />
          <ClickableMetricTile label="Out of Stock" value={dash ? String(dash.outOfStockCount) : '—'} to="/reports/stock/out" accent="danger" />
        </div>
      )}

      {dash ? (
        <Panel className="mt-4">
          <p className="mb-2 text-sm font-semibold">Purchases (separate from sales)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ClickableMetricTile label="Today" value={formatMoney(dash.purchases.today)} to="/reports/purchases" />
            <ClickableMetricTile label="This Month" value={formatMoney(dash.purchases.month)} to="/reports/purchases" />
            <ClickableMetricTile label="This Year" value={formatMoney(dash.purchases.year)} to="/reports/purchases" />
            <ClickableMetricTile label="Lifetime" value={formatMoney(dash.purchases.lifetime)} to="/reports/purchases" />
          </div>
        </Panel>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Sales chart</h2>
          {dash?.salesChart.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dash.salesChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l) => formatDate(l)} />
                <Bar dataKey="netSales" fill="var(--fill-accent)" name="Net Sales" />
              </BarChart>
            </ResponsiveContainer>
          ) : loading ? (
            <LoadingState />
          ) : (
            <p className="text-sm text-textMuted">No sales in selected period.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Top selling products</h2>
          {dash?.topSellingProducts.length ? (
            <table className="app-data-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="py-1 pr-2 font-medium">Product</th>
                  <th className="py-1 pr-2 font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {dash.topSellingProducts.map((p) => (
                  <tr key={p.productId}>
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
          {dash?.recentSales.length ? (
            <ul className="space-y-2 text-sm">
              {dash.recentSales.map((s) => (
                <li key={s.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <Link to={`/sales/${s.id}`} className="font-medium text-accent hover:underline">
                    {s.invoiceNumber}
                  </Link>
                  <span className="text-success">{formatMoney(s.totalAmount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-textMuted">No recent sales.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Recent expenses</h2>
          {dash?.recentExpenses.length ? (
            <ul className="space-y-2 text-sm">
              {dash.recentExpenses.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="truncate">{e.description}</span>
                  <span className="text-warning">{formatMoney(e.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-textMuted">No recent expenses.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-semibold">Low stock</h2>
          {dash?.lowStockProducts.length ? (
            <ul className="space-y-2 text-sm">
              {dash.lowStockProducts.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <Link to={`/products/${p.id}`} className="truncate hover:underline">
                    {p.name}
                  </Link>
                  <span className="font-medium text-warning">{p.currentStock} left</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-success">All stocked up.</p>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.to}
                to={a.to}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface2 px-3 py-2 text-sm font-medium text-textPrimary shadow-sm transition hover:border-accent hover:bg-bgAccent"
              >
                <Icon className="h-4 w-4 text-accent" aria-hidden />
                {a.label}
              </Link>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
