import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { formatMoney } from '../../lib/format';
import { PrimaryButton, SecondaryButton } from '../ui/PageShell';

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

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 12,
        height: 52,
        margin: 0,
        width: 1.5,
        textMargin: 4,
      });
    } catch {
      // invalid barcode value
    }
  }, [value]);

  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

function LabelCard({ item }: { item: LabelItem }) {
  const variantLine = [item.size, item.colour].filter(Boolean).join(' · ');

  return (
    <div className="barcode-label-card mx-auto w-[240px] border border-neutral-300 bg-white px-4 py-3 text-center text-black">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">{item.businessName}</p>
      <p className="mt-2 text-base font-semibold leading-snug">{item.productName}</p>
      {variantLine ? <p className="mt-1 text-xs text-neutral-600">{variantLine}</p> : null}
      <p className="mt-2 text-lg font-bold tracking-tight">Rs {formatMoney(item.price)}</p>
      <div className="mt-3 flex justify-center border-t border-neutral-200 pt-3">
        <BarcodeSvg value={item.barcode} />
      </div>
    </div>
  );
}

function buildPrintHtml(items: LabelItem[]): string {
  const cards = items
    .map((item) => {
      const variantLine = [item.size, item.colour].filter(Boolean).join(' · ');
      return `
        <div class="label">
          <p class="shop">${escapeHtml(item.businessName)}</p>
          <p class="name">${escapeHtml(item.productName)}</p>
          ${variantLine ? `<p class="variant">${escapeHtml(variantLine)}</p>` : ''}
          <p class="price">Rs ${formatMoney(item.price)}</p>
          <div class="barcode-wrap">
            <svg class="barcode" data-barcode="${escapeHtml(item.barcode)}"></svg>
          </div>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><title>Barcode Label</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 20px; color: #111; }
  .label {
    width: 240px; border: 1px solid #ccc; padding: 14px 16px; text-align: center;
    page-break-inside: avoid; margin: 0 12px 16px 0; display: inline-block; vertical-align: top;
  }
  .shop { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #666; margin: 0; }
  .name { font-size: 15px; font-weight: 700; margin: 8px 0 0; line-height: 1.25; }
  .variant { font-size: 12px; color: #555; margin: 4px 0 0; }
  .price { font-size: 17px; font-weight: 700; margin: 10px 0 0; }
  .barcode-wrap { margin-top: 12px; padding-top: 10px; border-top: 1px solid #ddd; }
  svg { max-width: 100%; }
</style>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
</head><body>${cards}
<script>
  document.querySelectorAll('svg.barcode').forEach(function(el) {
    var v = el.getAttribute('data-barcode');
    if (v) JsBarcode(el, v, { format: 'CODE128', displayValue: true, fontSize: 12, height: 52, margin: 0, width: 1.5, textMargin: 4 });
  });
  window.onload = function() { window.print(); };
</script></body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printBarcodeLabels(items: LabelItem[]) {
  if (items.length === 0) return;
  const html = buildPrintHtml(items);
  const win = window.open('', '_blank', 'width=480,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export function BarcodeLabelModal({
  items,
  onClose,
  title = 'Barcode Labels',
}: {
  items: LabelItem[];
  onClose: () => void;
  title?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface2 p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-textPrimary">{title}</h2>
        <p className="mt-1 text-sm text-textSecondary">
          {items.length} label{items.length === 1 ? '' : 's'} ready. Print when your printer is set.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <LabelCard key={item.key} item={item} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>Done</SecondaryButton>
          <PrimaryButton type="button" onClick={() => printBarcodeLabels(items)}>
            Print Label{items.length > 1 ? 's' : ''}
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
