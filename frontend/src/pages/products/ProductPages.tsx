import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BarcodeLabelModal,
  ProductIdentityPanel,
  printBarcodeLabels,
  type LabelItem,
} from '../../components/products/BarcodeLabel';
import {
  api,
  type CreateProductInput,
  type Product,
  type ProductCategory,
  type ProductVariantInput,
  type StockMovement,
} from '../../lib/api';
import { formatDate, formatMoney, formatStockMovementType } from '../../lib/format';
import {
  DangerButton,
  FieldLabel,
  GhostButton,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';

type VariantDraft = ProductVariantInput & {
  key: string;
  existingId?: number;
  productCode?: string;
  barcode?: string | null;
};

function emptyVariant(): VariantDraft {
  return { key: crypto.randomUUID(), size: '', colour: '', currentStock: 0 };
}

function variantLabel(v: { size?: string | null; colour?: string | null; productCode?: string }) {
  return [v.size, v.colour].filter(Boolean).join(' / ') || v.productCode || 'Variant';
}

function labelItemsFromProduct(product: Product, businessName: string): LabelItem[] {
  if (product.variants && product.variants.length > 0) {
    return product.variants
      .filter((v) => v.barcode)
      .map((v) => ({
        key: `v-${v.id}`,
        businessName,
        productName: product.name,
        size: v.size,
        colour: v.colour,
        price: v.salePrice ?? product.salePrice,
        barcode: v.barcode!,
        productCode: v.productCode,
      }));
  }
  if (!product.barcode) return [];
  return [{
    key: `p-${product.id}`,
    businessName,
    productName: product.name,
    price: product.salePrice,
    barcode: product.barcode,
    productCode: product.productCode,
  }];
}

export function ProductsListPage() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.listProducts>> | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listProducts({
        page,
        pageSize: 20,
        search: search.trim() || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        activeOnly,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId, activeOnly]);

  useEffect(() => {
    api.listProductCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell
      title="Products"
      subtitle="Manage inventory items, variants, and stock levels"
      actions={
        <Link to="/products/add">
          <PrimaryButton type="button">Add Product</PrimaryButton>
        </Link>
      }
    >
      <Panel className="mb-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <FieldLabel>Search</FieldLabel>
            <TextInput
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Name, product code, or barcode"
            />
          </div>
          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={categoryId}
              onChange={(e) => {
                setPage(1);
                setCategoryId(e.target.value);
              }}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={activeOnly ? 'active' : 'all'}
              onChange={(e) => {
                setPage(1);
                setActiveOnly(e.target.value === 'active');
              }}
            >
              <option value="active">Active only</option>
              <option value="all">Include inactive</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </SecondaryButton>
        </div>
      </Panel>

      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

      <Panel>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Product Code</th>
                <th className="px-2 py-2 font-medium">Category</th>
                <th className="px-2 py-2 font-medium text-right">Stock</th>
                <th className="px-2 py-2 font-medium text-right">Sale Price</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((product) => (
                <tr key={product.id} className="border-b border-border/60 hover:bg-surface1">
                  <td className="px-2 py-2">
                    <Link className="font-medium text-accent hover:underline" to={`/products/${product.id}`}>
                      {product.name}
                    </Link>
                    {product.isLowStock ? (
                      <span className="ml-2 rounded bg-bgDanger px-1.5 py-0.5 text-xs text-danger">Low stock</span>
                    ) : null}
                    {product.costNotSet ? (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">Cost not set</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{product.productCode}</td>
                  <td className="px-2 py-2">{product.category?.name ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{product.currentStock}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(product.salePrice)}</td>
                  <td className="px-2 py-2">
                    {product.isActive ? (
                      <span className="text-textSecondary">Active</span>
                    ) : (
                      <span className="text-danger">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && result?.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-textSecondary">
                    No products found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {result && result.totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-textSecondary">
              Page {result.page} of {result.totalPages} ({result.total} products)
            </p>
            <div className="flex gap-2">
              <SecondaryButton type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Panel>
    </PageShell>
  );
}

function StockAdjustModal({
  product,
  onClose,
  onDone,
}: {
  product: Product;
  onClose: () => void;
  onDone: () => void;
}) {
  const hasVariants = (product.variants?.length ?? 0) > 0;
  const [variantId, setVariantId] = useState<number | ''>('');
  const [direction, setDirection] = useState<'add' | 'reduce'>('add');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const qty = Number(quantity);
    if (!(qty > 0 && Number.isInteger(qty))) {
      setError('Quantity must be a positive whole number');
      return;
    }
    if (hasVariants && !variantId) {
      setError('Select a variant');
      return;
    }
    setSaving(true);
    try {
      await api.adjustProductStock(product.id, {
        variantId: variantId ? Number(variantId) : undefined,
        quantity: qty,
        direction,
        note: note.trim() || undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock adjustment failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Panel className="w-full max-w-md">
        <h2 className="text-lg font-semibold text-textPrimary">Adjust Stock</h2>
        <p className="mt-1 text-sm text-textSecondary">{product.name}</p>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          {hasVariants ? (
            <div>
              <FieldLabel>Variant</FieldLabel>
              <select
                className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select variant</option>
                {product.variants!.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v)} — stock {v.currentStock}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <FieldLabel>Direction</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'add' | 'reduce')}
            >
              <option value="add">Add stock</option>
              <option value="reduce">Reduce stock</option>
            </select>
          </div>
          <div>
            <FieldLabel>Quantity</FieldLabel>
            <TextInput type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Note (optional)</FieldLabel>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <SecondaryButton type="button" onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Apply'}</PrimaryButton>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function StockHistoryPanel({ productId, refreshKey }: { productId: number; refreshKey: number }) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listStockMovements(productId, { pageSize: 50 })
      .then((r) => setMovements(r.items))
      .catch(() => setMovements([]))
      .finally(() => setLoading(false));
  }, [productId, refreshKey]);

  return (
    <Panel>
      <h2 className="mb-4 text-lg font-semibold text-textPrimary">Stock History</h2>
      {loading ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : movements.length === 0 ? (
        <p className="text-sm text-textSecondary">No stock movements yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Variant</th>
                <th className="px-2 py-2 font-medium text-right">Qty</th>
                <th className="px-2 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-border/60">
                  <td className="px-2 py-2">{formatDate(m.createdAt)}</td>
                  <td className="px-2 py-2">{formatStockMovementType(m.type)}</td>
                  <td className="px-2 py-2">
                    {m.variant ? variantLabel(m.variant) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">{m.quantity}</td>
                  <td className="px-2 py-2">{m.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ProductFormPage({ mode }: { mode: 'add' | 'edit' }) {
  const navigate = useNavigate();
  const params = useParams();
  const productId = mode === 'edit' ? Number(params.id) : null;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [businessName, setBusinessName] = useState('Usman Mall');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [brand, setBrand] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [lowStockLimit, setLowStockLimit] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [notes, setNotes] = useState('');
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null);
  const [pendingProductId, setPendingProductId] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const hasVariantRows = variants.length > 0;

  useEffect(() => {
    Promise.all([api.listProductCategories(), api.getSettings()])
      .then(([cats, settings]) => {
        setCategories(cats);
        setBusinessName(settings.businessName);
      })
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (mode !== 'edit' || !productId) return;
    api
      .getProduct(productId)
      .then((p) => {
        setProduct(p);
        setName(p.name);
        setCategoryId(p.categoryId ?? '');
        setBrand(p.brand ?? '');
        setPurchasePrice(p.purchasePrice > 0 ? String(p.purchasePrice) : '');
        setSalePrice(String(p.salePrice));
        setLowStockLimit(p.lowStockLimit != null ? String(p.lowStockLimit) : '');
        setNotes(p.notes ?? '');
        setVariants(
          (p.variants ?? []).map((v) => ({
            key: String(v.id),
            existingId: v.id,
            size: v.size ?? '',
            colour: v.colour ?? '',
            productCode: v.productCode,
            barcode: v.barcode,
            purchasePrice: v.purchasePrice,
            salePrice: v.salePrice,
            currentStock: v.currentStock,
          })),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load product'));
  }, [mode, productId]);

  const printableLabels = useMemo(
    () => (product ? labelItemsFromProduct(product, businessName) : []),
    [product, businessName],
  );

  async function ensureCategoryId(): Promise<number | null> {
    if (categoryId) return Number(categoryId);
    const trimmed = newCategoryName.trim();
    if (!trimmed) return null;
    const created = await api.createProductCategory(trimmed);
    setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryId(created.id);
    setNewCategoryName('');
    return created.id;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const resolvedCategoryId = await ensureCategoryId();
      const parsedPurchase = purchasePrice.trim() ? Number(purchasePrice) : undefined;
      const payload: CreateProductInput = {
        name,
        categoryId: resolvedCategoryId,
        salePrice: Number(salePrice),
        ...(parsedPurchase !== undefined ? { purchasePrice: parsedPurchase } : {}),
      };

      if (mode === 'add') {
        const variantPayload = variants
          .filter((v) => v.size?.trim() || v.colour?.trim())
          .map(({ key: _k, existingId: _e, productCode: _pc, barcode: _bc, ...v }) => ({
          size: v.size?.trim() || null,
          colour: v.colour?.trim() || null,
          currentStock: Number(v.currentStock) || 0,
        }));

        const created = await api.createProduct({
          ...payload,
          variants: variantPayload.length > 0 ? variantPayload : undefined,
          openingStock:
            variantPayload.length === 0 && openingStock.trim()
              ? Number(openingStock)
              : undefined,
        });

        setPendingProductId(created.id);
        setLabelItems(labelItemsFromProduct(created, businessName));
        setMessage('Product saved. Print the barcode label below.');
      } else if (productId) {
        await api.updateProduct(productId, {
          ...payload,
          purchasePrice: purchasePrice.trim() ? Number(purchasePrice) : 0,
          brand: brand.trim() || null,
          lowStockLimit: lowStockLimit.trim() ? Number(lowStockLimit) : null,
          notes: notes.trim() || null,
        });

        const newVariantLabels: LabelItem[] = [];

        for (const v of variants) {
          const data = {
            size: v.size?.trim() || null,
            colour: v.colour?.trim() || null,
          };
          if (v.existingId) {
            await api.updateProductVariant(productId, v.existingId, data);
          } else if (v.size?.trim() || v.colour?.trim()) {
            const createdVariant = await api.createProductVariant(productId, {
              ...data,
              openingStock: Number(v.currentStock) || 0,
            });
            if (createdVariant.barcode) {
              newVariantLabels.push({
                key: `new-v-${createdVariant.id}`,
                businessName,
                productName: name,
                size: createdVariant.size,
                colour: createdVariant.colour,
                price: createdVariant.salePrice ?? Number(salePrice),
                barcode: createdVariant.barcode,
                productCode: createdVariant.productCode,
              });
            }
          }
        }

        const refreshed = await api.getProduct(productId);
        setProduct(refreshed);
        setMessage('Product updated.');
        if (newVariantLabels.length > 0) {
          setLabelItems(newVariantLabels);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate() {
    if (!productId || !window.confirm('Deactivate this product? It will be hidden from the default list.')) return;
    setError('');
    try {
      await api.deactivateProduct(productId);
      setMessage('Product deactivated.');
      const refreshed = await api.getProduct(productId);
      setProduct(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deactivate failed');
    }
  }

  function closeLabelModal() {
    setLabelItems(null);
    if (mode === 'add' && pendingProductId) {
      navigate(`/products/${pendingProductId}`);
    }
  }

  const title = mode === 'add' ? 'Add Product' : product?.name ?? 'Edit Product';

  return (
    <PageShell
      title={title}
      subtitle={mode === 'add' ? 'Enter name, category, price, and stock — codes are assigned automatically' : 'Update product details and variants'}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/products">
            <SecondaryButton type="button">Back to list</SecondaryButton>
          </Link>
          {mode === 'edit' && product?.isActive ? (
            <>
              {printableLabels.length > 0 ? (
                <SecondaryButton type="button" onClick={() => printBarcodeLabels(printableLabels)}>
                  Print Label{printableLabels.length > 1 ? 's' : ''}
                </SecondaryButton>
              ) : null}
              <PrimaryButton type="button" onClick={() => setShowAdjust(true)}>Adjust Stock</PrimaryButton>
              <DangerButton type="button" onClick={() => void onDeactivate()}>Deactivate</DangerButton>
            </>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <FieldLabel>Product name</FieldLabel>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Or new category</FieldLabel>
                <TextInput
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Type to create on save"
                  disabled={Boolean(categoryId)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Purchase price (optional)</FieldLabel>
                <TextInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="Leave blank if unknown"
                />
              </div>
              <div>
                <FieldLabel>Sale price</FieldLabel>
                <TextInput type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required />
              </div>
            </div>

            {mode === 'edit' && product?.costNotSet ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                Cost not set — profit reports may be inaccurate
              </p>
            ) : null}

            {mode === 'add' && !hasVariantRows ? (
              <div>
                <FieldLabel>Opening stock</FieldLabel>
                <TextInput type="number" min="0" step="1" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} placeholder="0" />
              </div>
            ) : null}

            {mode === 'edit' && product ? (
              <>
                <ProductIdentityPanel product={product} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Brand (optional)</FieldLabel>
                    <TextInput value={brand} onChange={(e) => setBrand(e.target.value)} />
                  </div>
                  <div>
                    <FieldLabel>Current stock</FieldLabel>
                    <TextInput value={String(product.currentStock)} readOnly className="bg-surface1" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Low stock limit (optional)</FieldLabel>
                    <TextInput
                      type="number"
                      min="1"
                      step="1"
                      value={lowStockLimit}
                      onChange={(e) => setLowStockLimit(e.target.value)}
                      placeholder="Uses shop default if blank"
                    />
                  </div>
                  <div>
                    <FieldLabel>Notes (optional)</FieldLabel>
                    <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
              </>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <FieldLabel>Size / colour variants (optional)</FieldLabel>
                <GhostButton type="button" onClick={() => setVariants((v) => [...v, emptyVariant()])}>
                  + Add row
                </GhostButton>
              </div>
              {variants.length === 0 ? (
                <p className="text-sm text-textSecondary">Leave empty for a single-size product.</p>
              ) : (
                <div className="space-y-3">
                  {variants.map((v, idx) => (
                    <div key={v.key} className="rounded-lg border border-border p-3">
                      <div className="mb-2 grid gap-2 sm:grid-cols-2">
                        <TextInput placeholder="Size" value={v.size ?? ''} onChange={(e) => {
                          const next = [...variants];
                          next[idx] = { ...v, size: e.target.value };
                          setVariants(next);
                        }} />
                        <TextInput placeholder="Colour" value={v.colour ?? ''} onChange={(e) => {
                          const next = [...variants];
                          next[idx] = { ...v, colour: e.target.value };
                          setVariants(next);
                        }} />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {mode === 'add' || !v.existingId ? (
                          <TextInput
                            type="number"
                            min="0"
                            placeholder="Opening stock"
                            value={String(v.currentStock ?? 0)}
                            onChange={(e) => {
                              const next = [...variants];
                              next[idx] = { ...v, currentStock: Number(e.target.value) };
                              setVariants(next);
                            }}
                          />
                        ) : (
                          <TextInput value={`Stock: ${v.currentStock ?? 0}`} readOnly className="bg-surface1" />
                        )}
                        {v.existingId && v.productCode ? (
                          <TextInput value={`Code: ${v.productCode}`} readOnly className="bg-surface1 font-mono text-xs" />
                        ) : null}
                      </div>
                      <div className="mt-2 text-right">
                        <GhostButton
                          type="button"
                          onClick={() => setVariants((rows) => rows.filter((row) => row.key !== v.key))}
                        >
                          Remove row
                        </GhostButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {message ? <p className="text-sm text-accent">{message}</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : mode === 'add' ? 'Save Product' : 'Save Changes'}
            </PrimaryButton>
          </form>
        </Panel>

        {mode === 'edit' && productId ? (
          <StockHistoryPanel productId={productId} refreshKey={historyKey} />
        ) : null}
      </div>

      {showAdjust && product ? (
        <StockAdjustModal
          product={product}
          onClose={() => setShowAdjust(false)}
          onDone={async () => {
            const refreshed = await api.getProduct(product.id);
            setProduct(refreshed);
            setHistoryKey((k) => k + 1);
          }}
        />
      ) : null}

      {labelItems && labelItems.length > 0 ? (
        <BarcodeLabelModal items={labelItems} onClose={closeLabelModal} />
      ) : null}
    </PageShell>
  );
}
