import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { printReturnReceipt } from '../../components/sales/ReturnReceiptPrint';
import { BarcodeScanField } from '../products/BarcodeScanPage';
import {
  api,
  type BarcodeLookupResult,
  type BusinessSettings,
  type InvoiceForReturn,
  type Product,
  type PurchasePaymentMethod,
  type ReturnCondition,
} from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { Trash2 } from 'lucide-react';
import {
  Feedback,
  FieldLabel,
  IconButton,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';

const SELECT_CLASS = 'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm';

const PAYMENT_METHODS: { value: PurchasePaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
];

type ReturnDraft = {
  invoiceItemId: number;
  quantity: string;
  condition: ReturnCondition;
  maxQty: number;
  label: string;
};

type NewItemDraft = {
  key: string;
  productId: number;
  variantId: number | null;
  name: string;
  variantLabel: string | null;
  rate: number;
  quantity: string;
  stock: number;
};

function lineKey(productId: number, variantId: number | null) {
  return `${productId}:${variantId ?? 'p'}`;
}

function lookupToNewItem(result: BarcodeLookupResult): NewItemDraft {
  const variant = result.variant;
  const stock = variant?.currentStock ?? result.product.currentStock;
  const rate = variant?.salePrice ?? result.product.salePrice;
  return {
    key: lineKey(result.product.id, variant?.id ?? null),
    productId: result.product.id,
    variantId: variant?.id ?? null,
    name: result.product.name,
    variantLabel: variant ? [variant.size, variant.colour].filter(Boolean).join(' / ') || null : null,
    rate,
    quantity: '1',
    stock,
  };
}

export function ReturnExchangePage() {
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoice, setInvoice] = useState<InvoiceForReturn | null>(null);
  const [returnDrafts, setReturnDrafts] = useState<ReturnDraft[]>([]);
  const [mode, setMode] = useState<'return' | 'exchange'>('return');
  const [newItems, setNewItems] = useState<NewItemDraft[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [paidAmount, setPaidAmount] = useState('');
  const [refundToCash, setRefundToCash] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings(null));
    api.listProducts({ pageSize: 200, activeOnly: true }).then((r) => setProducts(r.items)).catch(() => setProducts([]));
  }, []);

  async function onLookup(e?: FormEvent) {
    e?.preventDefault();
    if (!invoiceQuery.trim()) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const found = await api.lookupInvoiceForReturn(invoiceQuery.trim());
      setInvoice(found);
      setReturnDrafts(
        found.items
          .filter((i) => i.returnableQty > 0)
          .map((i) => ({
            invoiceItemId: i.id,
            quantity: '1',
            condition: 'GOOD' as ReturnCondition,
            maxQty: i.returnableQty,
            label: `${i.product.name}${i.variant ? ` (${[i.variant.size, i.variant.colour].filter(Boolean).join(' / ')})` : ''} — sold ${i.quantity}, returnable ${i.returnableQty}`,
          })),
      );
      setNewItems([]);
    } catch (err) {
      setInvoice(null);
      setReturnDrafts([]);
      setError(err instanceof Error ? err.message : 'Invoice not found');
    } finally {
      setLoading(false);
    }
  }

  const returnTotal = useMemo(() => {
    if (!invoice) return 0;
    return returnDrafts.reduce((sum, d) => {
      const qty = Number(d.quantity);
      if (!qty || qty <= 0) return sum;
      const item = invoice.items.find((i) => i.id === d.invoiceItemId);
      if (!item) return sum;
      const unit = item.total / item.quantity;
      return sum + unit * Math.min(qty, d.maxQty);
    }, 0);
  }, [invoice, returnDrafts]);

  const newTotal = useMemo(() => {
    return newItems.reduce((sum, line) => {
      const qty = Number(line.quantity);
      if (!qty || qty <= 0) return sum;
      return sum + qty * line.rate;
    }, 0);
  }, [newItems]);

  const netAmount = useMemo(() => newTotal - returnTotal, [newTotal, returnTotal]);

  function addNewFromScan(result: BarcodeLookupResult) {
    const line = lookupToNewItem(result);
    setNewItems((prev) => {
      const existing = prev.find((p) => p.key === line.key);
      if (existing) {
        return prev.map((p) =>
          p.key === line.key ? { ...p, quantity: String(Number(p.quantity) + 1) } : p,
        );
      }
      return [...prev, line];
    });
  }

  function buildReturnPayload() {
    if (!invoice) throw new Error('Load an invoice first');
    const items = returnDrafts
      .map((d) => ({
        invoiceItemId: d.invoiceItemId,
        quantity: Number(d.quantity),
        condition: d.condition,
        maxQty: d.maxQty,
      }))
      .filter((i) => i.quantity > 0);
    if (!items.length) throw new Error('Select at least one item to return');
    for (const i of items) {
      if (i.quantity > i.maxQty) {
        throw new Error(`Return quantity cannot exceed ${i.maxQty}`);
      }
    }
    return items.map(({ invoiceItemId, quantity, condition }) => ({
      invoiceItemId,
      quantity,
      condition,
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const returnItems = buildReturnPayload();

      if (mode === 'return') {
        const result = await api.createSaleReturn({
          invoiceId: invoice.id,
          items: returnItems,
          refundMethod: paymentMethod,
          refundToCash: refundToCash || undefined,
          note: note.trim() || null,
        });
        setMessage(`Return recorded. Refund Rs ${formatMoney(result.refundAmount)}`);
        if (settings) printReturnReceipt(result, settings, 'return');
        await onLookup();
      } else {
        if (!newItems.length) throw new Error('Add at least one new item for exchange');
        const result = await api.createExchange({
          invoiceId: invoice.id,
          returnItems,
          newItems: newItems.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: Number(l.quantity),
            rate: l.rate,
          })),
          paymentMethod,
          paidAmount: netAmount > 0 ? Number(paidAmount || netAmount) : 0,
          refundToCash: refundToCash || undefined,
          note: note.trim() || null,
        });
        setMessage(
          netAmount >= 0
            ? `Exchange complete. Customer pays Rs ${formatMoney(result.netAmount)}`
            : `Exchange complete. Refund Rs ${formatMoney(result.refundedAmount)}`,
        );
        if (settings) printReturnReceipt(result, settings, 'exchange');
        setNewItems([]);
        await onLookup();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Return / Exchange"
      subtitle="Search the original invoice — returns are separate records, invoice is never edited"
      actions={
        <Link to="/sales">
          <SecondaryButton type="button">Recent invoices</SecondaryButton>
        </Link>
      }
    >
      <Panel className="mb-4">
        <form className="flex flex-wrap gap-3" onSubmit={onLookup}>
          <div className="min-w-[200px] flex-1">
            <FieldLabel>Invoice number</FieldLabel>
            <TextInput
              value={invoiceQuery}
              onChange={(e) => setInvoiceQuery(e.target.value)}
              placeholder="e.g. UM-000001"
            />
          </div>
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Find invoice'}
            </PrimaryButton>
          </div>
        </form>
      </Panel>

      {invoice ? (
        <form onSubmit={onSubmit}>
          <Panel className="mb-4">
            <div className="mb-4 flex flex-wrap gap-4 text-sm">
              <span>
                <strong>{invoice.invoiceNumber}</strong> · {formatDate(invoice.date)}
              </span>
              <span>Total Rs {formatMoney(invoice.totalAmount)}</span>
              {invoice.customer ? <span>Customer: {invoice.customer.name}</span> : <span>Walk-in</span>}
            </div>

            <div className="mb-4 flex gap-2">
              <SecondaryButton
                type="button"
                className={mode === 'return' ? 'ring-2 ring-accent' : ''}
                onClick={() => setMode('return')}
              >
                Return only
              </SecondaryButton>
              <SecondaryButton
                type="button"
                className={mode === 'exchange' ? 'ring-2 ring-accent' : ''}
                onClick={() => setMode('exchange')}
              >
                Exchange
              </SecondaryButton>
            </div>

            <h2 className="mb-3 font-semibold">Items to return</h2>
            {returnDrafts.length === 0 ? (
              <p className="text-sm text-textSecondary">Nothing left to return on this invoice.</p>
            ) : (
              <div className="space-y-3">
                {returnDrafts.map((d, idx) => (
                  <div key={d.invoiceItemId} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-4">
                    <p className="text-sm md:col-span-2">{d.label}</p>
                    <div>
                      <FieldLabel>Qty (max {d.maxQty})</FieldLabel>
                      <TextInput
                        type="number"
                        min="1"
                        max={d.maxQty}
                        value={d.quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReturnDrafts((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, quantity: val } : row)),
                          );
                        }}
                      />
                    </div>
                    <div>
                      <FieldLabel>Condition</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={d.condition}
                        onChange={(e) => {
                          setReturnDrafts((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, condition: e.target.value as ReturnCondition } : row,
                            ),
                          );
                        }}
                      >
                        <option value="GOOD">Good — restock</option>
                        <option value="DAMAGED">Damaged — no restock</option>
                        <option value="OTHER">Other — restock</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {mode === 'exchange' ? (
            <Panel className="mb-4">
              <h2 className="mb-3 font-semibold">New items</h2>
              <div className="mb-4">
                <BarcodeScanField onMatch={(r) => addNewFromScan(r)} />
              </div>
              <div className="mb-3">
                <FieldLabel>Add from list</FieldLabel>
                <select
                  className={SELECT_CLASS}
                  defaultValue=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (!id) return;
                    const product = products.find((p) => p.id === id);
                    if (!product) return;
                    if (product.variants?.length) {
                      const v = product.variants[0]!;
                      setNewItems((prev) => [
                        ...prev,
                        {
                          key: lineKey(product.id, v.id),
                          productId: product.id,
                          variantId: v.id,
                          name: product.name,
                          variantLabel: [v.size, v.colour].filter(Boolean).join(' / ') || null,
                          rate: v.salePrice ?? product.salePrice,
                          quantity: '1',
                          stock: v.currentStock,
                        },
                      ]);
                    } else {
                      setNewItems((prev) => [
                        ...prev,
                        {
                          key: lineKey(product.id, null),
                          productId: product.id,
                          variantId: null,
                          name: product.name,
                          variantLabel: null,
                          rate: product.salePrice,
                          quantity: '1',
                          stock: product.currentStock,
                        },
                      ]);
                    }
                    e.target.value = '';
                  }}
                >
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (stock {p.currentStock})
                    </option>
                  ))}
                </select>
              </div>
              {newItems.map((line, idx) => (
                <div key={line.key} className="mb-2 grid gap-2 rounded border border-border/60 p-2 md:grid-cols-4">
                  <p className="text-sm md:col-span-2">
                    {line.name}
                    {line.variantLabel ? ` · ${line.variantLabel}` : ''}
                  </p>
                  <TextInput
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) =>
                      setNewItems((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row)),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label="Remove line"
                    variant="danger"
                    onClick={() => setNewItems((prev) => prev.filter((_, i) => i !== idx))}
                  />
                </div>
              ))}
            </Panel>
          ) : null}

          <Panel className="mb-4">
            <div className="mb-4 space-y-1 text-sm">
              <p className="flex justify-between">
                <span>Return value</span>
                <span>Rs {formatMoney(returnTotal)}</span>
              </p>
              {mode === 'exchange' ? (
                <>
                  <p className="flex justify-between">
                    <span>New items</span>
                    <span>Rs {formatMoney(newTotal)}</span>
                  </p>
                  <p className="flex justify-between font-semibold text-lg">
                    <span>{netAmount >= 0 ? 'Customer pays' : 'Refund customer'}</span>
                    <span>Rs {formatMoney(Math.abs(netAmount))}</span>
                  </p>
                </>
              ) : (
                <p className="flex justify-between font-semibold text-lg">
                  <span>Refund</span>
                  <span>Rs {formatMoney(returnTotal)}</span>
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Payment / refund method</FieldLabel>
                <select
                  className={SELECT_CLASS}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PurchasePaymentMethod)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              {mode === 'exchange' && netAmount > 0 ? (
                <div>
                  <FieldLabel>Amount received</FieldLabel>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={paidAmount || String(netAmount)}
                    onChange={(e) => setPaidAmount(e.target.value)}
                  />
                </div>
              ) : null}
              {invoice.customer ? (
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input type="checkbox" checked={refundToCash} onChange={(e) => setRefundToCash(e.target.checked)} />
                  Refund to cash (ignore udhaar balance)
                </label>
              ) : null}
              <div className="md:col-span-2">
                <FieldLabel>Note (optional)</FieldLabel>
                <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          </Panel>

          {message ? <Feedback variant="success" className="mb-3">{message}</Feedback> : null}
          {error ? <Feedback variant="error" className="mb-3">{error}</Feedback> : null}

          <PrimaryButton type="submit" disabled={saving || returnDrafts.length === 0}>
            {saving ? 'Processing…' : mode === 'exchange' ? 'Confirm exchange' : 'Confirm return'}
          </PrimaryButton>
        </form>
      ) : null}

      {!invoice && error ? <Feedback variant="error">{error}</Feedback> : null}
    </PageShell>
  );
}
