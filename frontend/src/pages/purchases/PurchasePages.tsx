import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFormShortcuts } from '../../hooks/useFormShortcuts';
import {
  api,
  type Product,
  type Purchase,
  type PurchasePaymentMethod,
  type Supplier,
} from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { shortcutLabel } from '../../lib/shortcuts';
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
import { PaymentBankAccountSelect } from '../../components/ui/PaymentBankAccountSelect';

const PAYMENT_METHODS: { value: PurchasePaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
];

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type LineDraft = {
  key: string;
  productId: number;
  variantId: number | null;
  productName: string;
  variantLabel: string;
  quantity: string;
  purchasePrice: string;
};

export function PurchaseEntryPage() {
  const [searchParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState<number | ''>(
    searchParams.get('supplierId') ? Number(searchParams.get('supplierId')) : '',
  );
  const [date, setDate] = useState(todayInput());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Purchase | null>(null);
  const purchaseFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api.listSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    const q = productSearch.trim();
    if (q.length < 1) {
      setProducts([]);
      return;
    }
    const t = setTimeout(() => {
      api.listProducts({ search: q, pageSize: 15 }).then((r) => setProducts(r.items)).catch(() => setProducts([]));
    }, 200);
    return () => clearTimeout(t);
  }, [productSearch]);

  const totalAmount = useMemo(() => {
    return lines.reduce((sum, line) => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.purchasePrice) || 0;
      return sum + qty * price;
    }, 0);
  }, [lines]);

  const paid = paidAmount.trim() === '' ? totalAmount : Number(paidAmount) || 0;
  const remaining = Math.max(0, Math.round((totalAmount - paid) * 100) / 100);

  function addProduct(product: Product, variantId?: number) {
    const variant = variantId ? product.variants?.find((v) => v.id === variantId) : null;
    const label = variant
      ? [variant.size, variant.colour].filter(Boolean).join(' / ') || variant.productCode
      : '';
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        variantId: variantId ?? null,
        productName: product.name,
        variantLabel: label,
        quantity: '1',
        purchasePrice:
          variant?.purchasePrice != null && variant.purchasePrice > 0
            ? String(variant.purchasePrice)
            : product.purchasePrice > 0
              ? String(product.purchasePrice)
              : '',
      },
    ]);
    setProductSearch('');
    setProducts([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!supplierId) {
      setError('Select a supplier');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one product');
      return;
    }
    setSaving(true);
    try {
      const purchase = await api.createPurchase({
        supplierId: Number(supplierId),
        date,
        supplierInvoiceNumber: invoiceNo.trim() || null,
        paymentMethod,
        paidAmount: paid,
        notes: notes.trim() || null,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: Number(l.quantity),
          purchasePrice: Number(l.purchasePrice),
        })),
      });
      setConfirmation(purchase);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setSaving(false);
    }
  }

  function clearPurchaseForm() {
    setLines([]);
    setPaidAmount('');
    setNotes('');
    setInvoiceNo('');
    setError('');
  }

  useFormShortcuts({
    onSave: () => purchaseFormRef.current?.requestSubmit(),
    onClear: clearPurchaseForm,
    saveEnabled: !saving && Boolean(supplierId) && lines.length > 0,
  });

  if (confirmation) {
    return (
      <PageShell title="Purchase saved" subtitle="Stock and balances updated">
        <Panel className="max-w-lg">
          <p className="text-base text-textPrimary">{confirmation.confirmation?.message}</p>
          <ul className="mt-4 space-y-1 text-sm text-textSecondary">
            <li>Total: Rs {formatMoney(confirmation.totalAmount)}</li>
            <li>Paid now: Rs {formatMoney(confirmation.paidAmount)}</li>
            <li>Added to supplier balance: Rs {formatMoney(confirmation.remainingAmount)}</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to={`/purchases/${confirmation.id}`}>
              <PrimaryButton type="button">View purchase</PrimaryButton>
            </Link>
            <Link to={`/suppliers/${confirmation.supplierId}`}>
              <SecondaryButton type="button">Supplier page</SecondaryButton>
            </Link>
            <SecondaryButton type="button" onClick={() => { setConfirmation(null); setLines([]); setPaidAmount(''); }}>
              New purchase
            </SecondaryButton>
          </div>
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="New Purchase"
      subtitle="Buying stock from a supplier — remaining unpaid amount is added to what you owe them"
      actions={
        <Link to="/purchases">
          <SecondaryButton type="button">Purchase list</SecondaryButton>
        </Link>
      }
    >
      <form ref={purchaseFormRef} className="grid gap-6 lg:grid-cols-2" onSubmit={onSubmit}>
        <Panel className="space-y-4">
          <div>
            <FieldLabel>Supplier</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Date</FieldLabel>
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <FieldLabel>Supplier invoice # (optional)</FieldLabel>
              <TextInput value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel>Add products</FieldLabel>
            <TextInput
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search by name, code, or barcode"
            />
            {products.length > 0 ? (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface1 text-sm">
                {products.map((p) =>
                  p.variants && p.variants.length > 0 ? (
                    p.variants.map((v) => (
                      <li key={`${p.id}-${v.id}`}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-surface2"
                          onClick={() => addProduct(p, v.id)}
                        >
                          {p.name} — {[v.size, v.colour].filter(Boolean).join(' / ') || v.productCode}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-surface2"
                        onClick={() => addProduct(p)}
                      >
                        {p.name} ({p.productCode})
                      </button>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={line.key} className="rounded-lg border border-border p-3">
                <p className="font-medium text-textPrimary">
                  {line.productName}
                  {line.variantLabel ? ` — ${line.variantLabel}` : ''}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div>
                    <FieldLabel>Qty</FieldLabel>
                    <TextInput
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...line, quantity: e.target.value };
                        setLines(next);
                      }}
                      required
                    />
                  </div>
                  <div>
                    <FieldLabel>Cost each</FieldLabel>
                    <TextInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.purchasePrice}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...line, purchasePrice: e.target.value };
                        setLines(next);
                      }}
                      required
                    />
                  </div>
                  <div className="flex items-end">
                    <IconButton
                      icon={Trash2}
                      label="Remove line"
                      variant="danger"
                      onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                    />
                  </div>
                </div>
              </div>
            ))}
            {lines.length === 0 ? (
              <p className="text-sm text-textSecondary">No products added yet.</p>
            ) : null}
          </div>
        </Panel>

        <Panel className="space-y-4 h-fit">
          <div>
            <FieldLabel>Payment method</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PurchasePaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <PaymentBankAccountSelect
            paymentMethod={paymentMethod}
            value={paymentAccountId}
            onChange={setPaymentAccountId}
          />
          <div>
            <FieldLabel>Paid now</FieldLabel>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              placeholder={String(totalAmount || 0)}
            />
            <p className="mt-1 text-xs text-textSecondary">Leave blank to mark as fully paid.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface1 p-4 text-sm">
            <div className="flex justify-between">
              <span>Total</span>
              <span className="font-semibold">Rs {formatMoney(totalAmount)}</span>
            </div>
            <div className="mt-2 flex justify-between">
              <span>Paid now</span>
              <span>Rs {formatMoney(paid)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span>Still owed to supplier</span>
              <span className="font-semibold">Rs {formatMoney(remaining)}</span>
            </div>
          </div>
          <div>
            <FieldLabel>Notes (optional)</FieldLabel>
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : shortcutLabel('Save Purchase', 'F9')}
          </PrimaryButton>
        </Panel>
      </form>
    </PageShell>
  );
}

export function PurchasesListPage() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.listPurchases>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listPurchases().then(setResult).catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
  }, []);

  return (
    <PageShell
      title="Purchases"
      subtitle="Stock bought from suppliers"
      actions={
        <Link to="/purchases/new">
          <PrimaryButton type="button">New Purchase</PrimaryButton>
        </Link>
      }
    >
      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}
      <Panel>
        <table className="app-data-table min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Supplier</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-right">Still owed</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {result?.items.map((p) => (
              <tr key={p.id} className="border-b border-border/60">
                <td className="px-2 py-2">
                  <Link className="text-accent hover:underline" to={`/purchases/${p.id}`}>
                    {formatDate(p.date)}
                  </Link>
                </td>
                <td className="px-2 py-2">{p.supplier.name}</td>
                <td className="px-2 py-2 text-right">{formatMoney(p.totalAmount)}</td>
                <td className="px-2 py-2 text-right">{formatMoney(p.remainingAmount)}</td>
                <td className="px-2 py-2">{p.status}</td>
              </tr>
            ))}
            {result && result.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-8 text-center text-textSecondary">
                  No purchases yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}

export function PurchaseDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [error, setError] = useState('');
  const [returnQty, setReturnQty] = useState<Record<number, string>>({});
  const [returnMsg, setReturnMsg] = useState('');

  useEffect(() => {
    api.getPurchase(id).then(setPurchase).catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [id]);

  async function onReturn() {
    if (!purchase) return;
    const items = purchase.items
      .map((item) => ({
        purchaseItemId: item.id,
        quantity: Number(returnQty[item.id] || 0),
      }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) {
      setError('Enter quantities to return');
      return;
    }
    setError('');
    try {
      const result = await api.createPurchaseReturn({ purchaseId: purchase.id, items });
      setReturnMsg(result.confirmation.message);
      setPurchase(await api.getPurchase(id));
      setReturnQty({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Return failed');
    }
  }

  if (!purchase && !error) {
    return <PageShell title="Purchase"><p className="text-sm text-textSecondary">Loading…</p></PageShell>;
  }
  if (!purchase) {
    return <PageShell title="Purchase"><p className="text-sm text-danger">{error}</p></PageShell>;
  }

  return (
    <PageShell
      title={`Purchase #${purchase.id}`}
      subtitle={`${purchase.supplier.name} — ${formatDate(purchase.date)}`}
      actions={
        <div className="flex gap-2">
          <SecondaryButton type="button" onClick={() => navigate('/purchases')}>Back</SecondaryButton>
          <Link to={`/suppliers/${purchase.supplierId}`}>
            <SecondaryButton type="button">Supplier</SecondaryButton>
          </Link>
        </div>
      }
    >
      {purchase.confirmation ? (
        <p className="mb-4 rounded-lg border border-border bg-surface1 px-4 py-3 text-sm">
          {purchase.confirmation.message}
        </p>
      ) : null}
      {returnMsg ? <Feedback variant="success" className="mb-4">{returnMsg}</Feedback> : null}
      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs text-textSecondary">Total</p>
          <p className="text-xl font-semibold">Rs {formatMoney(purchase.totalAmount)}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Paid</p>
          <p className="text-xl font-semibold">Rs {formatMoney(purchase.paidAmount)}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Still owed on this bill</p>
          <p className="text-xl font-semibold">Rs {formatMoney(purchase.remainingAmount)}</p>
        </Panel>
      </div>

      <Panel className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">Items</h2>
        <table className="app-data-table min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2">Product</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Cost</th>
              <th className="px-2 py-2 text-right">Line</th>
              <th className="px-2 py-2 text-right">Return qty</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="px-2 py-2">
                  {item.product.name}
                  {item.variant
                    ? ` — ${[item.variant.size, item.variant.colour].filter(Boolean).join(' / ')}`
                    : ''}
                </td>
                <td className="px-2 py-2 text-right">{item.quantity}</td>
                <td className="px-2 py-2 text-right">{formatMoney(item.purchasePrice)}</td>
                <td className="px-2 py-2 text-right">{formatMoney(item.lineTotal)}</td>
                <td className="px-2 py-2 text-right">
                  <TextInput
                    type="number"
                    min="0"
                    max={item.quantity}
                    className="ml-auto w-20"
                    value={returnQty[item.id] ?? ''}
                    onChange={(e) => setReturnQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4">
          <SecondaryButton type="button" onClick={() => void onReturn()}>
            Record return (basic)
          </SecondaryButton>
        </div>
      </Panel>
    </PageShell>
  );
}

export function SupplierPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<number | ''>(
    searchParams.get('supplierId') ? Number(searchParams.get('supplierId')) : '',
  );
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const selected = suppliers.find((s) => s.id === supplierId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      setError('Select a supplier');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.createSupplierPayment({
        supplierId: Number(supplierId),
        amount: Number(amount),
        paymentMethod,
        date,
        note: note.trim() || null,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      });
      setMessage(result.confirmation.message);
      setAmount('');
      setSuppliers(await api.listSuppliers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Pay Supplier"
      subtitle="Reduce what you owe — recorded against the supplier balance"
      actions={
        <SecondaryButton type="button" onClick={() => navigate(-1)}>Back</SecondaryButton>
      }
    >
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Supplier</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — owed Rs {formatMoney(s.payable)}
                </option>
              ))}
            </select>
          </div>
          {selected ? (
            <p className="text-sm text-textSecondary">
              Currently owed: <strong>Rs {formatMoney(selected.payable)}</strong>
            </p>
          ) : null}
          <div>
            <FieldLabel>Amount</FieldLabel>
            <TextInput type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Payment method</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PurchasePaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <PaymentBankAccountSelect
            paymentMethod={paymentMethod}
            value={paymentAccountId}
            onChange={setPaymentAccountId}
          />
          <div>
            <FieldLabel>Date</FieldLabel>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Note (optional)</FieldLabel>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record Payment'}
          </PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}
