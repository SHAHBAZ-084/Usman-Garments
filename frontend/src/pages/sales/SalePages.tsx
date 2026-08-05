import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { printInvoice, buildTestInvoice } from '../../components/sales/InvoicePrint';
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
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
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
import { PaymentMethodFields, toApiPaymentMethod, type SimplePayKind } from '../../components/ui/PaymentMethodFields';
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
  const [paymentKind, setPaymentKind] = useState<SimplePayKind>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [paidEdited, setPaidEdited] = useState(false);
  const [udhaarRecovery, setUdhaarRecovery] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [completedInvoice, setCompletedInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState('');
  const checkoutFormRef = useRef<HTMLFormElement>(null);
  const scanLockRef = useRef<{ key: string; at: number } | null>(null);
  const barcodeFocusRef = useRef<(() => void) | null>(null);

  const location = useLocation();
  const initialScanHandledRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.listCustomers()])
      .then(([s, c]) => {
        setSettings(s);
        setCustomers(c);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const scanBarcode = (location.state as { scanBarcode?: string } | null)?.scanBarcode;
    if (scanBarcode && initialScanHandledRef.current !== scanBarcode) {
      initialScanHandledRef.current = scanBarcode;
      api
        .getProductByBarcode(scanBarcode)
        .then((match) => onBarcodeMatch(match))
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Scanned product not found');
        });
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const discount = Number(overallDiscount) || 0;
  const total = Math.max(0, subtotal - discount);
  const received = paidAmount.trim() === '' ? (paidEdited ? 0 : total) : Number(paidAmount) || 0;
  const remaining = Math.max(0, total - received);
  const surplus = Math.max(0, received - total);
  const selectedCustomer = customers.find((c) => String(c.id) === customerId);
  const priorOwed = selectedCustomer?.currentBalance ?? 0;
  const recoveryRequested = Math.min(
    surplus,
    priorOwed,
    udhaarRecovery.trim() === '' ? 0 : Number(udhaarRecovery) || 0,
  );
  const change = Math.max(0, surplus - recoveryRequested);

  useEffect(() => {
    if (!paidEdited) setPaidAmount(total > 0 ? String(total) : '');
  }, [total, paidEdited]);

  const stockErrors = useMemo(() => {
    const need = new Map<string, { name: string; need: number; have: number }>();
    for (const line of cart) {
      const entry = need.get(line.key) ?? { name: line.name, need: 0, have: line.stock };
      entry.need += line.quantity;
      need.set(line.key, entry);
    }
    return [...need.values()].filter((e) => e.need > e.have);
  }, [cart]);

  function addOrIncrement(line: CartLine): boolean {
    let blocked = false;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      const nextQty = (existing?.quantity ?? 0) + 1;
      if (nextQty > line.stock) {
        blocked = true;
        return prev;
      }
      if (existing) {
        return prev.map((l) => (l.key === line.key ? { ...l, quantity: nextQty, stock: line.stock } : l));
      }
      return [...prev, { ...line, quantity: 1 }];
    });
    if (blocked) {
      setError(
        `Stock limit: only ${line.stock} available for ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}.`,
      );
      return false;
    }
    setError('');
    return true;
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
    const line = lookupToCartLine(result);
    const now = Date.now();
    const lock = scanLockRef.current;
    // Guard duplicate wedge events for the same barcode within 350ms.
    if (lock && lock.key === line.key && now - lock.at < 350) {
      return;
    }
    scanLockRef.current = { key: line.key, at: now };
    addOrIncrement(line);
  }

  async function handlePrintInvoice(invoice: Invoice, preview = false) {
    if (!settings || printing) return;
    setPrinting(true);
    setPrintMessage('');
    try {
      const result = await printInvoice(invoice, settings, { preview });
      if (!result.ok) {
        setPrintMessage(result.failureReason || 'Print failed');
      } else if (preview) {
        setPrintMessage('Preview opened.');
      } else {
        setPrintMessage(`Sent to ${result.printer || 'printer'}.`);
      }
    } catch (err) {
      setPrintMessage(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
    }
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
    const needsCustomer = remaining > 0 || recoveryRequested > 0;
    if (!needsCustomer && !customerId) return null;
    if (customerId === '__new__') {
      if (!newCustomerName.trim()) throw new Error('Enter customer name');
      const created = await api.createCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
      });
      setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(String(created.id));
      return created.id;
    }
    if (needsCustomer && !customerId) {
      throw new Error('Select or add a customer for udhaar / recovery');
    }
    return customerId ? Number(customerId) : null;
  }

  async function completeSale(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (cart.length === 0) {
      setError('Add at least one item to the cart.');
      return;
    }
    if (paymentKind === 'EPAY' && !paymentAccountId) {
      setError('Select an e-payment account');
      return;
    }
    if (stockErrors.length > 0) {
      setError('Fix stock issues before completing the sale.');
      return;
    }
    setSaving(true);
    try {
      const resolvedCustomerId = await ensureCustomerId();
      const paymentMethod = toApiPaymentMethod(paymentKind) as SalePaymentMethod;
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
        udhaarRecoveryAmount: recoveryRequested > 0 ? recoveryRequested : 0,
        customerId: resolvedCustomerId,
        discount: discount > 0 ? discount : undefined,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      };
      const invoice = await api.createSale(payload);
      setCompletedInvoice(invoice);
      setCart([]);
      setOverallDiscount('');
      setPaidAmount('');
      setPaidEdited(false);
      setUdhaarRecovery('');
      setCustomerId('');
      setNewCustomerName('');
      setNewCustomerPhone('');
      // refresh customers for updated balances
      api.listCustomers().then(setCustomers).catch(() => undefined);
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
    setPaidEdited(false);
    setUdhaarRecovery('');
    setCustomerId('');
  }

  useFormShortcuts({
    onSave: () => checkoutFormRef.current?.requestSubmit(),
    onPrint: completedInvoice && settings ? () => void handlePrintInvoice(completedInvoice) : undefined,
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
            <BarcodeScanField
              onMatch={onBarcodeMatch}
              onReadyFocus={(focus) => {
                barcodeFocusRef.current = focus;
              }}
            />
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
                          <div className="ml-auto flex w-28 items-center justify-end gap-1">
                            <button
                              type="button"
                              className="h-8 w-8 rounded border border-border text-sm font-bold"
                              aria-label="Decrease quantity"
                              onClick={() =>
                                setCart((prev) =>
                                  prev
                                    .map((l) =>
                                      l.key === line.key ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l,
                                    )
                                    .filter((l) => l.quantity > 0),
                                )
                              }
                            >
                              −
                            </button>
                            <TextInput
                              className="w-14 text-center"
                              type="number"
                              min={1}
                              max={line.stock}
                              value={String(line.quantity)}
                              onChange={(e) => {
                                const qty = Math.max(1, Math.min(line.stock, Number(e.target.value) || 1));
                                if ((Number(e.target.value) || 1) > line.stock) {
                                  setError(
                                    `Stock limit: only ${line.stock} available for ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}.`,
                                  );
                                }
                                setCart((prev) =>
                                  prev.map((l) => (l.key === line.key ? { ...l, quantity: qty } : l)),
                                );
                              }}
                            />
                            <button
                              type="button"
                              className="h-8 w-8 rounded border border-border text-sm font-bold"
                              aria-label="Increase quantity"
                              onClick={() => {
                                if (line.quantity >= line.stock) {
                                  setError(
                                    `Stock limit: only ${line.stock} available for ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}.`,
                                  );
                                  return;
                                }
                                setCart((prev) =>
                                  prev.map((l) =>
                                    l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l,
                                  ),
                                );
                                setError('');
                              }}
                            >
                              +
                            </button>
                          </div>
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

            <PaymentMethodFields
              kind={paymentKind}
              onKindChange={setPaymentKind}
              accountId={paymentAccountId}
              onAccountChange={setPaymentAccountId}
            />

            <div>
              <FieldLabel>Amount received</FieldLabel>
              <TextInput
                type="number"
                min={0}
                step="0.01"
                value={paidAmount}
                onChange={(e) => {
                  setPaidEdited(true);
                  setPaidAmount(e.target.value);
                }}
                placeholder="e.g. 1000"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <FieldLabel>Customer (for udhaar / regular buyers)</FieldLabel>
              <select
                className={SELECT_CLASS}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Walk-in (no account)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` (${c.phone})` : ''}
                    {c.currentBalance > 0 ? ` — owes Rs ${formatMoney(c.currentBalance)}` : ''}
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
              {selectedCustomer && priorOwed > 0 ? (
                <p className="text-xs text-textMuted">
                  Prior udhaar: Rs {formatMoney(priorOwed)}
                </p>
              ) : null}
            </div>

            {remaining > 0 ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                New udhaar on this bill: Rs {formatMoney(remaining)}
                {!customerId ? ' — select or add a customer' : ''}
              </p>
            ) : null}

            {surplus > 0 && priorOwed > 0 ? (
              <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3">
                <FieldLabel>Apply to prior udhaar (optional)</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  max={Math.min(surplus, priorOwed)}
                  step="0.01"
                  value={udhaarRecovery}
                  onChange={(e) => setUdhaarRecovery(e.target.value)}
                  placeholder={`Up to Rs ${formatMoney(Math.min(surplus, priorOwed))}`}
                />
                <p className="text-xs text-textMuted">
                  Extra paid: Rs {formatMoney(surplus)}. Leave blank for change, or enter amount to clear old udhaar.
                </p>
              </div>
            ) : null}

            {change > 0 || recoveryRequested > 0 ? (
              <div className="rounded-lg border border-border bg-surface1 px-3 py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-textSecondary">Bill total</span>
                  <span className="font-medium">Rs {formatMoney(total)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-textSecondary">Amount received</span>
                  <span className="font-medium">Rs {formatMoney(received)}</span>
                </div>
                {recoveryRequested > 0 ? (
                  <div className="mt-1 flex justify-between gap-3 text-success">
                    <span>Udhaar recovery</span>
                    <span className="font-medium">Rs {formatMoney(recoveryRequested)}</span>
                  </div>
                ) : null}
                {change > 0 ? (
                  <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 font-semibold text-textPrimary">
                    <span>Change due</span>
                    <span>Rs {formatMoney(change)}</span>
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
              <PrimaryButton
                type="button"
                disabled={printing}
                onClick={() => void handlePrintInvoice(completedInvoice)}
              >
                <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
                {printing ? 'Printing…' : shortcutLabel('Print Invoice', 'F10')}
              </PrimaryButton>
              <SecondaryButton
                type="button"
                disabled={printing}
                onClick={() => void handlePrintInvoice(completedInvoice, true)}
              >
                Print Preview
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={printing}
                onClick={() => void handlePrintInvoice(buildTestInvoice(settings, 5), true)}
              >
                Test Receipt
              </SecondaryButton>
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
            {printMessage ? <p className="mt-2 text-xs text-textSecondary">{printMessage}</p> : null}
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
                <th className="px-2 py-2 text-right">Actions</th>
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
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs font-semibold text-danger hover:underline"
                      onClick={async () => {
                        if (
                          window.confirm(
                            `Permanently delete invoice ${inv.invoiceNumber}? This cannot be undone, and will restock all items if active.`,
                          )
                        ) {
                          try {
                            await api.deleteSale(inv.id);
                            window.dispatchEvent(new CustomEvent('sales-changed'));
                            setResult((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    items: prev.items.filter((i) => i.id !== inv.id),
                                    total: Math.max(0, prev.total - 1),
                                  }
                                : null,
                            );
                          } catch (err) {
                            alert(err instanceof Error ? err.message : 'Delete failed');
                          }
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && result?.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-textSecondary">
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
  const navigate = useNavigate();
  const id = Number(params.id);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getInvoice(id), api.getSettings()])
      .then(([inv, s]) => {
        setInvoice(inv);
        setSettings(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load invoice'));
  }, [id]);

  async function runPrint(target: Invoice, preview = false) {
    if (!settings || printing) return;
    setPrinting(true);
    setPrintMessage('');
    try {
      const result = await printInvoice(target, settings, { preview });
      if (!result.ok) setPrintMessage(result.failureReason || 'Print failed');
      else setPrintMessage(preview ? 'Preview opened.' : `Sent to ${result.printer || 'printer'}.`);
    } catch (err) {
      setPrintMessage(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
    }
  }

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

  async function onDelete() {
    if (
      !invoice ||
      !window.confirm(
        `Permanently delete sale ${invoice.invoiceNumber}? This cannot be undone, and will restock all items if active.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.deleteSale(invoice.id);
      window.dispatchEvent(new CustomEvent('sales-changed'));
      navigate('/sales/list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  useFormShortcuts({
    onPrint: invoice && settings ? () => void runPrint(invoice) : undefined,
    printEnabled: Boolean(invoice && settings) && !printing,
  });

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
      subtitle={`${formatDateTime(invoice.date)} · ${invoice.status}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/sales/list">
            <SecondaryButton type="button">Back</SecondaryButton>
          </Link>
          {settings ? (
            <>
              <PrimaryButton type="button" disabled={printing} onClick={() => void runPrint(invoice)}>
                <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
                {printing ? 'Printing…' : shortcutLabel('Print Invoice', 'F10')}
              </PrimaryButton>
              <SecondaryButton type="button" disabled={printing} onClick={() => void runPrint(invoice, true)}>
                Print Preview
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={printing}
                onClick={() => void runPrint(buildTestInvoice(settings, 8), true)}
              >
                Test Receipt
              </SecondaryButton>
            </>
          ) : null}
          {invoice.status === 'ACTIVE' ? (
            <DangerButton type="button" onClick={() => void onCancel()} disabled={busy}>
              Cancel sale
            </DangerButton>
          ) : null}
          <DangerButton type="button" onClick={() => void onDelete()} disabled={busy}>
            Delete sale
          </DangerButton>
        </div>
      }
    >
      {printMessage ? (
        <Feedback variant="info" className="mb-3">
          {printMessage}
        </Feedback>
      ) : null}
      {error ? <Feedback variant="error" className="mb-3">{error}</Feedback> : null}
      <Panel>
        {invoice.customer ? (
          <p className="text-sm text-textSecondary">
            Customer: {invoice.customer.name}
            {invoice.customer.phone ? ` · ${invoice.customer.phone}` : ''}
          </p>
        ) : null}
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
      </Panel>
    </PageShell>
  );
}
