import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BarcodeLabelModal, ProductIdentityPanel, type LabelItem } from '../../components/products/BarcodeLabel';
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
  barcode?: string | null;
  /** True when shopkeeper chose Custom… size (even before typing). */
  sizeCustom?: boolean;
  colourCustom?: boolean;
};

const SIZE_PRESETS = ['S', 'M', 'L', 'XL', 'XXL'] as const;
const COLOUR_PRESETS = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Grey', 'Pink', 'Navy', 'Brown'] as const;
const SELECT_CLASS = 'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm';

function emptyVariant(): VariantDraft {
  return {
    key: crypto.randomUUID(),
    size: '',
    colour: '',
    currentStock: 0,
    salePrice: null,
    purchasePrice: null,
    sizeCustom: false,
    colourCustom: false,
  };
}

function sizeSelectValue(v: VariantDraft): string {
  if (SIZE_PRESETS.includes((v.size ?? '') as (typeof SIZE_PRESETS)[number])) return v.size ?? '';
  if (v.sizeCustom || (v.size ?? '') !== '') return '__custom__';
  return '';
}

function colourSelectValue(v: VariantDraft): string {
  if (COLOUR_PRESETS.includes((v.colour ?? '') as (typeof COLOUR_PRESETS)[number])) return v.colour ?? '';
  if (v.colourCustom || (v.colour ?? '') !== '') return '__custom__';
  return '';
}

function variantLabel(variant: { size?: string | null; colour?: string | null; productCode?: string }) {
  return [variant.size, variant.colour].filter(Boolean).join('/') || variant.productCode || 'Variant';
}

function labelItemsFromProduct(product: Product, businessName: string): LabelItem[] {
  if (product.variants?.length) {
    return product.variants.filter((variant) => variant.barcode).map((variant) => ({
      key: `variant-${variant.id}`,
      businessName,
      productName: product.name,
      size: variant.size,
      colour: variant.colour,
      price: variant.salePrice ?? product.salePrice,
      barcode: variant.barcode!,
      productCode: variant.productCode,
      defaultQty: Math.max(1, variant.currentStock || 1),
    }));
  }
  return product.barcode
    ? [{
        key: `product-${product.id}`,
        businessName,
        productName: product.name,
        price: product.salePrice,
        barcode: product.barcode,
        productCode: product.productCode,
        defaultQty: Math.max(1, product.currentStock || 1),
      }]
    : [];
}

export function ProductsListPage() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [businessName, setBusinessName] = useState('Usman Mall');
  const [creditLine, setCreditLine] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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

  useEffect(() => {
    const state = location.state as { printAfterSaveId?: number; savedName?: string } | null;
    if (!state?.printAfterSaveId) return;
    const productId = state.printAfterSaveId;
    const savedName = state.savedName;
    navigate(location.pathname, { replace: true, state: null });
    setSuccessMessage(savedName ? `Saved “${savedName}”. Preview & print barcode labels.` : 'Product saved. Preview & print barcode labels.');
    void api
      .getProduct(productId)
      .then((product) => {
        const items = labelItemsFromProduct(product, businessName);
        if (items.length) {
          setAllowQtyEdit(true);
          setLabelItems(items);
          setExpanded(product.id);
        }
        void load();
      })
      .catch(() => undefined);
  }, [location.state, location.pathname, navigate, businessName, load]);

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

  return (
    <PageShell title="Products" subtitle="Manage inventory, variants, barcodes, and stock" actions={<div className="flex flex-wrap gap-2">
      <Link to="/products/scan"><SecondaryButton type="button"><ScanBarcode className="mr-1.5 inline h-4 w-4" aria-hidden />Scan barcode</SecondaryButton></Link>
      <SecondaryButton onClick={() => void downloadTemplate()}>Download Template</SecondaryButton>
      <label className="btn-secondary cursor-pointer">Import Stock<input className="hidden" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void previewImport(file);
        event.currentTarget.value = '';
      }} /></label>
      <Link to="/products/add"><PrimaryButton type="button"><Plus className="mr-1.5 inline h-4 w-4" aria-hidden />Add Product</PrimaryButton></Link>
    </div>}>
      <Panel className="mb-4"><div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2"><FieldLabel>Search</FieldLabel><TextInput value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, product code, or barcode" /></div>
        <div><FieldLabel>Category</FieldLabel><select className={SELECT_CLASS} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div><FieldLabel>Show</FieldLabel><select className={SELECT_CLASS} value={activeOnly ? 'active' : 'all'} onChange={(event) => { setActiveOnly(event.target.value === 'active'); setPage(1); }}><option value="active">Active only</option><option value="all">Include inactive</option></select></div>
      </div></Panel>
      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}
      {successMessage ? <Feedback variant="success" className="mb-4">{successMessage}</Feedback> : null}
      {preview ? <Panel className="mb-4"><h2 className="text-lg font-semibold">Import preview</h2><p className="mt-2 text-sm text-textSecondary">{preview.productsToCreate} products ready to create · {preview.validCount} valid rows · {preview.errorCount} errors</p>
        {preview.errors.length ? <ul className="mt-3 list-disc pl-5 text-sm text-danger">{preview.errors.map((item) => <li key={`${item.rowNumber}-${item.message}`}>Row {item.rowNumber}: {item.message}</li>)}</ul> : null}
        <div className="mt-4 flex gap-2"><SecondaryButton onClick={() => setPreview(null)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void commitImport()} disabled={importing || !preview.commitPayload.length}>{importing ? 'Importing…' : 'Confirm Import'}</PrimaryButton></div>
      </Panel> : null}
      <Panel><div className="overflow-x-auto">{loading ? <LoadingState className="py-6" /> : null}<table className="app-data-table min-w-full text-sm"><thead><tr className="text-left text-textSecondary">
        <th className="w-12 px-2 py-2 font-medium">Sr No.</th>
        <th className="w-10 px-2 py-2" />
        <th className="px-2 py-2 font-medium">Name</th>
        <th className="px-2 py-2 font-medium">Category</th>
        <th className="px-2 py-2 text-right font-medium">Total stock</th>
        <th className="px-2 py-2 text-right font-medium">Sale price</th>
        <th className="px-2 py-2 text-right font-medium">Purchase</th>
        <th className="px-2 py-2 font-medium">Actions</th>
      </tr></thead><tbody>
        {result?.items.map((product, index) => (
          <ProductListRow
            key={product.id}
            srNo={(result.page - 1) * result.pageSize + index + 1}
            product={product}
            businessName={businessName}
            expanded={expanded === product.id}
            onToggle={() => setExpanded((id) => (id === product.id ? null : product.id))}
            onGenerateBarcode={() => {
              const items = labelItemsFromProduct(product, businessName);
              if (!items.length) {
                setError('No barcodes available for this product yet.');
                return;
              }
              setSuccessMessage('');
              setAllowQtyEdit(true);
              setLabelItems(items);
            }}
          />
        ))}
        {!loading && result?.items.length === 0 ? <tr><td colSpan={8} className="px-2 py-8 text-center text-textSecondary">No products found.</td></tr> : null}
      </tbody></table></div>
      {result ? <div className="mt-4 flex items-center justify-between"><p className="text-sm text-textSecondary">Page {result.page} of {result.totalPages} ({result.total} products)</p><div className="flex gap-2"><SecondaryButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</SecondaryButton><SecondaryButton disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next</SecondaryButton></div></div> : null}
      </Panel>
      {labelItems?.length ? (
        <BarcodeLabelModal
          items={labelItems}
          labelSizeKey={labelSizeKey}
          allowQuantityEdit={allowQtyEdit}
          creditLine={creditLine}
          title="Print Labels — confirm barcode identity before print"
          onClose={() => {
            setLabelItems(null);
            setAllowQtyEdit(false);
            setSuccessMessage('');
          }}
        />
      ) : null}
    </PageShell>
  );
}

function ProductListRow({
  srNo,
  product,
  businessName,
  expanded,
  onToggle,
  onGenerateBarcode,
}: {
  srNo: number;
  product: Product;
  businessName: string;
  expanded: boolean;
  onToggle: () => void;
  onGenerateBarcode: () => void;
}) {
  const targets = labelItemsFromProduct(product, businessName);
  const hasVariants = (product.variants?.length ?? 0) > 0;

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-surface1">
        <td className="px-2 py-2 text-textSecondary">{srNo}</td>
        <td className="px-2 py-2">
          <GhostButton className="p-1" aria-label={`${expanded ? 'Hide' : 'Show'} variants`} onClick={onToggle}>
            {expanded ? '⌄' : '›'}
          </GhostButton>
        </td>
        <td className="px-2 py-2">
          <Link className="font-medium text-accent hover:underline" to={`/products/${product.id}`}>{product.name}</Link>
          {product.isLowStock ? <span className="ml-2 rounded bg-bgDanger px-1.5 py-0.5 text-xs text-danger">Low stock</span> : null}
          {product.costNotSet ? <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">Cost not set</span> : null}
          {!product.isActive ? <span className="ml-2 rounded bg-surface1 px-1.5 py-0.5 text-xs text-textMuted">Inactive</span> : null}
        </td>
        <td className="px-2 py-2">{product.category?.name ?? '—'}</td>
        <td className="px-2 py-2 text-right">{product.currentStock}</td>
        <td className="px-2 py-2 text-right">{formatMoney(product.salePrice)}</td>
        <td className="px-2 py-2 text-right">
          {product.purchasePrice > 0 ? formatMoney(product.purchasePrice) : '—'}
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/products/${product.id}`}>
              <SecondaryButton type="button" className="!px-2 !py-1 text-xs">Edit</SecondaryButton>
            </Link>
            {targets.length ? (
              <GhostButton type="button" className="text-xs text-accent" onClick={onGenerateBarcode}>
                <Printer className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Barcode
              </GhostButton>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border/60 bg-surface1">
          <td />
          <td />
          <td colSpan={6} className="p-3">
            {hasVariants ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-textSecondary">
                    <th>Size</th>
                    <th>Colour</th>
                    <th className="text-right">Sale</th>
                    <th className="text-right">Purchase</th>
                    <th className="text-right">Stock</th>
                    <th>Barcode / Product Code</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants!.map((variant) => (
                    <tr key={variant.id}>
                      <td>{variant.size ?? '—'}</td>
                      <td>{variant.colour ?? '—'}</td>
                      <td className="text-right">{formatMoney(variant.salePrice ?? product.salePrice)}</td>
                      <td className="text-right">
                        {variant.purchasePrice != null
                          ? formatMoney(variant.purchasePrice)
                          : product.purchasePrice > 0
                            ? formatMoney(product.purchasePrice)
                            : '—'}
                      </td>
                      <td className="text-right">{variant.currentStock}</td>
                      <td className="font-mono text-xs">{variant.barcode ?? '—'} / {variant.productCode}</td>
                    </tr>
                  ))}
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
            colourCustom: !!(v.colour && !(COLOUR_PRESETS as readonly string[]).includes(v.colour)),
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
    const hasVariants = variants.some((v) => v.size?.trim() || v.colour?.trim());
    if (mode === 'add' && hasVariants && allocatedStock > totalStock) {
      setError(`Variant stock (${allocatedStock}) cannot exceed Total Stock (${totalStock}).`);
      return;
    }
    if (mode === 'add') {
      if (!hasVariants) {
        setError('Add at least one variant row with qty and sale price. Barcodes are created per variant for sales.');
        return;
      }
      const missingPrice = variants
        .filter((v) => v.size?.trim() || v.colour?.trim() || Number(v.currentStock) > 0)
        .some((v) => v.salePrice == null || Number(v.salePrice) < 0 || Number.isNaN(Number(v.salePrice)));
      if (missingPrice) {
        setError('Each variant needs a sale price (purchase price is optional).');
        return;
      }
    }
    setSaving(true);
    try {
      const resolvedCategoryId = await ensureCategoryId();
      const variantRows = variants.filter(
        (v) => v.size?.trim() || v.colour?.trim() || Number(v.currentStock) > 0 || v.salePrice != null,
      );
      const variantPrices = variantRows
        .map((v) => Number(v.salePrice))
        .filter((n) => !Number.isNaN(n) && n >= 0);
      const productSalePrice = variantPrices.length
        ? Math.min(...variantPrices)
        : Number(salePrice) || 0;
      const variantPurchases = variantRows
        .map((v) => (v.purchasePrice != null ? Number(v.purchasePrice) : NaN))
        .filter((n) => !Number.isNaN(n) && n >= 0);
      const parsedPurchase = purchasePrice.trim()
        ? Number(purchasePrice)
        : variantPurchases.length
          ? Math.min(...variantPurchases)
          : undefined;
      const payload: CreateProductInput = {
        name,
        categoryId: resolvedCategoryId,
        salePrice: productSalePrice,
        ...(parsedPurchase !== undefined ? { purchasePrice: parsedPurchase } : {}),
      };

      if (mode === 'add') {
        const variantPayload = variantRows.map(
          ({ key: _key, existingId: _existingId, productCode: _productCode, sizeCustom: _sc, colourCustom: _cc, barcode: _bc, ...v }) => ({
            size: v.size?.trim() || null,
            colour: v.colour?.trim() || null,
            currentStock: Number(v.currentStock) || 0,
            salePrice: v.salePrice != null ? Number(v.salePrice) : null,
            purchasePrice: v.purchasePrice != null ? Number(v.purchasePrice) : null,
          }),
        );

        const created = await api.createProduct({
          ...payload,
          brand: brand.trim() || null,
          lowStockLimit: lowStockLimit.trim() ? Number(lowStockLimit) : null,
          notes: notes.trim() || null,
          variants: variantPayload.length > 0 ? variantPayload : undefined,
          openingStock: totalStock,
        });

        navigate('/products', {
          state: { printAfterSaveId: created.id, savedName: created.name },
        });
      } else if (productId) {
        await api.updateProduct(productId, {
          ...payload,
          purchasePrice: purchasePrice.trim() ? Number(purchasePrice) : 0,
          brand: brand.trim() || null,
          lowStockLimit: lowStockLimit.trim() ? Number(lowStockLimit) : null,
          notes: notes.trim() || null,
        });

        for (const v of variants) {
          const data = {
            size: v.size?.trim() || null,
            colour: v.colour?.trim() || null,
            salePrice: v.salePrice != null ? Number(v.salePrice) : null,
            purchasePrice: v.purchasePrice != null ? Number(v.purchasePrice) : null,
          };
          if (v.existingId) {
            await api.updateProductVariant(productId, v.existingId, data);
          } else if (v.size?.trim() || v.colour?.trim()) {
            await api.createProductVariant(productId, {
              ...data,
              openingStock: Number(v.currentStock) || 0,
            });
          }
        }

        const refreshed = await api.getProduct(productId);
        setProduct(refreshed);
        setMessage('Product updated.');
        const items = labelItemsFromProduct(refreshed, businessName);
        if (items.length) setLabelItems(items);
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
  }

  const title = mode === 'add' ? 'Add Product' : product?.name ?? 'Edit Product';

  return (
    <PageShell
      title={title}
      subtitle={
        mode === 'add'
          ? 'Set total stock first, then split into size/colour variants with their own prices'
          : 'Update product details and variants'
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/products">
            <SecondaryButton type="button">Back to list</SecondaryButton>
          </Link>
          {mode === 'edit' && product?.isActive ? (
            <>
              {printableLabels.length > 0 ? (
                <SecondaryButton type="button" onClick={() => setLabelItems(printableLabels)}>
                  <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
                  Print Labels
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

            <div>
              <FieldLabel>Total Stock</FieldLabel>
              <TextInput
                type="number"
                min="0"
                step="1"
                value={openingStock}
                onChange={(event) => setOpeningStock(event.target.value)}
                placeholder="e.g. 5"
                disabled={mode === 'edit'}
                required={mode === 'add'}
              />
              {mode === 'add' ? (
                <p className="mt-1 text-xs text-textMuted">
                  Enter full stock first. Variant quantities together cannot exceed this number.
                </p>
              ) : null}
            </div>

            {mode === 'edit' && product ? (
              <div>
                <FieldLabel>Current stock</FieldLabel>
                <TextInput value={String(product.currentStock)} readOnly className="bg-surface1" />
              </div>
            ) : null}

            {mode === 'edit' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Default sale price</FieldLabel>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={salePrice}
                    onChange={(event) => setSalePrice(event.target.value)}
                    placeholder="Fallback if variant price empty"
                  />
                </div>
                <div>
                  <FieldLabel>Default purchase price</FieldLabel>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePrice}
                    onChange={(event) => setPurchasePrice(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
            ) : null}

            {mode === 'edit' && product?.costNotSet ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                Cost not set — profit reports may be inaccurate
              </p>
            ) : null}

            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <FieldLabel>Size / colour variants</FieldLabel>
                  <p className="text-xs text-textMuted">
                    Sale price (required) and purchase price (optional) are set per variant row only.
                  </p>
                </div>
                <GhostButton
                  type="button"
                  onClick={() => {
                    if (mode === 'add' && totalStock > 0 && allocatedStock >= totalStock) {
                      setError('All stock is already allocated. Increase Total Stock or reduce a variant qty.');
                      return;
                    }
                    setVariants((v) => [...v, emptyVariant()]);
                  }}
                >
                  + Add variant
                </GhostButton>
              </div>
              {variants.length === 0 ? (
                <p className="text-sm text-textSecondary">
                  Add a variant row for each size/colour. Sale price is required on every row so barcodes and sales stay correct.
                </p>
              ) : (
                <div className="space-y-3">
                  {mode === 'add' ? (
                    <p className={remainingStock < 0 ? 'text-sm text-danger' : 'text-sm text-textSecondary'}>
                      Allocated: {allocatedStock} of {totalStock} — {remainingStock} remaining
                    </p>
                  ) : null}
                  {variants.map((v, idx) => (
                    <div key={v.key} className="rounded-lg border border-border bg-surface1 p-3">
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
                              placeholder="Custom size"
                              value={v.size ?? ''}
                              onChange={(event) => {
                                const next = [...variants];
                                next[idx] = { ...v, size: event.target.value, sizeCustom: true };
                                setVariants(next);
                              }}
                            />
                          ) : null}
                        </div>
                        <div>
                          <select
                            className={SELECT_CLASS}
                            value={colourSelectValue(v)}
                            onChange={(event) => {
                              const next = [...variants];
                              if (event.target.value === '__custom__') {
                                next[idx] = { ...v, colour: '', colourCustom: true };
                              } else {
                                next[idx] = { ...v, colour: event.target.value, colourCustom: false };
                              }
                              setVariants(next);
                            }}
                          >
                            <option value="">Colour</option>
                            {COLOUR_PRESETS.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            <option value="__custom__">Custom…</option>
                          </select>
                          {colourSelectValue(v) === '__custom__' ? (
                            <TextInput
                              className="mt-2"
                              placeholder="Custom colour"
                              value={v.colour ?? ''}
                              onChange={(event) => {
                                const next = [...variants];
                                next[idx] = { ...v, colour: event.target.value, colourCustom: true };
                                setVariants(next);
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {mode === 'add' || !v.existingId ? (
                          <div>
                            <FieldLabel>Qty</FieldLabel>
                            <TextInput
                              type="number"
                              min="0"
                              placeholder="Qty"
                              value={String(v.currentStock ?? 0)}
                              onChange={(e) => {
                                const requested = Math.max(0, Number(e.target.value) || 0);
                                const others = allocatedStock - (Number(v.currentStock) || 0);
                                const maxAllowed = mode === 'add' && totalStock > 0 ? Math.max(0, totalStock - others) : requested;
                                const next = [...variants];
                                next[idx] = { ...v, currentStock: Math.min(requested, maxAllowed) };
                                setVariants(next);
                              }}
                            />
                          </div>
                        ) : (
                          <div>
                            <FieldLabel>Stock</FieldLabel>
                            <TextInput value={String(v.currentStock ?? 0)} readOnly className="bg-surface2" />
                          </div>
                        )}
                        <div>
                          <FieldLabel>Sale price</FieldLabel>
                          <TextInput
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Sale"
                            value={v.salePrice == null ? '' : String(v.salePrice)}
                            onChange={(e) => {
                              const next = [...variants];
                              const raw = e.target.value;
                              next[idx] = { ...v, salePrice: raw === '' ? null : Number(raw) };
                              setVariants(next);
                            }}
                          />
                        </div>
                        <div>
                          <FieldLabel>Purchase price</FieldLabel>
                          <TextInput
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Cost"
                            value={v.purchasePrice == null ? '' : String(v.purchasePrice)}
                            onChange={(e) => {
                              const next = [...variants];
                              const raw = e.target.value;
                              next[idx] = { ...v, purchasePrice: raw === '' ? null : Number(raw) };
                              setVariants(next);
                            }}
                          />
                        </div>
                      </div>
                      {v.existingId && v.productCode ? (
                        <p className="mt-2 font-mono text-xs text-textMuted">Code: {v.productCode}</p>
                      ) : null}
                      <div className="mt-2 text-right">
                        <IconButton
                          icon={Trash2}
                          label="Remove variant row"
                          variant="danger"
                          onClick={() => setVariants((rows) => rows.filter((row) => row.key !== v.key))}
                        >
                          Remove
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
        ) : (
          <Panel>
            <h2 className="text-sm font-semibold text-textPrimary">Flow</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-textSecondary">
              <li>Enter product name, category, and total stock.</li>
              <li>Add variant rows with size/colour, qty, sale price, and optional purchase price.</li>
              <li>Save — opens the product list with barcode preview for each variant.</li>
              <li>Confirm barcode identity, adjust label size, then print.</li>
            </ol>
          </Panel>
        )}
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
        <BarcodeLabelModal items={labelItems} labelSizeKey={labelSizeKey} creditLine={creditLine} allowQuantityEdit onClose={closeLabelModal} />
      ) : null}
    </PageShell>
  );
}
