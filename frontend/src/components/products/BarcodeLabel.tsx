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
        fontSize: 13,
        height: 48,
        margin: 6,
        width: 1.6,
      });
    } catch {
      // invalid barcode value — leave blank
    }
  }, [value]);

  return <svg ref={ref} className="mx-auto max-w-full" />;
}

function LabelCard({ item }: { item: LabelItem }) {
  const variantLine = [item.size, item.colour].filter(Boolean).join(' / ');

  return (
    <div className="barcode-label-card mx-auto w-[220px] rounded border border-border bg-white p-3 text-center text-black">
      <p className="text-xs font-semibold leading-tight">{item.businessName}</p>
      <p className="mt-1 text-sm font-medium leading-tight">{item.productName}</p>
      {variantLine ? <p className="text-xs text-gray-700">{variantLine}</p> : null}
      <p className="mt-1 text-sm font-semibold">Rs {formatMoney(item.price)}</p>
      <div className="my-2 flex justify-center">
        <BarcodeSvg value={item.barcode} />
      </div>
      <p className="font-mono text-[10px] text-gray-600">{item.productCode}</p>
    </div>
  );
}

function buildPrintHtml(items: LabelItem[]): string {
  const cards = items
    .map((item) => {
      const variantLine = [item.size, item.colour].filter(Boolean).join(' / ');
      return `
        <div class="label">
          <p class="shop">${escapeHtml(item.businessName)}</p>
          <p class="name">${escapeHtml(item.productName)}</p>
          ${variantLine ? `<p class="variant">${escapeHtml(variantLine)}</p>` : ''}
          <p class="price">Rs ${formatMoney(item.price)}</p>
          <svg class="barcode" data-barcode="${escapeHtml(item.barcode)}"></svg>
          <p class="code">${escapeHtml(item.productCode)}</p>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><title>Barcode Label</title>
<style>
  body { font-family: Arial, sans-serif; margin: 16px; }
  .label { width: 220px; border: 1px solid #ccc; padding: 12px; text-align: center; page-break-inside: avoid; margin-bottom: 12px; }
  .shop { font-size: 11px; font-weight: 600; margin: 0; }
  .name { font-size: 13px; font-weight: 600; margin: 4px 0 0; }
  .variant { font-size: 11px; color: #444; margin: 2px 0 0; }
  .price { font-size: 13px; font-weight: 600; margin: 6px 0; }
  .code { font-family: monospace; font-size: 10px; color: #555; margin: 4px 0 0; }
  svg { max-width: 100%; }
</style>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
</head><body>${cards}
<script>
  document.querySelectorAll('svg.barcode').forEach(function(el) {
    var v = el.getAttribute('data-barcode');
    if (v) JsBarcode(el, v, { format: 'CODE128', displayValue: true, fontSize: 13, height: 48, margin: 6, width: 1.6 });
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
  const win = window.open('', '_blank', 'width=400,height=600');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export function BarcodeLabelModal({
  items,
  onClose,
}: {
  items: LabelItem[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface2 p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-textPrimary">Barcode Labels</h2>
        <p className="mt-1 text-sm text-textSecondary">
          Labels are ready to print. Each barcode is scannable at the till (Phase 7).
        </p>
        <div className="mt-4 space-y-4">
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
