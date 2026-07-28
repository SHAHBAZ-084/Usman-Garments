import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BarcodeLabelModal, ProductIdentityPanel, printBarcodeLabels, type LabelItem } from '../../components/products/BarcodeLabel';
import {
  api,
  type CreateProductInput,
  type Product,
  type ProductCategory,
  type ProductImportPreview,
  type ProductVariantInput,
  type StockMovement,
} from '../../lib/api';
import { formatDate, formatMoney, formatStockMovementType } from '../../lib/format';
import { Plus, Printer, ScanBarcode, Trash2 } from 'lucide-react';
import { DangerButton, Feedback, FieldLabel, GhostButton, IconButton, LoadingState, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';

type VariantDraft = ProductVariantInput & {
  key: string;
  existingId?: number;
  productCode?: string;
  /** True when shopkeeper chose Custom… size (even before typing). */
  sizeCustom?: boolean;
};

const SIZE_PRESETS = ['S', 'M', 'L', 'XL', 'XXL'] as const;
const SELECT_CLASS = 'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm';

function emptyVariant(): VariantDraft {
  return { key: crypto.randomUUID(), size: '', colour: '', currentStock: 0, sizeCustom: false };
}

function sizeSelectValue(v: VariantDraft): string {
  if (SIZE_PRESETS.includes((v.size ?? '') as (typeof SIZE_PRESETS)[number])) return v.size ?? '';
  if (v.sizeCustom || (v.size ?? '') !== '') return '__custom__';
  return '';
}

function variantLabel(variant: { size?: string | null; colour?: string | null; productCode?: string }) {
  return [variant.size, variant.colour].filter(Boolean).join(' / ') || variant.productCode || 'Variant';
}

function labelItemsFromProduct(product: Product, businessName: string): LabelItem[] {
  if (product.variants?.length) {
    return product.variants.filter((variant) => variant.barcode).map((variant) => ({
      key: `variant-${variant.id}`, businessName, productName: product.name, size: variant.size, colour: variant.colour,
      price: variant.salePrice ?? product.salePrice, barcode: variant.barcode!, productCode: variant.productCode,
    }));
  }
  return product.barcode ? [{
    key: `product-${product.id}`, businessName, productName: product.name, price: product.salePrice,
    barcode: product.barcode, productCode: product.productCode,
  }] : [];
}

export function ProductsListPage() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.listProducts>> | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null);
  const [labelSizeKey, setLabelSizeKey] = useState('50x30');
  const [allowQtyEdit, setAllowQtyEdit] = useState(false);
  const [selected, setSelected] = useState<Record<string, LabelItem>>({});
  const [businessName, setBusinessName] = useState('Usman Mall');
  const [creditLine, setCreditLine] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await api.listProducts({ page, pageSize: 20, search: search.trim() || undefined, categoryId: categoryId ? Number(categoryId) : undefined, activeOnly }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [activeOnly, categoryId, page, search]);

  useEffect(() => {
    Promise.all([api.listProductCategories(), api.getSettings()])
      .then(([cats, settings]) => {
        setCategories(cats);
        setBusinessName(settings.businessName);
        setCreditLine(settings.developerCreditLine ?? '');
        setLabelSizeKey(settings.barcodeLabelSize || '50x30');
      })
      .catch(() => setCategories([]));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visibleTargets = useMemo(() => {
    const items: LabelItem[] = [];
    for (const product of result?.items ?? []) {
      items.push(...labelItemsFromProduct(product, businessName));
    }
    return items;
  }, [result, businessName]);

  const allVisibleSelected =
    visibleTargets.length > 0 && visibleTargets.every((item) => selected[item.key]);

  function toggleTarget(item: LabelItem, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[item.key] = item;
      else delete next[item.key];
      return next;
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const item of visibleTargets) {
        if (checked) next[item.key] = item;
        else delete next[item.key];
      }
      return next;
    });
  }

  function openBulkPrint() {
    const items = Object.values(selected);
    if (!items.length) {
      setError('Select at least one product or variant to print.');
      return;
    }
    setError('');
    setAllowQtyEdit(true);
    setLabelItems(items);
  }

  async function downloadTemplate() {
    setError('');
    try {
      const blob = await api.downloadProductImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'usman-mall-products-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Template download failed');
    }
  }

  async function previewImport(file: File) {
    setImporting(true);
    setError('');
    setPreview(null);
    try {
      setPreview(await api.previewProductImport(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import preview failed');
    } finally {
      setImporting(false);
    }
  }

  async function commitImport() {
    if (!preview?.commitPayload.length) return;
    setImporting(true);
    setError('');
    try {
      const committed = await api.commitProductImport(preview.commitPayload);
      const settings = await api.getSettings();
      setPreview(null);
      setAllowQtyEdit(false);
      setLabelSizeKey(settings.barcodeLabelSize || '50x30');
      setLabelItems(committed.products.flatMap((product) => labelItemsFromProduct(product, settings.businessName)));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <PageShell title="Products" subtitle="Manage inventory items, variants, and stock levels" actions={<div className="flex flex-wrap gap-2">
      <Link to="/products/scan"><SecondaryButton type="button"><ScanBarcode className="mr-1.5 inline h-4 w-4" aria-hidden />Scan barcode</SecondaryButton></Link>
      <SecondaryButton onClick={() => void downloadTemplate()}>Download Template</SecondaryButton>
      <label className="btn-secondary cursor-pointer">Import Stock<input className="hidden" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void previewImport(file);
        event.currentTarget.value = '';
      }} /></label>
      <IconButton icon={Printer} label="Print labels" variant="neutral" size="md" onClick={openBulkPrint} disabled={selectedCount === 0}>
        Print Labels{selectedCount ? ` (${selectedCount})` : ''}
      </IconButton>
      <Link to="/products/add"><PrimaryButton type="button"><Plus className="mr-1.5 inline h-4 w-4" aria-hidden />Add Product</PrimaryButton></Link>
    </div>}>
      <Panel className="mb-4"><div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2"><FieldLabel>Search</FieldLabel><TextInput value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, product code, or barcode" /></div>
        <div><FieldLabel>Category</FieldLabel><select className={SELECT_CLASS} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div><FieldLabel>Status</FieldLabel><select className={SELECT_CLASS} value={activeOnly ? 'active' : 'all'} onChange={(event) => { setActiveOnly(event.target.value === 'active'); setPage(1); }}><option value="active">Active only</option><option value="all">Include inactive</option></select></div>
      </div></Panel>
      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}
      {preview ? <Panel className="mb-4"><h2 className="text-lg font-semibold">Import preview</h2><p className="mt-2 text-sm text-textSecondary">{preview.productsToCreate} products ready to create · {preview.validCount} valid rows · {preview.errorCount} errors</p>
        {preview.errors.length ? <ul className="mt-3 list-disc pl-5 text-sm text-danger">{preview.errors.map((item) => <li key={`${item.rowNumber}-${item.message}`}>Row {item.rowNumber}: {item.message}</li>)}</ul> : null}
        <div className="mt-4 flex gap-2"><SecondaryButton onClick={() => setPreview(null)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void commitImport()} disabled={importing || !preview.commitPayload.length}>{importing ? 'Importing…' : 'Confirm Import'}</PrimaryButton></div>
      </Panel> : null}
      <Panel><div className="overflow-x-auto">{loading ? <LoadingState className="py-6" /> : null}<table className="app-data-table min-w-full text-sm"><thead><tr className="text-left text-textSecondary">
        <th className="w-10 px-2 py-2">
          <input
            type="checkbox"
            aria-label="Select all visible labels"
            checked={allVisibleSelected}
            onChange={(event) => toggleSelectAllVisible(event.target.checked)}
          />
        </th>
        <th className="w-10 px-2 py-2" />
        <th className="px-2 py-2 font-medium">Name</th>
        <th className="px-2 py-2 font-medium">Category</th>
        <th className="px-2 py-2 text-right font-medium">Total stock</th>
        <th className="px-2 py-2 text-right font-medium">Sale price</th>
        <th className="px-2 py-2 font-medium">Status</th>
      </tr></thead><tbody>
        {result?.items.map((product) => (
          <ProductListRow
            key={product.id}
            product={product}
            businessName={businessName}
            expanded={expanded === product.id}
            onToggle={() => setExpanded((id) => (id === product.id ? null : product.id))}
            selected={selected}
            onToggleTarget={toggleTarget}
          />
        ))}
        {!loading && result?.items.length === 0 ? <tr><td colSpan={7} className="px-2 py-8 text-center text-textSecondary">No products found.</td></tr> : null}
      </tbody></table></div>
      {result ? <div className="mt-4 flex items-center justify-between"><p className="text-sm text-textSecondary">Page {result.page} of {result.totalPages} ({result.total} products){selectedCount ? ` · ${selectedCount} selected for labels` : ''}</p><div className="flex gap-2"><SecondaryButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</SecondaryButton><SecondaryButton disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next</SecondaryButton></div></div> : null}
      </Panel>
      {labelItems?.length ? (
        <BarcodeLabelModal
          items={labelItems}
          labelSizeKey={labelSizeKey}
          allowQuantityEdit={allowQtyEdit}
          creditLine={creditLine}
          title={allowQtyEdit ? 'Print barcode labels' : 'Imported barcode labels'}
          onClose={() => {
            setLabelItems(null);
            setAllowQtyEdit(false);
          }}
        />
      ) : null}
    </PageShell>
  );
}

function ProductListRow({
  product,
  businessName,
  expanded,
  onToggle,
  selected,
  onToggleTarget,
}: {
  product: Product;
  businessName: string;
  expanded: boolean;
  onToggle: () => void;
  selected: Record<string, LabelItem>;
  onToggleTarget: (item: LabelItem, checked: boolean) => void;
}) {
  const targets = labelItemsFromProduct(product, businessName);
  const hasVariants = (product.variants?.length ?? 0) > 0;
  const productTargetsSelected =
    targets.length > 0 && targets.every((item) => selected[item.key]);

  function toggleProductLevel(checked: boolean) {
    for (const item of targets) onToggleTarget(item, checked);
  }

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-surface1">
        <td className="px-2 py-2">
          {targets.length ? (
            <input
              type="checkbox"
              aria-label={`Select labels for ${product.name}`}
              checked={productTargetsSelected}
              onChange={(event) => toggleProductLevel(event.target.checked)}
            />
          ) : null}
        </td>
        <td className="px-2 py-2">
          <GhostButton className="p-1" aria-label={`${expanded ? 'Hide' : 'Show'} variants`} onClick={onToggle}>
            {expanded ? '⌄' : '›'}
          </GhostButton>
        </td>
        <td className="px-2 py-2">
          <Link className="font-medium text-accent hover:underline" to={`/products/${product.id}`}>{product.name}</Link>
          {product.isLowStock ? <span className="ml-2 rounded bg-bgDanger px-1.5 py-0.5 text-xs text-danger">Low stock</span> : null}
          {product.costNotSet ? <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">Cost not set</span> : null}
        </td>
        <td className="px-2 py-2">{product.category?.name ?? '—'}</td>
        <td className="px-2 py-2 text-right">{product.currentStock}</td>
        <td className="px-2 py-2 text-right">{formatMoney(product.salePrice)}</td>
        <td className="px-2 py-2">{product.isActive ? 'Active' : <span className="text-danger">Inactive</span>}</td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border/60 bg-surface1">
          <td />
          <td />
          <td colSpan={5} className="p-3">
            {hasVariants ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-textSecondary">
                    <th className="w-10">Print</th>
                    <th>Size</th>
                    <th>Colour</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Stock</th>
                    <th>Barcode / Product Code</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants!.map((variant) => {
                    const item = targets.find((t) => t.key === `variant-${variant.id}`);
                    return (
                      <tr key={variant.id}>
                        <td>
                          {item ? (
                            <input
                              type="checkbox"
                              checked={Boolean(selected[item.key])}
                              onChange={(event) => onToggleTarget(item, event.target.checked)}
                            />
                          ) : null}
                        </td>
                        <td>{variant.size ?? '—'}</td>
                        <td>{variant.colour ?? '—'}</td>
                        <td className="text-right">{formatMoney(variant.salePrice ?? product.salePrice)}</td>
                        <td className="text-right">{variant.currentStock}</td>
                        <td className="font-mono text-xs">{variant.barcode ?? '—'} / {variant.productCode}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-textSecondary">
                No variants. Product Code: <span className="font-mono">{product.productCode}</span>
                {product.barcode ? <> · Barcode: <span className="font-mono">{product.barcode}</span></> : null}
              </p>
            )}
          </td>
        </tr>
      ) : null}
    </>
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
          {error ? <Feedback variant="error">{error}</Feedback> : null}
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
  const [creditLine, setCreditLine] = useState('');
  const [labelSizeKey, setLabelSizeKey] = useState('50x30');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
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

  useEffect(() => {
    Promise.all([api.listProductCategories(), api.getSettings()])
      .then(([cats, settings]) => {
        setCategories(cats);
        setBusinessName(settings.businessName);
        setCreditLine(settings.developerCreditLine ?? '');
        setLabelSizeKey(settings.barcodeLabelSize || '50x30');
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
        setCategoryId(p.categoryId ? String(p.categoryId) : '');
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
            sizeCustom: !!(v.size && !(SIZE_PRESETS as readonly string[]).includes(v.size)),
          })),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load product'));
  }, [mode, productId]);

  const allocatedStock = useMemo(
    () => variants.reduce((total, variant) => total + (Number(variant.currentStock) || 0), 0),
    [variants],
  );
  const totalStock = Number(openingStock) || 0;
  const remainingStock = totalStock - allocatedStock;
  const printableLabels = useMemo(
    () => (product ? labelItemsFromProduct(product, businessName) : []),
    [product, businessName],
  );

  async function ensureCategoryId(): Promise<number | null> {
    if (categoryId !== '__new__') return categoryId ? Number(categoryId) : null;
    if (!newCategoryName.trim()) throw new Error('Enter a name for the new category');
    const created = await api.createProductCategory(newCategoryName.trim());
    setCategories((previous) => [...previous, created].sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryId(String(created.id));
    return created.id;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (mode === 'add' && variants.length > 0 && allocatedStock > totalStock) {
      setError('Variant stock cannot be more than Total Stock.');
      return;
    }
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
          .map(({ key: _key, existingId: _existingId, productCode: _productCode, ...v }) => ({
          size: v.size?.trim() || null,
          colour: v.colour?.trim() || null,
          currentStock: Number(v.currentStock) || 0,
        }));

        const created = await api.createProduct({
          ...payload,
          brand: brand.trim() || null,
          lowStockLimit: lowStockLimit.trim() ? Number(lowStockLimit) : null,
          notes: notes.trim() || null,
          variants: variantPayload.length > 0 ? variantPayload : undefined,
          openingStock: totalStock,
        });

        setPendingProductId(created.id);
        setLabelItems(labelItemsFromProduct(created, businessName));
        if (labelItemsFromProduct(created, businessName).length === 0) navigate(`/products/${created.id}`);
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
                <SecondaryButton type="button" onClick={() => printBarcodeLabels(printableLabels, labelSizeKey, creditLine)}>
                  <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
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

            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                className={SELECT_CLASS}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">None</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
                <option value="__new__">+ Add New Category</option>
              </select>
            </div>
            {categoryId === '__new__' ? (
              <div>
                <FieldLabel>New category name</FieldLabel>
                <TextInput
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  onBlur={() => { void ensureCategoryId().catch((err) => setError(err instanceof Error ? err.message : 'Could not save category')); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void ensureCategoryId().catch((err) => setError(err instanceof Error ? err.message : 'Could not save category'));
                    }
                  }}
                  required
                  placeholder="Type name, then Enter or leave field to save"
                />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel>Total Stock</FieldLabel><TextInput type="number" min="0" step="1" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} placeholder="0" disabled={mode === 'edit'} /></div><div><FieldLabel>Sale Price</FieldLabel><TextInput type="number" min="0" step="0.01" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} required /></div></div>
            {mode === 'edit' && product ? <div><FieldLabel>Current stock</FieldLabel><TextInput value={String(product.currentStock)} readOnly className="bg-surface1" /></div> : null}

            {mode === 'edit' && product?.costNotSet ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                Cost not set — profit reports may be inaccurate
              </p>
            ) : null}

            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer font-medium text-textPrimary">More details</summary>
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Purchase Price</FieldLabel>
                    <TextInput type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} placeholder="Leave blank if unknown" />
                  </div>
                  <div>
                    <FieldLabel>Brand</FieldLabel>
                    <TextInput value={brand} onChange={(event) => setBrand(event.target.value)} />
                  </div>
                  <div>
                    <FieldLabel>Low-stock override (optional)</FieldLabel>
                    <TextInput type="number" min="1" step="1" value={lowStockLimit} onChange={(event) => setLowStockLimit(event.target.value)} placeholder="Uses shop default if blank" />
                  </div>
                  <div>
                    <FieldLabel>Notes</FieldLabel>
                    <TextInput value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </div>
                </div>

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
                      {mode === 'add' ? (
                        <p className={remainingStock < 0 ? 'text-sm text-danger' : 'text-sm text-textSecondary'}>
                          Allocated: {allocatedStock} of {totalStock} — {remainingStock} remaining
                        </p>
                      ) : null}
                      {variants.map((v, idx) => (
                        <div key={v.key} className="rounded-lg border border-border p-3">
                          <div className="mb-2 grid gap-2 sm:grid-cols-2">
                            <div>
                              <select
                                className={SELECT_CLASS}
                                value={sizeSelectValue(v)}
                                onChange={(event) => {
                                  const next = [...variants];
                                  if (event.target.value === '__custom__') {
                                    next[idx] = { ...v, size: '', sizeCustom: true };
                                  } else {
                                    next[idx] = { ...v, size: event.target.value, sizeCustom: false };
                                  }
                                  setVariants(next);
                                }}
                              >
                                <option value="">Size</option>
                                {SIZE_PRESETS.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                                <option value="__custom__">Custom…</option>
                              </select>
                              {sizeSelectValue(v) === '__custom__' ? (
                                <TextInput
                                  className="mt-2"
                                  placeholder="Custom size (e.g. 32, 3-4Y)"
                                  value={v.size ?? ''}
                                  onChange={(event) => {
                                    const next = [...variants];
                                    next[idx] = { ...v, size: event.target.value, sizeCustom: true };
                                    setVariants(next);
                                  }}
                                />
                              ) : null}
                            </div>
                            <TextInput
                              placeholder="Colour"
                              value={v.colour ?? ''}
                              onChange={(e) => {
                                const next = [...variants];
                                next[idx] = { ...v, colour: e.target.value };
                                setVariants(next);
                              }}
                            />
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
                            <IconButton
                              icon={Trash2}
                              label="Remove variant row"
                              variant="danger"
                              onClick={() => setVariants((rows) => rows.filter((row) => row.key !== v.key))}
                            >
                              Remove row
                            </IconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
            {mode === 'edit' && product ? <ProductIdentityPanel product={product} /> : null}

            {message ? <Feedback variant="success">{message}</Feedback> : null}
            {error ? <Feedback variant="error">{error}</Feedback> : null}

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
        <BarcodeLabelModal items={labelItems} labelSizeKey={labelSizeKey} creditLine={creditLine} onClose={closeLabelModal} />
      ) : null}
    </PageShell>
  );
}
