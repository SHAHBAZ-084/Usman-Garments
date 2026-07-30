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
  GhostButton,
  IconButton,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { PaymentMethodFields, toApiPaymentMethod, type SimplePayKind } from '../../components/ui/PaymentMethodFields';

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
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [supplierId, setSupplierId] = useState<number | ''>(
    searchParams.get('supplierId') ? Number(searchParams.get('supplierId')) : '',
  );
  const [date, setDate] = useState(todayInput());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [paymentKind, setPaymentKind] = useState<SimplePayKind>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Purchase | null>(null);
  const purchaseFormRef = useRef<HTMLFormElement>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickCategoryId, setQuickCategoryId] = useState('');
  const [quickCategoryName, setQuickCategoryName] = useState('');
  const [quickSalePrice, setQuickSalePrice] = useState('');
  const [quickPurchasePrice, setQuickPurchasePrice] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [quickSupplierPhone, setQuickSupplierPhone] = useState('');
  const [quickSupplierBusy, setQuickSupplierBusy] = useState(false);
  const [paidEdited, setPaidEdited] = useState(false);

  useEffect(() => {
    api.listSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
    api.listProductCategories().then(setCategories).catch(() => setCategories([]));
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

  const paid = paidAmount.trim() === '' ? (paidEdited ? 0 : totalAmount) : Number(paidAmount) || 0;
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

  async function onQuickAddSupplier() {
    setError('');
    const name = quickSupplierName.trim();
    if (!name) {
      setError('Enter a supplier name');
      return;
    }
    setQuickSupplierBusy(true);
    try {
      const created = await api.createSupplier({
        name,
        phone: quickSupplierPhone.trim() || undefined,
      });
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(created.id);
      setQuickSupplierOpen(false);
      setQuickSupplierName('');
      setQuickSupplierPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick add supplier failed');
    } finally {
      setQuickSupplierBusy(false);
    }
  }

  async function onQuickAddProduct() {
    setError('');
    const name = quickName.trim();
    if (!name) {
      setError('Enter a product name for quick add');
      return;
    }
    setQuickBusy(true);
    try {
      let categoryId: number | null = quickCategoryId ? Number(quickCategoryId) : null;
      if (!categoryId && quickCategoryName.trim()) {
        const created = await api.createProductCategory(quickCategoryName.trim());
        categoryId = created.id;
        setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      const sale = quickSalePrice.trim() ? Number(quickSalePrice) : 0;
      const purchase = quickPurchasePrice.trim() ? Number(quickPurchasePrice) : 0;
      if (Number.isNaN(sale) || sale < 0 || Number.isNaN(purchase) || purchase < 0) {
        throw new Error('Prices must be zero or greater');
      }
      const created = await api.createProduct({
        name,
        categoryId,
        salePrice: sale,
        purchasePrice: purchase,
        openingStock: 0,
      });
      addProduct(created);
      setQuickAddOpen(false);
      setQuickName('');
      setQuickCategoryId('');
      setQuickCategoryName('');
      setQuickSalePrice('');
      setQuickPurchasePrice(purchase > 0 ? String(purchase) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick add failed');
    } finally {
      setQuickBusy(false);
    }
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
        paymentMethod: toApiPaymentMethod(paymentKind) as PurchasePaymentMethod,
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

  function clearPurchaseForm(keepSupplier = false) {
    setLines([]);
    setPaidAmount('');
    setPaidEdited(false);
    setNotes('');
    setInvoiceNo('');
    setError('');
    if (!keepSupplier) setSupplierId('');
  }

  function startAnotherPurchase(sameSupplier: boolean) {
    const keepId = sameSupplier ? confirmation?.supplierId : undefined;
    setConfirmation(null);
    clearPurchaseForm(Boolean(keepId));
    if (keepId) setSupplierId(keepId);
  }

  useFormShortcuts({
    onSave: () => purchaseFormRef.current?.requestSubmit(),
    onClear: () => clearPurchaseForm(true),
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
            <PrimaryButton type="button" onClick={() => startAnotherPurchase(true)}>
              Another purchase (same supplier)
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => startAnotherPurchase(false)}>
              New purchase (other supplier)
            </SecondaryButton>
            <Link to={`/purchases/${confirmation.id}`}>
              <SecondaryButton type="button">View purchase</SecondaryButton>
            </Link>
            <Link to={`/suppliers/${confirmation.supplierId}`}>
              <SecondaryButton type="button">Supplier page</SecondaryButton>
            </Link>
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
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <FieldLabel>Supplier</FieldLabel>
              <GhostButton
                type="button"
                onClick={() => setQuickSupplierOpen((o) => !o)}
              >
                {quickSupplierOpen ? 'Close quick add' : 'Quick add supplier'}
              </GhostButton>
            </div>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
              required={!quickSupplierOpen}
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {quickSupplierOpen ? (
              <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border bg-surface1 p-3">
                <p className="text-sm font-medium text-textPrimary">Quick add supplier</p>
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <TextInput
                    value={quickSupplierName}
                    onChange={(e) => setQuickSupplierName(e.target.value)}
                    placeholder="Supplier name"
                    required
                  />
                </div>
                <div>
                  <FieldLabel>Phone (optional)</FieldLabel>
                  <TextInput
                    value={quickSupplierPhone}
                    onChange={(e) => setQuickSupplierPhone(e.target.value)}
                  />
                </div>
                <PrimaryButton type="button" disabled={quickSupplierBusy} onClick={() => void onQuickAddSupplier()}>
                  {quickSupplierBusy ? 'Adding…' : 'Create & select'}
                </PrimaryButton>
              </div>
            ) : null}
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
            <div className="mb-1 flex items-center justify-between gap-2">
              <FieldLabel>Add products</FieldLabel>
              <GhostButton
                type="button"
                className="text-xs text-accent"
                onClick={() => {
                  setQuickAddOpen((o) => !o);
                  setQuickName(productSearch.trim());
                }}
              >
                {quickAddOpen ? 'Close quick add' : 'Quick add product'}
              </GhostButton>
            </div>
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
            ) : productSearch.trim() && !quickAddOpen ? (
              <p className="mt-2 text-xs text-textMuted">
                No match — use <button type="button" className="underline text-accent" onClick={() => { setQuickAddOpen(true); setQuickName(productSearch.trim()); }}>Quick add product</button> if this is new stock.
              </p>
            ) : null}

            {quickAddOpen ? (
              <div className="mt-3 space-y-3 rounded-lg border border-dashed border-border bg-surface1 p-3">
                <p className="text-sm font-medium text-textPrimary">Quick add — not yet in inventory</p>
                <p className="text-xs text-textMuted">
                  Creates the product (with barcode) at 0 stock, adds it to this purchase, and lists it under Products for search, print, and stock.
                </p>
                <div>
                  <FieldLabel>Product name</FieldLabel>
                  <TextInput value={quickName} onChange={(e) => setQuickName(e.target.value)} required />
                </div>
                <div>
                  <FieldLabel>Category</FieldLabel>
                  <select
                    className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                    value={quickCategoryId}
                    onChange={(e) => {
                      setQuickCategoryId(e.target.value);
                      if (e.target.value) setQuickCategoryName('');
                    }}
                  >
                    <option value="">Select or type new below</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {!quickCategoryId ? (
                    <TextInput
                      className="mt-2"
                      value={quickCategoryName}
                      onChange={(e) => setQuickCategoryName(e.target.value)}
                      placeholder="Or new category name"
                    />
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Sale price (optional)</FieldLabel>
                    <TextInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickSalePrice}
                      onChange={(e) => setQuickSalePrice(e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Purchase cost (optional)</FieldLabel>
                    <TextInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickPurchasePrice}
                      onChange={(e) => setQuickPurchasePrice(e.target.value)}
                    />
                  </div>
                </div>
                <PrimaryButton
                  type="button"
                  disabled={quickBusy}
                  onClick={() => void onQuickAddProduct()}
                >
                  {quickBusy ? 'Adding…' : 'Create & add to purchase'}
                </PrimaryButton>
              </div>
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
          <PaymentMethodFields
              kind={paymentKind}
              onKindChange={setPaymentKind}
              accountId={paymentAccountId}
              onAccountChange={setPaymentAccountId}
            />
          <div>
            <FieldLabel>Paid now</FieldLabel>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={paidAmount}
              onChange={(e) => {
                setPaidEdited(true);
                setPaidAmount(e.target.value);
              }}
              placeholder={String(totalAmount || 0)}
            />
            <p className="mt-1 text-xs text-textSecondary">
              Starts as full total — clear to enter your own amount. Leave blank (without editing) to pay in full.
            </p>
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
  const [paymentKind, setPaymentKind] = useState<SimplePayKind>('CASH');
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
    if (paymentKind === 'EPAY' && !paymentAccountId) {
      setError('Select an e-payment account');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.createSupplierPayment({
        supplierId: Number(supplierId),
        amount: Number(amount),
        paymentMethod: toApiPaymentMethod(paymentKind) as PurchasePaymentMethod,
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
          <PaymentMethodFields
            kind={paymentKind}
            onKindChange={setPaymentKind}
            accountId={paymentAccountId}
            onAccountChange={setPaymentAccountId}
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
