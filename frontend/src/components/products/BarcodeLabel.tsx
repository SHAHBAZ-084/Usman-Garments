import JsBarcode from 'jsbarcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  a4GridColumns,
  a4GridRows,
  expandLabelCopies,
  parseLabelSize,
  type ParsedLabelSize,
} from '../../lib/barcodeLabels';
import { formatMoney } from '../../lib/format';
import { shortcutLabel } from '../../lib/shortcuts';
import { useFormShortcuts } from '../../hooks/useFormShortcuts';
import { FieldLabel, PrimaryButton, SecondaryButton } from '../ui/PageShell';

export type LabelItem = {
  key: string;
  businessName: string;
  productName: string;
  size?: string | null;
  colour?: string | null;
  price: number;
  barcode: string;
  productCode: string;
  /** Suggested print copies (usually variant/product stock). */
  defaultQty?: number;
};

/** Whole-label layout presets (encoding stays CODE128 with the exact DB barcode). */
export type LabelLayoutKey = 'standard' | 'priceFocus' | 'compact' | 'minimal';

const LABEL_LAYOUTS: Array<{ key: LabelLayoutKey; label: string; hint: string }> = [
  { key: 'standard', label: 'Standard', hint: 'Shop · name · size/colour · price · barcode' },
  { key: 'priceFocus', label: 'Price focus', hint: 'Larger price for quick shelf reading' },
  { key: 'compact', label: 'Compact', hint: 'Tighter fit for smaller labels' },
  { key: 'minimal', label: 'Minimal', hint: 'Name, size/colour, barcode only' },
];

/** Always CODE128 with the exact stored barcode — required for reliable sale scans. */
const SCAN_FORMAT = 'CODE128' as const;

type BarcodeRenderOpts = {
  height?: number;
  width?: number;
  fontSize?: number;
};

function barcodeSvgMarkup(value: string, opts: BarcodeRenderOpts = {}): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, {
      format: SCAN_FORMAT,
      displayValue: true,
      fontSize: opts.fontSize ?? 11,
      height: opts.height ?? 40,
      margin: 0,
      width: opts.width ?? 1.4,
      textMargin: 2,
    });
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="4" y="24" font-size="10">${escapeHtml(value)}</text></svg>`;
  }
  return svg.outerHTML;
}

function BarcodeSvg({ value, compact }: { value: string; compact?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: SCAN_FORMAT,
        displayValue: true,
        height: compact ? 28 : 40,
        width: compact ? 1.15 : 1.4,
        fontSize: compact ? 9 : 11,
        margin: 0,
        textMargin: 2,
      });
    } catch {
      while (ref.current.firstChild) ref.current.removeChild(ref.current.firstChild);
    }
  }, [value, compact]);

  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

function formatVariantLine(size?: string | null, colour?: string | null) {
  return [size, colour].filter(Boolean).join('/');
}

function variantTitle(item: LabelItem) {
  const line = formatVariantLine(item.size, item.colour);
  return line || 'No size/colour';
}

function LabelCard({
  item,
  size,
  layout,
}: {
  item: LabelItem;
  size: ParsedLabelSize;
  layout: LabelLayoutKey;
}) {
  const variantLine = formatVariantLine(item.size, item.colour);
  const compact = layout === 'compact' || size.heightMm <= 25 || size.widthMm <= 40;
  const previewWidthPx = Math.min(220, Math.round(size.widthMm * 2.8));
  const showShop = layout !== 'minimal';
  const showPrice = layout !== 'minimal';
  const priceClass =
    layout === 'priceFocus'
      ? 'mt-1 text-base font-extrabold tracking-tight'
      : compact
        ? 'mt-0.5 text-xs font-bold tracking-tight'
        : 'mt-0.5 text-sm font-bold tracking-tight';

  return (
    <div
      className="barcode-label-card mx-auto border border-neutral-300 bg-white px-1.5 py-1.5 text-center text-black"
      style={{ width: previewWidthPx, maxWidth: '100%' }}
    >
      {showShop ? (
        <p className={`font-extrabold uppercase tracking-wide text-black ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
          {item.businessName}
        </p>
      ) : null}
      <p className={`font-semibold leading-snug ${showShop ? 'mt-0.5' : ''} ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {item.productName}
      </p>
      {variantLine ? <p className="mt-0.5 text-[10px] font-semibold text-neutral-800">{variantLine}</p> : null}
      {showPrice ? <p className={priceClass}>Rs {formatMoney(item.price)}</p> : null}
      <div className={`flex justify-center overflow-hidden border-t border-neutral-200 ${showPrice || variantLine ? 'mt-1.5 pt-1.5' : 'mt-1 pt-1'}`}>
        <BarcodeSvg value={item.barcode} compact={compact || layout === 'minimal'} />
      </div>
    </div>
  );
}

function buildPrintHtml(
  items: LabelItem[],
  size: ParsedLabelSize,
  creditLine = '',
  layout: LabelLayoutKey = 'standard',
): string {
  const compact = layout === 'compact' || size.heightMm <= 25 || size.widthMm <= 40;
  const barcodeHeight = layout === 'minimal' ? 32 : compact ? 28 : 36;
  const barcodeWidth = compact ? 1.1 : 1.3;
  const credit = creditLine.trim();
  const showShop = layout !== 'minimal';
  const showPrice = layout !== 'minimal';
  const priceSize =
    layout === 'priceFocus' ? (compact ? '11pt' : '13pt') : compact ? '9pt' : '11pt';
  const renderOpts: BarcodeRenderOpts = {
    height: barcodeHeight,
    width: barcodeWidth,
    fontSize: compact ? 9 : 11,
  };

  function labelInner(item: LabelItem): string {
    const variantLine = formatVariantLine(item.size, item.colour);
    return `
      ${showShop ? `<p class="shop">${escapeHtml(item.businessName)}</p>` : ''}
      <p class="name">${escapeHtml(item.productName)}</p>
      ${variantLine ? `<p class="variant">${escapeHtml(variantLine)}</p>` : ''}
      ${showPrice ? `<p class="price">Rs ${formatMoney(item.price)}</p>` : ''}
      <div class="barcode-wrap">${barcodeSvgMarkup(item.barcode, renderOpts)}</div>
    `;
  }

  if (size.mode === 'a4') {
    const cols = a4GridColumns(size.widthMm);
    const rows = a4GridRows(size.heightMm);
    const perPage = cols * rows;
    const pages: string[] = [];
    for (let i = 0; i < items.length; i += perPage) {
      const slice = items.slice(i, i + perPage);
      const cells = slice.map((item) => `<div class="label">${labelInner(item)}</div>`).join('');
      pages.push(
        `<div class="page">${cells}</div>${credit ? `<p class="sheet-credit">${escapeHtml(credit)}</p>` : ''}`,
      );
    }

    return `<!DOCTYPE html>
<html><head><title>Barcode Labels — A4</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 8mm; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
  .page {
    display: grid;
    grid-template-columns: repeat(${cols}, ${size.widthMm}mm);
    grid-auto-rows: ${size.heightMm}mm;
    gap: 2mm;
    page-break-after: always;
    justify-content: start;
  }
  .page:last-child { page-break-after: auto; }
  .label {
    width: ${size.widthMm}mm; height: ${size.heightMm}mm;
    border: 0.4pt dashed #999; padding: 1.5mm; text-align: center;
    overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;
  }
  .shop { font-size: 8pt; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: #111; margin: 0; }
  .name { font-size: ${compact ? '8pt' : '9pt'}; font-weight: 700; margin: 1mm 0 0; line-height: 1.15; }
  .variant { font-size: 7.5pt; font-weight: 600; color: #333; margin: 0.5mm 0 0; }
  .price { font-size: ${priceSize}; font-weight: 800; margin: 1mm 0 0; }
  .barcode-wrap { margin-top: auto; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
  .sheet-credit { font-size: 6pt; color: #888; text-align: center; margin: 2mm 0 0; page-break-after: always; }
  .sheet-credit:last-child { page-break-after: auto; }
</style></head><body>${pages.join('')}
<script>window.onload = function() { window.print(); };<\/script></body></html>`;
  }

  const cards = items
    .map((item) => {
      const itemCredit =
        credit && size.heightMm >= 30 ? `<p class="credit">${escapeHtml(credit)}</p>` : '';
      return `<div class="label">${labelInner(item)}${itemCredit}</div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><title>Barcode Labels</title>
<style>
  * { box-sizing: border-box; }
  @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
  .label {
    width: ${size.widthMm}mm; height: ${size.heightMm}mm;
    padding: 1.5mm 2mm; text-align: center; page-break-after: always;
    overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;
  }
  .label:last-child { page-break-after: auto; }
  .shop { font-size: 7.5pt; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: #111; margin: 0; }
  .name { font-size: ${compact ? '8pt' : '9pt'}; font-weight: 700; margin: 1mm 0 0; line-height: 1.15; }
  .variant { font-size: 7.5pt; font-weight: 600; color: #333; margin: 0.5mm 0 0; }
  .price { font-size: ${priceSize}; font-weight: 800; margin: 1mm 0 0; }
  .barcode-wrap { margin-top: auto; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
  .credit { font-size: 5pt; color: #888; margin: 0.5mm 0 0; line-height: 1.1; }
</style></head><body>${cards}
<script>window.onload = function() { window.print(); };<\/script></body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printBarcodeLabels(
  items: LabelItem[],
  labelSizeKey?: string,
  creditLine = '',
  labelLayout: LabelLayoutKey = 'standard',
) {
  if (items.length === 0) return;
  const size = parseLabelSize(labelSizeKey);
  const html = buildPrintHtml(items, size, creditLine, labelLayout);
  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export function BarcodeLabelModal({
  items,
  onClose,
  title = 'Barcode Labels',
  labelSizeKey,
  allowQuantityEdit = true,
  creditLine = '',
}: {
  items: LabelItem[];
  onClose: () => void;
  title?: string;
  labelSizeKey?: string;
  allowQuantityEdit?: boolean;
  creditLine?: string;
}) {
  const [sizeKey, setSizeKey] = useState(labelSizeKey ?? '50x30');
  const [labelLayout, setLabelLayout] = useState<LabelLayoutKey>('standard');
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.key, Math.max(1, Math.min(99, item.defaultQty ?? 1))])),
  );
  const size = useMemo(() => parseLabelSize(sizeKey), [sizeKey]);
  const printable = useMemo(
    () => (allowQuantityEdit ? expandLabelCopies(items, quantities) : items),
    [allowQuantityEdit, items, quantities],
  );
  const layoutMeta = LABEL_LAYOUTS.find((l) => l.key === labelLayout) ?? LABEL_LAYOUTS[0]!;

  useEffect(() => {
    if (labelSizeKey) setSizeKey(labelSizeKey);
  }, [labelSizeKey]);

  useFormShortcuts({
    onPrint: () => printBarcodeLabels(printable, sizeKey, creditLine, labelLayout),
    onCancel: onClose,
    printEnabled: printable.length > 0,
  });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const previewItems = useMemo(() => {
    const unique = new Map<string, LabelItem>();
    for (const item of printable) {
      if (!unique.has(item.key)) unique.set(item.key, item);
    }
    return Array.from(unique.values()).slice(0, 12);
  }, [printable]);

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-label-modal-title"
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface2 shadow-2xl"
        style={{ maxHeight: 'min(92vh, 720px)', width: 'min(100%, 42rem)' }}
      >
        <div className="shrink-0 border-b border-border px-4 py-3">
          <h2 id="barcode-label-modal-title" className="text-base font-semibold text-textPrimary sm:text-lg">
            {title}
          </h2>
          <p className="mt-1 text-sm text-textSecondary">
            {printable.length} label{printable.length === 1 ? '' : 's'} ready · {size.label}
          </p>
          <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-950 dark:text-amber-100">
            Each label encodes the exact sale barcode (CODE128). Scan that barcode at New Sale to load the matching size/colour.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {allowQuantityEdit ? (
            <div className="space-y-2 rounded-lg border border-border bg-surface1 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-textPrimary">Print quantity per variant</p>
                <p className="text-xs text-textMuted">Size/colour · copies</p>
              </div>
              {items.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3 rounded-md border border-border/70 bg-surface2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-textPrimary">{variantTitle(item)}</p>
                    <p className="truncate text-xs text-textSecondary">
                      {item.productName}
                      <span className="ml-2 font-mono text-[11px] text-textMuted">{item.barcode}</span>
                    </p>
                  </div>
                  <input
                    aria-label={`Print quantity for ${variantTitle(item)}`}
                    className="h-9 w-[4.5rem] shrink-0 rounded-lg border border-border bg-surface1 px-2 text-center text-sm font-semibold text-textPrimary outline-none ring-accent focus:ring-2"
                    type="number"
                    min={1}
                    max={99}
                    value={String(quantities[item.key] ?? 1)}
                    onChange={(event) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [item.key]: Math.max(1, Math.min(99, Number(event.target.value) || 1)),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>Label size</FieldLabel>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                value={
                  ['40x30', '50x25', '50x30', 'a4'].includes(sizeKey) || size.isCustom ? sizeKey : '50x30'
                }
                onChange={(event) => setSizeKey(event.target.value)}
              >
                <option value="40x30">40 × 30 mm (thermal)</option>
                <option value="50x25">50 × 25 mm (thermal)</option>
                <option value="50x30">50 × 30 mm (thermal)</option>
                <option value="a4">A4 sheet (grid)</option>
                {size.isCustom ? <option value={size.key}>{size.label}</option> : null}
              </select>
            </div>
            <div>
              <FieldLabel>Label style</FieldLabel>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                value={labelLayout}
                onChange={(event) => setLabelLayout(event.target.value as LabelLayoutKey)}
              >
                {LABEL_LAYOUTS.map((style) => (
                  <option key={style.key} value={style.key}>
                    {style.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-textMuted">{layoutMeta.hint}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {previewItems.map((item) => (
              <LabelCard key={item.key} item={item} size={size} layout={labelLayout} />
            ))}
          </div>
          {items.length > previewItems.length ? (
            <p className="mt-2 text-xs text-textSecondary">
              Preview shows one sample per variant. Print uses the quantities above.
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border bg-surface2 px-4 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton type="button" onClick={onClose}>
              Done (Esc)
            </SecondaryButton>
            <PrimaryButton
              type="button"
              onClick={() => printBarcodeLabels(printable, sizeKey, creditLine, labelLayout)}
            >
              {shortcutLabel(printable.length > 1 ? 'Print Labels' : 'Print Label', 'F10')}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function ProductIdentityPanel({ product }: { product: { productCode: string; barcode: string | null } }) {
  return (
    <div className="rounded-lg border border-border bg-surface1 p-4">
      <h3 className="mb-3 text-sm font-semibold text-textPrimary">Product Identity</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-textSecondary">Product Code</p>
          <p className="font-mono text-sm text-textPrimary">{product.productCode}</p>
        </div>
        <div>
          <p className="text-xs text-textSecondary">Barcode</p>
          <p className="font-mono text-sm text-textPrimary">{product.barcode ?? '—'}</p>
        </div>
      </div>
    </div>
  );
}
