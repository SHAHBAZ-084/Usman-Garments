import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type DateRangePreset, type PaginatedResult } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { downloadCsv, downloadExcel, downloadPdf, type ReportExportMeta } from '../../lib/reportExport';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Printer } from 'lucide-react';
import {
  FieldLabel,
  Feedback,
  IconButton,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';

export function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthStartInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const PRESET_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom' },
];

type ReportShellProps = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  loading: boolean;
  error: string;
  onLoad: () => void;
  children?: ReactNode;
  preset?: DateRangePreset;
  onPresetChange?: (p: DateRangePreset) => void;
  fromDate?: string;
  toDate?: string;
  onFromDate?: (v: string) => void;
  onToDate?: (v: string) => void;
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  page?: number;
  totalPages?: number;
  onPage?: (p: number) => void;
  summary?: ReactNode;
  exportMeta?: ReportExportMeta;
};

export function ReportShell({
  title,
  subtitle,
  headers,
  rows,
  loading,
  error,
  onLoad,
  children,
  preset,
  onPresetChange,
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  search,
  onSearch,
  searchPlaceholder,
  page,
  totalPages,
  onPage,
  summary,
  exportMeta,
}: ReportShellProps) {
  const [businessMeta, setBusinessMeta] = useState<ReportExportMeta>({});

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => setBusinessMeta({ businessName: settings.businessName }))
      .catch(() => undefined);
  }, []);

  const meta: ReportExportMeta = {
    ...businessMeta,
    ...exportMeta,
    generatedAt: exportMeta?.generatedAt ?? new Date().toLocaleString(),
  };

  function exportReport(format: 'pdf' | 'excel' | 'csv') {
    const base = title.replace(/\s+/g, '-').toLowerCase();
    if (format === 'pdf') downloadPdf(`${base}.pdf`, title, headers, rows, meta);
    else if (format === 'excel') downloadExcel(`${base}.xlsx`, title.slice(0, 31), headers, rows, meta);
    else downloadCsv(`${base}.csv`, headers, rows, meta);
  }

  function printReport() {
    const headerBlock = [
      meta.businessName ? `<h2 style="margin:0 0 4px">${meta.businessName}</h2>` : '',
      meta.dateRange ? `<p style="margin:0 0 8px;color:#666">Period: ${meta.dateRange}</p>` : '',
    ].join('');
    const html = `<html><head><title>${title}</title><style>
      body{font-family:Arial,sans-serif;padding:16px;color:#111}
      table{border-collapse:collapse;width:100%;margin-top:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}
      th{background:#111;color:#fff}
      tr:nth-child(even){background:#f7f7f7}
      .num{text-align:right}
    </style></head><body>${headerBlock}<h1 style="margin:0 0 8px;font-size:18px">${title}</h1>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  }

  return (
    <PageShell title={title} subtitle={subtitle}>
      <Panel className="mb-4 space-y-3">
        {onPresetChange && preset ? (
          <SegmentedControl value={preset} onChange={(v) => onPresetChange(v as DateRangePreset)} options={PRESET_OPTIONS} />
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          {preset === 'custom' && onFromDate && onToDate ? (
            <>
              <FieldLabel>From</FieldLabel>
              <TextInput type="date" value={fromDate ?? ''} onChange={(e) => onFromDate(e.target.value)} />
              <FieldLabel>To</FieldLabel>
              <TextInput type="date" value={toDate ?? ''} onChange={(e) => onToDate(e.target.value)} />
            </>
          ) : null}
          {onSearch ? (
            <>
              <FieldLabel>Search</FieldLabel>
              <TextInput value={search ?? ''} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder ?? 'Search…'} />
            </>
          ) : null}
          {children}
          <PrimaryButton type="button" onClick={onLoad} disabled={loading}>
            {loading ? 'Loading…' : 'Load Report'}
          </PrimaryButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton type="button" onClick={() => exportReport('pdf')} disabled={!rows.length}>
            Download PDF
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => exportReport('excel')} disabled={!rows.length}>
            Download Excel
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => exportReport('csv')} disabled={!rows.length}>
            Download CSV
          </SecondaryButton>
          <IconButton
            icon={Printer}
            label="Print report"
            variant="neutral"
            size="md"
            onClick={printReport}
            disabled={!rows.length}
          >
            Print
          </IconButton>
        </div>
        {error ? <Feedback variant="error">{error}</Feedback> : null}
        {summary}
      </Panel>

      <Panel>
        <div className="overflow-x-auto">
          <table className="app-data-table w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-textMuted">
                {headers.map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="py-4 text-textMuted">
                    {loading ? 'Loading…' : 'Load report to see data.'}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="py-2 pr-3">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {page != null && totalPages != null && onPage && totalPages > 1 ? (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <SecondaryButton type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Prev
            </SecondaryButton>
            <span>
              Page {page} of {totalPages}
            </span>
            <SecondaryButton type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
              Next
            </SecondaryButton>
          </div>
        ) : null}
      </Panel>
    </PageShell>
  );
}

function usePaginatedReport<T extends Record<string, unknown>>(
  path: string,
  mapRow: (item: T) => (string | number)[],
  mapHeaders: () => string[],
) {
  const [preset, setPreset] = useState<DateRangePreset>('month');
  const [fromDate, setFromDate] = useState(monthStartInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PaginatedResult<T> | null>(null);
  const [extraParams, setExtraParams] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<PaginatedResult<T>>(path, {
        preset,
        fromDate: preset === 'custom' ? fromDate : undefined,
        toDate: preset === 'custom' ? toDate : undefined,
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        ...extraParams,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [path, preset, fromDate, toDate, page, debouncedSearch, extraParams]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, preset]);

  const headers = mapHeaders();
  const rows = (result?.items ?? []).map(mapRow);

  return {
    preset,
    setPreset,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    search,
    setSearch,
    page,
    setPage,
    loading,
    error,
    load,
    headers,
    rows,
    totalPages: result?.totalPages ?? 1,
    setExtraParams,
  };
}

function reportDateRangeLabel(preset: DateRangePreset, fromDate: string, toDate: string): string {
  if (preset === 'custom') return `${fromDate} – ${toDate}`;
  const labels: Record<DateRangePreset, string> = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    year: 'This Year',
    lifetime: 'Lifetime',
    custom: `${fromDate} – ${toDate}`,
  };
  return labels[preset] ?? preset;
}

function bindPaginatedReport(
  r: ReturnType<typeof usePaginatedReport>,
  overrides: Partial<ReportShellProps> = {},
): ReportShellProps {
  return {
    preset: r.preset,
    onPresetChange: r.setPreset,
    fromDate: r.fromDate,
    toDate: r.toDate,
    onFromDate: r.setFromDate,
    onToDate: r.setToDate,
    search: r.search,
    onSearch: r.setSearch,
    page: r.page,
    totalPages: r.totalPages,
    onPage: r.setPage,
    loading: r.loading,
    error: r.error,
    onLoad: () => void r.load(),
    headers: r.headers,
    rows: r.rows,
    title: '',
    exportMeta: { dateRange: reportDateRangeLabel(r.preset, r.fromDate, r.toDate) },
    ...overrides,
  };
}

// ─── Sales reports ───────────────────────────────────────────────────────────

export function SalesRangeReportPage() {
  const r = usePaginatedReport<{ date: string; invoiceNumber: string; customerName: string | null; totalAmount: number; paidAmount: number; remainingAmount: number; paymentMethod: string }>(
    '/sales/range',
    (i) => [formatDate(i.date), i.invoiceNumber, i.customerName ?? 'Walk-in', formatMoney(i.totalAmount), formatMoney(i.paidAmount), formatMoney(i.remainingAmount), i.paymentMethod],
    () => ['Date', 'Invoice', 'Customer', 'Total', 'Paid', 'Remaining', 'Method'],
  );
  return (
    <ReportShell
      {...bindPaginatedReport(r, {
        title: 'Sales — Date Range',
        subtitle: 'All active invoices in period',
        searchPlaceholder: 'Invoice or customer…',
      })}
    />
  );
}

export function ProductProfitReportPage() {
  const r = usePaginatedReport<{ name: string; sku: string; categoryName: string | null; quantitySold: number; revenue: number; costOfGoodsSold: number; grossProfit: number }>(
    '/sales/product-profit',
    (i) => [i.name, i.sku, i.categoryName ?? '—', i.quantitySold, formatMoney(i.revenue), formatMoney(i.costOfGoodsSold), formatMoney(i.grossProfit)],
    () => ['Product', 'SKU', 'Category', 'Qty', 'Revenue', 'COGS', 'Gross Profit'],
  );
  return (
    <ReportShell
      {...bindPaginatedReport(r, {
        title: 'Product-wise Profit',
        subtitle: 'Uses historical costAtSale — not current purchase price',
      })}
    />
  );
}

export function CategoryProfitReportPage() {
  const r = usePaginatedReport<{ categoryName: string; quantitySold: number; revenue: number; costOfGoodsSold: number; grossProfit: number }>(
    '/sales/category-profit',
    (i) => [i.categoryName, i.quantitySold, formatMoney(i.revenue), formatMoney(i.costOfGoodsSold), formatMoney(i.grossProfit)],
    () => ['Category', 'Qty', 'Revenue', 'COGS', 'Gross Profit'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Category-wise Profit' })} />;
}

export function InvoiceProfitReportPage() {
  const r = usePaginatedReport<{ date: string; invoiceNumber: string; customerName: string | null; netSales: number; costOfGoodsSold: number; grossProfit: number }>(
    '/sales/invoice-profit',
    (i) => [formatDate(i.date), i.invoiceNumber, i.customerName ?? 'Walk-in', formatMoney(i.netSales), formatMoney(i.costOfGoodsSold), formatMoney(i.grossProfit)],
    () => ['Date', 'Invoice', 'Customer', 'Net Sales', 'COGS', 'Gross Profit'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Invoice-wise Profit' })} />;
}

export function UdhaarSalesReportPage() {
  const r = usePaginatedReport<{ date: string; invoiceNumber: string; customerName: string | null; totalAmount: number; udhaarAmount: number }>(
    '/sales/udhaar',
    (i) => [formatDate(i.date), i.invoiceNumber, i.customerName ?? '—', formatMoney(i.totalAmount), formatMoney(i.udhaarAmount)],
    () => ['Date', 'Invoice', 'Customer', 'Total', 'Udhaar'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Udhaar Sales' })} />;
}

export function PaymentMethodReportPage() {
  const [preset, setPreset] = useState<DateRangePreset>('month');
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Method', 'Invoices', 'Total', 'Paid'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<Array<{ paymentMethod: string; invoiceCount: number; totalAmount: number; paidAmount: number }>>('/sales/payment-methods', { preset });
      setRows(data.map((d) => [d.paymentMethod, d.invoiceCount, formatMoney(d.totalAmount), formatMoney(d.paidAmount)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell title="Payment Method Breakdown" headers={headers} rows={rows} loading={loading} error={error} onLoad={() => void load()} preset={preset} onPresetChange={setPreset} />
  );
}

export function ReturnsExchangesReportPage() {
  const [preset, setPreset] = useState<DateRangePreset>('month');
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Type', 'Date', 'Invoice', 'Amount', 'Note'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<{ returns: PaginatedResult<{ date: string; invoiceNumber: string; totalAmount: number; isExchange: boolean }>; exchanges: Array<{ date: string; invoiceNumber: string; netAmount: number }> }>('/sales/returns-exchanges', { preset, page: 1, pageSize: 50 });
      const returnRows = data.returns.items.map((r) => ['Return', formatDate(r.date), r.invoiceNumber, formatMoney(r.totalAmount), r.isExchange ? 'Exchange' : '']);
      const exchangeRows = data.exchanges.map((e) => ['Exchange', formatDate(e.date), e.invoiceNumber, formatMoney(e.netAmount), '']);
      setRows([...returnRows, ...exchangeRows]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell title="Returns & Exchanges" headers={headers} rows={rows} loading={loading} error={error} onLoad={() => void load()} preset={preset} onPresetChange={setPreset} />
  );
}

export function DailySalesReportPage() {
  const [searchParams] = useSearchParams();
  const initialPreset = (searchParams.get('preset') as DateRangePreset) || 'today';
  const [preset, setPreset] = useState<DateRangePreset>(
    ['today', 'week', 'month', 'year', 'lifetime', 'custom'].includes(initialPreset) ? initialPreset : 'today',
  );
  const [fromDate, setFromDate] = useState(monthStartInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [breakdown, setBreakdown] = useState<{
    range: { label: string };
    totalCollected: number;
    cash: number;
    ePayment: number;
    udhaar: number;
    byAccount: Array<{ accountName: string; amount: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Date', 'Invoices', 'Gross', 'Discounts', 'Net Sales', 'Cash taken'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [daily, collection] = await Promise.all([
        api.fetchReport<
          PaginatedResult<{
            date: string;
            invoiceCount: number;
            grossSales: number;
            discounts: number;
            netSales: number;
            cashReceived: number;
          }>
        >('/sales/daily', {
          fromDate: preset === 'custom' ? fromDate : undefined,
          toDate: preset === 'custom' ? toDate : undefined,
          preset,
          page: 1,
          pageSize: 100,
        }),
        api.fetchReport<{
          range: { label: string };
          totalCollected: number;
          cash: number;
          ePayment: number;
          udhaar: number;
          byAccount: Array<{ accountName: string; amount: number }>;
        }>('/sales/collection-breakdown', {
          preset,
          fromDate: preset === 'custom' ? fromDate : undefined,
          toDate: preset === 'custom' ? toDate : undefined,
        }),
      ]);
      setRows(
        daily.items.map((d) => [
          d.date,
          d.invoiceCount,
          formatMoney(d.grossSales),
          formatMoney(d.discounts),
          formatMoney(d.netSales),
          formatMoney(d.cashReceived),
        ]),
      );
      setBreakdown(collection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
      setBreakdown(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when period changes
  }, [preset, fromDate, toDate]);

  return (
    <PageShell
      title="Sales report"
      subtitle="Choose day, week, month, year, or custom dates — see cash vs e-payment clearly"
      wide
      actions={
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            type="button"
            disabled={!breakdown && rows.length === 0}
            onClick={() => {
              const headers = ['Section', 'Account / metric', 'Amount'];
              const exportRows: (string | number)[][] = [];
              if (breakdown) {
                exportRows.push(['Summary', 'Total collected', breakdown.totalCollected]);
                exportRows.push(['Summary', 'Cash', breakdown.cash]);
                exportRows.push(['Summary', 'E-payment', breakdown.ePayment]);
                exportRows.push(['Summary', 'Udhaar still open', breakdown.udhaar]);
                for (const row of breakdown.byAccount) {
                  exportRows.push(['Landed', row.accountName, row.amount]);
                }
              }
              for (const row of rows) {
                exportRows.push(['Daily', ...row]);
              }
              downloadExcel('sales-report.xlsx', 'Sales', headers, exportRows);
            }}
          >
            Download Excel
          </SecondaryButton>
          <SecondaryButton
            type="button"
            disabled={!breakdown && rows.length === 0}
            onClick={() => {
              const headers = ['Date', 'Invoices', 'Gross', 'Discounts', 'Net Sales', 'Cash taken'];
              downloadPdf(
                'sales-report.pdf',
                `Sales report — ${breakdown?.range.label ?? preset}`,
                headers,
                rows,
              );
            }}
          >
            Download PDF
          </SecondaryButton>
        </div>
      }
    >
      <Panel className="mb-4">
        <p className="mb-2 text-xs font-medium text-textMuted">Period</p>
        <SegmentedControl
          value={preset}
          onChange={(v) => setPreset(v as DateRangePreset)}
          options={PRESET_OPTIONS}
        />
        {preset === 'custom' ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <div>
              <FieldLabel>From</FieldLabel>
              <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel>To</FieldLabel>
              <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        ) : null}
        {error ? <Feedback variant="error" className="mt-3">{error}</Feedback> : null}
      </Panel>

      {breakdown ? (
        <Panel className="mb-4">
          <h2 className="text-base font-semibold text-textPrimary">Money collected — {breakdown.range.label}</h2>
          <p className="mt-1 text-sm text-textSecondary">
            Total received in this period: <strong>Rs {formatMoney(breakdown.totalCollected)}</strong>
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-success/35 bg-success/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-textMuted">Cash</p>
              <p className="mt-1 text-2xl font-bold text-success">Rs {formatMoney(breakdown.cash)}</p>
            </div>
            <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-textMuted">E-payment</p>
              <p className="mt-1 text-2xl font-bold text-textPrimary">Rs {formatMoney(breakdown.ePayment)}</p>
            </div>
            <div className="rounded-xl border border-warning/35 bg-warning/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-textMuted">Udhaar still open</p>
              <p className="mt-1 text-2xl font-bold text-warning">Rs {formatMoney(breakdown.udhaar)}</p>
            </div>
          </div>
          {breakdown.byAccount.length > 0 ? (
            <div className="mt-4">
                  <p className="mb-2 text-sm font-semibold text-textPrimary">Where money landed (matches total above)</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {breakdown.byAccount.map((row) => (
                  <li key={row.accountName} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="text-textSecondary">{row.accountName}</span>
                    <span className="font-semibold tabular-nums">Rs {formatMoney(row.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-textMuted">No collection detail for this period yet.</p>
          )}
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-1 text-base font-semibold text-textPrimary">Day-by-day list</h2>
        <p className="mb-3 text-sm text-textSecondary">Each row is one calendar day in the selected period</p>
        {loading ? <p className="text-sm text-textMuted">Loading…</p> : null}
        <div className="overflow-x-auto">
          <table className="app-data-table w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-textMuted">
                {headers.map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="py-4 text-textMuted">
                    {loading ? 'Loading…' : 'No sales in this period.'}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="py-2 pr-3">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageShell>
  );
}

// ─── Stock reports ───────────────────────────────────────────────────────────

export function CurrentStockReportPage() {
  const r = usePaginatedReport<{ name: string; sku: string; categoryName: string | null; currentStock: number; costValue: number; sellingValue: number }>(
    '/stock/current',
    (i) => [i.name, i.sku, i.categoryName ?? '—', i.currentStock, formatMoney(i.costValue), formatMoney(i.sellingValue)],
    () => ['Product', 'SKU', 'Category', 'Stock', 'Cost Value', 'Selling Value'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Current Stock' })} />;
}

export function LowStockReportPage() {
  const [limit, setLimit] = useState<number | null>(null);
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [emptyMessage, setEmptyMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<
        PaginatedResult<{ name: string; sku: string; currentStock: number }> & {
          lowStockLimit?: number;
          emptyMessage?: string;
        }
      >('/stock/low', { page: 1, pageSize: 100 });
      setLimit(data.lowStockLimit ?? null);
      setEmptyMessage(data.emptyMessage ?? '');
      setRows(data.items.map((i) => [i.name, i.sku, i.currentStock]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageShell title="Low Stock" subtitle={limit != null ? `Products at or below limit of ${limit}` : 'Products below your stock limit'}>
      <Panel>
        {error ? <Feedback variant="error" className="mb-3">{error}</Feedback> : null}
        {loading ? <p className="text-sm text-textMuted">Loading…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
            {emptyMessage || 'Nothing is low stock from your set limit.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-data-table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-textMuted">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border">
                    {row.map((cell, j) => (
                      <td key={j} className="py-2 pr-3">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}

export function OutOfStockReportPage() {
  const r = usePaginatedReport<{ name: string; sku: string }>(
    '/stock/out',
    (i) => [i.name, i.sku],
    () => ['Product', 'SKU'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Out of Stock' })} />;
}

export function DamagedStockReportPage() {
  const r = usePaginatedReport<{ date: string; productName: string; sku: string; quantity: number; note: string | null }>(
    '/stock/damaged',
    (i) => [formatDate(i.date), i.productName, i.sku, i.quantity, i.note ?? ''],
    () => ['Date', 'Product', 'SKU', 'Qty', 'Note'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Damaged Stock' })} />;
}

export function StockMovementsReportPage() {
  const r = usePaginatedReport<{ date: string; type: string; productName: string; sku: string; quantity: number }>(
    '/stock/movements',
    (i) => [formatDate(i.date), i.type, i.productName, i.sku, i.quantity],
    () => ['Date', 'Type', 'Product', 'SKU', 'Qty'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Stock Movements' })} />;
}

export function StockValuationReportPage() {
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Metric', 'Value'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<{ stockCostValue: number; expectedSellingValue: number; potentialMarginOnUnsoldInventory: number; note: string }>('/stock/valuation');
      setNote(data.note);
      setRows([
        ['Stock Cost Value', formatMoney(data.stockCostValue)],
        ['Expected Selling Value', formatMoney(data.expectedSellingValue)],
        ['Potential Margin (unsold inventory)', formatMoney(data.potentialMarginOnUnsoldInventory)],
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell
      title="Stock Valuation"
      subtitle={note || 'Cost value and expected selling value — not included in net profit'}
      headers={headers}
      rows={rows}
      loading={loading}
      error={error}
      onLoad={() => void load()}
    />
  );
}

// ─── Purchase / Supplier reports ─────────────────────────────────────────────

export function PurchasesReportPage() {
  const [period, setPeriod] = useState<'today' | 'month' | 'year' | 'lifetime'>('month');
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const headers = ['Date', 'Supplier', 'Total', 'Paid', 'Remaining'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<PaginatedResult<{ date: string; supplierName: string; totalAmount: number; paidAmount: number; remainingAmount: number }>>('/purchases', { period, page, pageSize: 20 });
      setRows(data.items.map((p) => [formatDate(p.date), p.supplierName, formatMoney(p.totalAmount), formatMoney(p.paidAmount), formatMoney(p.remainingAmount)]));
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell
      title="Purchases"
      headers={headers}
      rows={rows}
      loading={loading}
      error={error}
      onLoad={() => void load()}
      page={page}
      totalPages={totalPages}
      onPage={setPage}
    >
      <FieldLabel>Period</FieldLabel>
      <select className="rounded border border-border px-2 py-1 text-sm" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="today">Today</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
          <option value="lifetime">Lifetime</option>
        </select>
    </ReportShell>
  );
}

export function SupplierOutstandingReportPage() {
  const r = usePaginatedReport<{ name: string; phone: string; payable: number }>(
    '/suppliers/outstanding',
    (i) => [i.name, i.phone, formatMoney(i.payable)],
    () => ['Supplier', 'Phone', 'Payable'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Supplier Outstanding' })} />;
}

export function SupplierPaymentsReportPage() {
  const r = usePaginatedReport<{ date: string; supplierName: string; amount: number; paymentMethod: string }>(
    '/suppliers/payments',
    (i) => [formatDate(i.date), i.supplierName, formatMoney(i.amount), i.paymentMethod],
    () => ['Date', 'Supplier', 'Amount', 'Method'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Supplier Payments' })} />;
}

export function SupplierPurchasesReportPage() {
  const r = usePaginatedReport<{ date: string; supplierName: string; totalAmount: number }>(
    '/suppliers/purchases',
    (i) => [formatDate(i.date), i.supplierName, formatMoney(i.totalAmount)],
    () => ['Date', 'Supplier', 'Amount'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Supplier Purchases' })} />;
}

export function PurchaseReturnsReportPage() {
  const r = usePaginatedReport<{ date: string; supplierName: string; totalAmount: number }>(
    '/purchases/returns',
    (i) => [formatDate(i.date), i.supplierName, formatMoney(i.totalAmount)],
    () => ['Date', 'Supplier', 'Amount'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Purchase Returns' })} />;
}

// ─── Customer reports ────────────────────────────────────────────────────────

export function CustomerBalancesReportPage() {
  const r = usePaginatedReport<{ name: string; phone: string; balance: number }>(
    '/customers/balances',
    (i) => [i.name, i.phone, formatMoney(i.balance)],
    () => ['Customer', 'Phone', 'Balance'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Customer Balances' })} />;
}

export function CustomerPaymentsReportPage() {
  const r = usePaginatedReport<{ date: string; customerName: string; amount: number; paymentMethod: string }>(
    '/customers/payments',
    (i) => [formatDate(i.date), i.customerName, formatMoney(i.amount), i.paymentMethod],
    () => ['Date', 'Customer', 'Amount', 'Method'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Customer Payments' })} />;
}

export function CustomerPurchasesReportPage() {
  const r = usePaginatedReport<{ date: string; invoiceNumber: string; customerName: string | null; totalAmount: number; remainingAmount: number }>(
    '/customers/purchases',
    (i) => [formatDate(i.date), i.invoiceNumber, i.customerName ?? '—', formatMoney(i.totalAmount), formatMoney(i.remainingAmount)],
    () => ['Date', 'Invoice', 'Customer', 'Total', 'Udhaar'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Customer Purchases' })} />;
}

// ─── Expense reports ─────────────────────────────────────────────────────────

export function ExpensesRangeReportPage() {
  const r = usePaginatedReport<{ date: string; categoryName: string; description: string; amount: number }>(
    '/expenses/range',
    (i) => [formatDate(i.date), i.categoryName, i.description, formatMoney(i.amount)],
    () => ['Date', 'Category', 'Description', 'Amount'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Expenses — Date Range' })} />;
}

export function ExpensesDailyReportPage() {
  const [fromDate, setFromDate] = useState(monthStartInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Date', 'Count', 'Total'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<PaginatedResult<{ date: string; expenseCount: number; totalAmount: number }>>('/expenses/daily', { fromDate, toDate, page: 1, pageSize: 100 });
      setRows(data.items.map((d) => [d.date, d.expenseCount, formatMoney(d.totalAmount)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell title="Daily Expenses" headers={headers} rows={rows} loading={loading} error={error} onLoad={() => void load()} preset="custom" fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} />
  );
}

export function ExpensesByCategoryReportPage() {
  const [preset, setPreset] = useState<DateRangePreset>('month');
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const headers = ['Category', 'Count', 'Total'];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchReport<Array<{ categoryName: string; expenseCount: number; totalAmount: number }>>('/expenses/by-category', { preset });
      setRows(data.map((d) => [d.categoryName, d.expenseCount, formatMoney(d.totalAmount)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return <ReportShell title="Expenses by Category" headers={headers} rows={rows} loading={loading} error={error} onLoad={() => void load()} preset={preset} onPresetChange={setPreset} />;
}

export function OtherIncomeReportPage() {
  const r = usePaginatedReport<{ date: string; categoryName: string; description: string; amount: number }>(
    '/other-income',
    (i) => [formatDate(i.date), i.categoryName, i.description, formatMoney(i.amount)],
    () => ['Date', 'Category', 'Description', 'Amount'],
  );
  return <ReportShell {...bindPaginatedReport(r, { title: 'Other Income' })} />;
}
