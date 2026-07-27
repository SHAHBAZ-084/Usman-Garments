import JsBarcode from 'jsbarcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  a4GridColumns,
  a4GridRows,
  expandLabelCopies,
  parseLabelSize,
  type ParsedLabelSize,
} from '../../lib/barcodeLabels';
import { formatMoney } from '../../lib/format';
import { FieldLabel, PrimaryButton, SecondaryButton, TextInput } from '../ui/PageShell';

export type LabelItem = {
  key: string;
  businessName: string;
  productName: string;
  size?: string | null;
  colour?: string | null;
  price: number;
  barcode: string;
  productCode: string;
};

const BARCODE_OPTS = {
  format: 'CODE128' as const,
  displayValue: true,
  fontSize: 11,
  height: 40,
  margin: 0,
  width: 1.4,
  textMargin: 2,
};

function barcodeSvgMarkup(value: string, height = 40, width = 1.4): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, { ...BARCODE_OPTS, height, width });
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
        ...BARCODE_OPTS,
        height: compact ? 32 : 40,
        width: compact ? 1.2 : 1.4,
        fontSize: compact ? 9 : 11,
      });
    } catch {
      // invalid barcode value
    }
  }, [value, compact]);

  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

function LabelCard({ item, size }: { item: LabelItem; size: ParsedLabelSize }) {
  const variantLine = [item.size, item.colour].filter(Boolean).join(' · ');
  const compact = size.heightMm <= 25 || size.widthMm <= 40;
  const previewWidthPx = Math.min(280, Math.round(size.widthMm * 3.2));

  return (
    <div
      className="barcode-label-card mx-auto border border-neutral-300 bg-white px-2 py-2 text-center text-black"
      style={{ width: previewWidthPx }}
    >
      <p className="text-[9px] uppercase tracking-wide text-neutral-500">{item.businessName}</p>
      <p className={`mt-1 font-semibold leading-snug ${compact ? 'text-xs' : 'text-sm'}`}>{item.productName}</p>
      {variantLine ? <p className="mt-0.5 text-[10px] text-neutral-600">{variantLine}</p> : null}
      <p className={`mt-1 font-bold tracking-tight ${compact ? 'text-sm' : 'text-base'}`}>Rs {formatMoney(item.price)}</p>
      <div className="mt-2 flex justify-center border-t border-neutral-200 pt-2">
        <BarcodeSvg value={item.barcode} compact={compact} />
      </div>
    </div>
  );
}

function buildPrintHtml(items: LabelItem[], size: ParsedLabelSize): string {
  const compact = size.heightMm <= 25 || size.widthMm <= 40;
  const barcodeHeight = compact ? 28 : 36;
  const barcodeWidth = compact ? 1.1 : 1.3;

  if (size.mode === 'a4') {
    const cols = a4GridColumns(size.widthMm);
    const rows = a4GridRows(size.heightMm);
    const perPage = cols * rows;
    const pages: string[] = [];
    for (let i = 0; i < items.length; i += perPage) {
      const slice = items.slice(i, i + perPage);
      const cells = slice
        .map((item) => {
          const variantLine = [item.size, item.colour].filter(Boolean).join(' · ');
          return `<div class="label">
            <p class="shop">${escapeHtml(item.businessName)}</p>
            <p class="name">${escapeHtml(item.productName)}</p>
            ${variantLine ? `<p class="variant">${escapeHtml(variantLine)}</p>` : ''}
            <p class="price">Rs ${formatMoney(item.price)}</p>
            <div class="barcode-wrap">${barcodeSvgMarkup(item.barcode, barcodeHeight, barcodeWidth)}</div>
          </div>`;
        })
        .join('');
      pages.push(`<div class="page">${cells}</div>`);
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
  .shop { font-size: 7pt; letter-spacing: 0.04em; text-transform: uppercase; color: #666; margin: 0; }
  .name { font-size: ${compact ? '8pt' : '9pt'}; font-weight: 700; margin: 1mm 0 0; line-height: 1.15; }
  .variant { font-size: 7pt; color: #555; margin: 0.5mm 0 0; }
  .price { font-size: ${compact ? '9pt' : '10pt'}; font-weight: 700; margin: 1mm 0 0; }
  .barcode-wrap { margin-top: auto; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
</style></head><body>${pages.join('')}
<script>window.onload = function() { window.print(); };<\/script></body></html>`;
  }

  // Thermal: one label per page at physical size
  const cards = items
    .map((item) => {
      const variantLine = [item.size, item.colour].filter(Boolean).join(' · ');
      return `<div class="label">
        <p class="shop">${escapeHtml(item.businessName)}</p>
        <p class="name">${escapeHtml(item.productName)}</p>
        ${variantLine ? `<p class="variant">${escapeHtml(variantLine)}</p>` : ''}
        <p class="price">Rs ${formatMoney(item.price)}</p>
        <div class="barcode-wrap">${barcodeSvgMarkup(item.barcode, barcodeHeight, barcodeWidth)}</div>
      </div>`;
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
  .shop { font-size: 6.5pt; letter-spacing: 0.04em; text-transform: uppercase; color: #666; margin: 0; }
  .name { font-size: ${compact ? '8pt' : '9pt'}; font-weight: 700; margin: 1mm 0 0; line-height: 1.15; }
  .variant { font-size: 7pt; color: #555; margin: 0.5mm 0 0; }
  .price { font-size: ${compact ? '9pt' : '11pt'}; font-weight: 700; margin: 1mm 0 0; }
  .barcode-wrap { margin-top: auto; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
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

export function printBarcodeLabels(items: LabelItem[], labelSizeKey?: string) {
  if (items.length === 0) return;
  const size = parseLabelSize(labelSizeKey);
  const html = buildPrintHtml(items, size);
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
  allowQuantityEdit = false,
}: {
  items: LabelItem[];
  onClose: () => void;
  title?: string;
  labelSizeKey?: string;
  allowQuantityEdit?: boolean;
}) {
  const [sizeKey, setSizeKey] = useState(labelSizeKey ?? '50x30');
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.key, 1])),
  );
  const size = useMemo(() => parseLabelSize(sizeKey), [sizeKey]);
  const printable = useMemo(
    () => (allowQuantityEdit ? expandLabelCopies(items, quantities) : items),
    [allowQuantityEdit, items, quantities],
  );

  useEffect(() => {
    if (labelSizeKey) setSizeKey(labelSizeKey);
  }, [labelSizeKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-surface2 p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-textPrimary">{title}</h2>
        <p className="mt-1 text-sm text-textSecondary">
          {printable.length} label{printable.length === 1 ? '' : 's'} ready · {size.label}
        </p>

        {allowQuantityEdit ? (
          <div className="mt-4 space-y-2 rounded-lg border border-border bg-surface1 p-3">
            <p className="text-sm font-medium text-textPrimary">Print quantity per item</p>
            {items.map((item) => (
              <div key={item.key} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-textPrimary">
                  {item.productName}
                  {[item.size, item.colour].filter(Boolean).length
                    ? ` (${[item.size, item.colour].filter(Boolean).join(' / ')})`
                    : ''}
                </span>
                <TextInput
                  className="w-20"
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

        <div className="mt-4">
          <FieldLabel>Label size for this print</FieldLabel>
          <select
            className="mt-1 w-full max-w-xs rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {printable.slice(0, 24).map((item) => (
            <LabelCard key={item.key} item={item} size={size} />
          ))}
        </div>
        {printable.length > 24 ? (
          <p className="mt-2 text-sm text-textSecondary">Showing first 24 of {printable.length} in preview.</p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Done
          </SecondaryButton>
          <PrimaryButton type="button" onClick={() => printBarcodeLabels(printable, sizeKey)}>
            Print Label{printable.length > 1 ? 's' : ''}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
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
