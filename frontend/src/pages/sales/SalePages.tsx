import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { printInvoice } from '../../components/sales/InvoicePrint';
import { useFormShortcuts } from '../../hooks/useFormShortcuts';
import {
  api,
  type BarcodeLookupResult,
  type BusinessSettings,
  type CreateSaleInput,
  type Customer,
  type Invoice,
  type Product,
  type SalePaymentMethod,
} from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { shortcutLabel } from '../../lib/shortcuts';
import { Printer, Trash2 } from 'lucide-react';
import {
  DangerButton,
  Feedback,
  FieldLabel,
  GhostButton,
  IconButton,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { PaymentBankAccountSelect } from '../../components/ui/PaymentBankAccountSelect';
import { BarcodeScanField } from '../products/BarcodeScanPage';

type CartLine = {
  key: string;
  productId: number;
  variantId: number | null;
  name: string;
  variantLabel: string | null;
  rate: number;
  quantity: number;
  discount: number;
  stock: number;
};

const SELECT_CLASS = 'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm';

function lineKey(productId: number, variantId: number | null) {
  return `${productId}:${variantId ?? 'p'}`;
}

function lineTotal(line: CartLine) {
  return Math.max(0, line.quantity * line.rate - line.discount);
}

function lookupToCartLine(result: BarcodeLookupResult): CartLine {
  const variant = result.variant;
  const stock = variant?.currentStock ?? result.product.currentStock;
  const rate = variant?.salePrice ?? result.product.salePrice;
  return {
    key: lineKey(result.product.id, variant?.id ?? null),
    productId: result.product.id,
    variantId: variant?.id ?? null,
    name: result.product.name,
    variantLabel: variant
      ? [variant.size, variant.colour].filter(Boolean).join(' / ') || null
      : null,
    rate,
    quantity: 1,
    discount: 0,
    stock,
  };
}

function productToCartLine(product: Product, variantId?: number): CartLine | null {
  if (product.variants?.length) {
    const variant = variantId
      ? product.variants.find((v) => v.id === variantId)
      : product.variants[0];
    if (!variant) return null;
    return {
      key: lineKey(product.id, variant.id),
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      variantLabel: [variant.size, variant.colour].filter(Boolean).join(' / ') || null,
      rate: variant.salePrice ?? product.salePrice,
      quantity: 1,
      discount: 0,
      stock: variant.currentStock,
    };
  }
  return {
    key: lineKey(product.id, null),
    productId: product.id,
    variantId: null,
    name: product.name,
    variantLabel: null,
    rate: product.salePrice,
    quantity: 1,
    discount: 0,
    stock: product.currentStock,
  };
}

export function NewSalePage() {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [overallDiscount, setOverallDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [completedInvoice, setCompletedInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const checkoutFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.listCustomers()])
      .then(([s, c]) => {
        setSettings(s);
        setCustomers(c);
      })
      .catch(() => undefined);
  }, []);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const discount = Number(overallDiscount) || 0;
  const total = Math.max(0, subtotal - discount);
  const received = paidAmount.trim() === '' ? total : Number(paidAmount) || 0;
  const remaining = Math.max(0, total - received);
  const change = Math.max(0, received - total);

  useEffect(() => {
    if (paidAmount.trim() === '' && total > 0) setPaidAmount(String(total));
  }, [total, paidAmount]);

  const stockErrors = useMemo(() => {
    const need = new Map<string, { name: string; need: number; have: number }>();
    for (const line of cart) {
      const entry = need.get(line.key) ?? { name: line.name, need: 0, have: line.stock };
      entry.need += line.quantity;
      need.set(line.key, entry);
    }
    return [...need.values()].filter((e) => e.need > e.have);
  }, [cart]);

  function addOrIncrement(line: CartLine) {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        return prev.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, line];
    });
    setError('');
  }

  function onBarcodeMatch(result: BarcodeLookupResult) {
    if (result.matchType === 'product' && (result.product.variants?.length ?? 0) > 0) {
      setError('Scan the size/colour barcode on the printed label for this product.');
      return;
    }
    if (result.matchType === 'variant' && !result.variant) {
      setError('Barcode matched a product but no variant — reprint the variant label.');
      return;
    }
    addOrIncrement(lookupToCartLine(result));
  }

  const runSearch = useCallback(async () => {
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    try {
      const result = await api.listProducts({ search: q, pageSize: 8, activeOnly: true });
      setSearchResults(result.items);
    } catch {
      setSearchResults([]);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(), 250);
    return () => clearTimeout(timer);
  }, [runSearch]);

  async function ensureCustomerId(): Promise<number | null> {
    if (remaining <= 0) return customerId ? Number(customerId) : null;
    if (customerId === '__new__') {
      if (!newCustomerName.trim()) throw new Error('Enter customer name for udhaar sale');
      const created = await api.createCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
      });
      setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(String(created.id));
      return created.id;
    }
    if (!customerId) throw new Error('Select a customer when there is an amount remaining');
    return Number(customerId);
  }

  async function completeSale(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (cart.length === 0) {
      setError('Add at least one item to the cart.');
      return;
    }
    if (stockErrors.length) {
      setError(stockErrors.map((e) => `${e.name}: need ${e.need}, only ${e.have} in stock`).join('; '));
      return;
    }
    if (remaining > 0 && !customerId && customerId !== '__new__') {
      setError('Select or add a customer for the remaining amount.');
      return;
    }

    setSaving(true);
    try {
      const resolvedCustomerId = await ensureCustomerId();
      const payload: CreateSaleInput = {
        items: cart.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          rate: line.rate,
          discount: line.discount,
        })),
        paymentMethod: remaining > 0 && received === 0 ? 'UDHAAR' : paymentMethod,
        amountReceived: received,
        paidAmount: Math.min(received, total),
        customerId: resolvedCustomerId,
        discount: discount > 0 ? discount : undefined,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      };
      const invoice = await api.createSale(payload);
      setCompletedInvoice(invoice);
      setCart([]);
      setOverallDiscount('');
      setPaidAmount('');
      setCustomerId('');
      setNewCustomerName('');
      setNewCustomerPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sale failed');
    } finally {
      setSaving(false);
    }
  }

  function clearBill() {
    setCart([]);
    setError('');
    setOverallDiscount('');
    setPaidAmount('');
    setCustomerId('');
  }

  useFormShortcuts({
    onSave: () => checkoutFormRef.current?.requestSubmit(),
    onPrint: completedInvoice && settings ? () => printInvoice(completedInvoice, settings) : undefined,
    onClear: clearBill,
    onCancel: completedInvoice ? () => setCompletedInvoice(null) : undefined,
    saveEnabled: !saving && cart.length > 0 && stockErrors.length === 0,
    printEnabled: Boolean(completedInvoice && settings),
    cancelEnabled: Boolean(completedInvoice),
  });

  return (
    <PageShell
      title="New Sale"
      subtitle="Scan or search items, complete checkout, print invoice"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/sales/list">
            <SecondaryButton type="button">Recent invoices</SecondaryButton>
          </Link>
          <SecondaryButton type="button" onClick={clearBill}>
            {shortcutLabel('Clear bill', 'F5')}
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <BarcodeScanField onMatch={onBarcodeMatch} />
          </Panel>

          <Panel>
            <FieldLabel>Search by name or code</FieldLabel>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type product name or code"
            />
            {searchResults.length > 0 ? (
              <ul className="mt-3 max-h-48 overflow-y-auto divide-y divide-border text-sm">
                {searchResults.map((product) => (
                  <li key={product.id} className="py-2">
                    <button
                      type="button"
                      className="w-full text-left hover:text-accent"
                      onClick={() => {
                        const line = productToCartLine(product);
                        if (line) addOrIncrement(line);
                        setSearch('');
                        setSearchResults([]);
                      }}
                    >
                      {product.name}
                      <span className="ml-2 text-textSecondary">
                        Rs {formatMoney(product.salePrice)} · Stock {product.currentStock}
                      </span>
                    </button>
                    {product.variants?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {product.variants.map((v) => (
                          <GhostButton
                            key={v.id}
                            type="button"
                            className="text-xs"
                            onClick={() => {
                              const line = productToCartLine(product, v.id);
                              if (line) addOrIncrement(line);
                            }}
                          >
                            {[v.size, v.colour].filter(Boolean).join('/') || v.productCode} ({v.currentStock})
                          </GhostButton>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel>
            <h2 className="mb-3 text-lg font-semibold">Cart</h2>
            {cart.length === 0 ? (
              <p className="text-sm text-textSecondary">Scan or search to add items.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-textSecondary">
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                      <th className="px-2 py-2 text-right">Disc</th>
                      <th className="px-2 py-2 text-right">Total</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => (
                      <tr key={line.key} className="border-b border-border/60">
                        <td className="px-2 py-2">
                          {line.name}
                          {line.variantLabel ? (
                            <span className="block text-xs text-textSecondary">{line.variantLabel}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <TextInput
                            className="ml-auto w-16 text-right"
                            type="number"
                            min={1}
                            value={String(line.quantity)}
                            onChange={(e) => {
                              const qty = Math.max(1, Number(e.target.value) || 1);
                              setCart((prev) =>
                                prev.map((l) => (l.key === line.key ? { ...l, quantity: qty } : l)),
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <TextInput
                            className="ml-auto w-24 text-right"
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(line.rate)}
                            onChange={(e) => {
                              const rate = Math.max(0, Number(e.target.value) || 0);
                              setCart((prev) =>
                                prev.map((l) => (l.key === line.key ? { ...l, rate } : l)),
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <TextInput
                            className="ml-auto w-20 text-right"
                            type="number"
                            min={0}
                            value={String(line.discount)}
                            onChange={(e) => {
                              const d = Math.max(0, Number(e.target.value) || 0);
                              setCart((prev) =>
                                prev.map((l) => (l.key === line.key ? { ...l, discount: d } : l)),
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">{formatMoney(lineTotal(line))}</td>
                        <td className="px-2 py-2">
                          <IconButton
                            icon={Trash2}
                            label="Remove line"
                            variant="danger"
                            onClick={() => setCart((p) => p.filter((l) => l.key !== line.key))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {stockErrors.length ? (
              <Feedback variant="warning" className="mt-3">
                {stockErrors.map((e) => `${e.name}: only ${e.have} in stock (cart needs ${e.need})`).join(' · ')}
              </Feedback>
            ) : null}
          </Panel>
        </div>

        <Panel>
          <form ref={checkoutFormRef} className="space-y-4" onSubmit={completeSale}>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>Rs {formatMoney(subtotal)}</span>
              </div>
              <div>
                <FieldLabel>Overall discount</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  step="0.01"
                  value={overallDiscount}
                  onChange={(e) => setOverallDiscount(e.target.value)}
                />
              </div>
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>Rs {formatMoney(total)}</span>
              </div>
            </div>

            <div>
              <FieldLabel>Payment method</FieldLabel>
              <select
                className={SELECT_CLASS}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as SalePaymentMethod)}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="EASYPAISA">Easypaisa</option>
                <option value="JAZZCASH">JazzCash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
              </select>
            </div>

            <PaymentBankAccountSelect
              paymentMethod={paymentMethod}
              value={paymentAccountId}
              onChange={setPaymentAccountId}
            />

            <div>
              <FieldLabel>Cash / amount received</FieldLabel>
              <TextInput
                type="number"
                min={0}
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="e.g. 1000"
              />
            </div>

            {remaining > 0 ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                Remaining (udhaar): Rs {formatMoney(remaining)}
              </p>
            ) : change > 0 ? (
              <div className="rounded-lg border border-border bg-surface1 px-3 py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-textSecondary">Bill total</span>
                  <span className="font-medium">Rs {formatMoney(total)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-textSecondary">Cash received</span>
                  <span className="font-medium">Rs {formatMoney(received)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 font-semibold text-textPrimary">
                  <span>Change due</span>
                  <span>Rs {formatMoney(change)}</span>
                </div>
              </div>
            ) : null}

            {remaining > 0 ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <FieldLabel>Customer (required for remaining balance)</FieldLabel>
                <select
                  className={SELECT_CLASS}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                  <option value="__new__">+ Add new customer</option>
                </select>
                {customerId === '__new__' ? (
                  <div className="grid gap-2">
                    <TextInput
                      placeholder="Customer name"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      required
                    />
                    <TextInput
                      placeholder="Phone (optional)"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <Feedback variant="error">{error}</Feedback> : null}

            <PrimaryButton type="submit" disabled={saving || cart.length === 0 || stockErrors.length > 0}>
              {saving ? 'Processing…' : shortcutLabel('Complete Sale', 'F9')}
            </PrimaryButton>
          </form>
        </Panel>
      </div>

      {completedInvoice && settings ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Panel className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <h2 className="text-lg font-semibold">Sale complete</h2>
            <p className="mt-1 text-sm text-textSecondary">
              Invoice {completedInvoice.invoiceNumber} · Bill Rs {formatMoney(completedInvoice.totalAmount)}
            </p>
            {(completedInvoice.changeAmount ?? 0) > 0 ? (
              <p className="mt-2 text-sm font-semibold text-textPrimary">
                Change due: Rs {formatMoney(completedInvoice.changeAmount!)}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <PrimaryButton type="button" onClick={() => printInvoice(completedInvoice, settings)}>
                <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
                {shortcutLabel('Print Invoice', 'F10')}
              </PrimaryButton>
              <SecondaryButton
                type="button"
                onClick={() => {
                  setCompletedInvoice(null);
                  navigate(`/sales/${completedInvoice.id}`);
                }}
              >
                View invoice
              </SecondaryButton>
              <GhostButton type="button" onClick={() => setCompletedInvoice(null)}>
                New sale
              </GhostButton>
            </div>
          </Panel>
        </div>
      ) : null}
    </PageShell>
  );
}

export function InvoicesListPage() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.listInvoices>> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .listInvoices({ page, pageSize: 20 })
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <PageShell
      title="Recent invoices"
      subtitle="View and reprint past sales"
      actions={
        <Link to="/sales/new">
          <PrimaryButton type="button">New Sale</PrimaryButton>
        </Link>
      }
    >
      <Panel>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2">Invoice</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Customer</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((inv) => (
                <tr key={inv.id} className="border-b border-border/60 hover:bg-surface1">
                  <td className="px-2 py-2">
                    <Link className="font-medium text-accent hover:underline" to={`/sales/${inv.id}`}>
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{formatDate(inv.date)}</td>
                  <td className="px-2 py-2">{inv.customer?.name ?? 'Walk-in'}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(inv.totalAmount)}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(inv.paidAmount)}</td>
                  <td className="px-2 py-2">{inv.status === 'ACTIVE' ? 'Active' : 'Cancelled'}</td>
                </tr>
              ))}
              {!loading && result?.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-textSecondary">
                    No invoices yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {result ? (
          <div className="mt-4 flex justify-between">
            <p className="text-sm text-textSecondary">
              Page {result.page} of {result.totalPages}
            </p>
            <div className="flex gap-2">
              <SecondaryButton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </SecondaryButton>
              <SecondaryButton disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Panel>
    </PageShell>
  );
}

export function InvoiceDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getInvoice(id), api.getSettings()])
      .then(([inv, s]) => {
        setInvoice(inv);
        setSettings(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load invoice'));
  }, [id]);

  async function onCancel() {
    if (!invoice || !window.confirm(`Cancel invoice ${invoice.invoiceNumber}? Stock and accounts will be reversed.`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api.cancelSale(invoice.id);
      setInvoice(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setBusy(false);
    }
  }

  if (!invoice) {
    return (
      <PageShell title="Invoice">
        <Panel>{error || 'Loading…'}</Panel>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={invoice.invoiceNumber}
      subtitle={`${formatDate(invoice.date)} · ${invoice.status}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/sales/list">
            <SecondaryButton type="button">Back</SecondaryButton>
          </Link>
          {settings ? (
            <PrimaryButton type="button" onClick={() => printInvoice(invoice, settings)}>
              <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
              {shortcutLabel('Print Invoice', 'F10')}
            </PrimaryButton>
          ) : null}
          {invoice.status === 'ACTIVE' ? (
            <DangerButton type="button" onClick={() => void onCancel()} disabled={busy}>
              Cancel sale
            </DangerButton>
          ) : null}
        </div>
      }
    >
      <Panel>
        <p className="text-sm text-textSecondary">
          Customer: {invoice.customer?.name ?? 'Walk-in'}
          {invoice.customer?.phone ? ` · ${invoice.customer.phone}` : ''}
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="py-2">
                  {item.product.name}
                  {item.variant ? (
                    <span className="block text-xs text-textSecondary">
                      {[item.variant.size, item.variant.colour].filter(Boolean).join(' / ')}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatMoney(item.rate)}</td>
                <td className="py-2 text-right">{formatMoney(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(invoice.subtotal)}</span>
          </div>
          {invoice.discount > 0 ? (
            <div className="flex justify-between">
              <span>Discount</span>
              <span>- {formatMoney(invoice.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <span>Bill total</span>
            <span>Rs {formatMoney(invoice.totalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cash / amount received</span>
            <span>Rs {formatMoney(invoice.amountReceived ?? invoice.paidAmount)}</span>
          </div>
          {(invoice.changeAmount ?? Math.max(0, (invoice.amountReceived ?? invoice.paidAmount) - invoice.totalAmount)) >
          0 ? (
            <div className="flex justify-between font-semibold">
              <span>Change due</span>
              <span>
                Rs{' '}
                {formatMoney(
                  invoice.changeAmount ??
                    Math.max(0, (invoice.amountReceived ?? invoice.paidAmount) - invoice.totalAmount),
                )}
              </span>
            </div>
          ) : null}
          {invoice.remainingAmount > 0 ? (
            <div className="flex justify-between text-amber-800 dark:text-amber-200">
              <span>Remaining</span>
              <span>Rs {formatMoney(invoice.remainingAmount)}</span>
            </div>
          ) : null}
        </div>
        {error ? <Feedback variant="error" className="mt-4">{error}</Feedback> : null}
      </Panel>
    </PageShell>
  );
}
