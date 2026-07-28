import { formatDate, formatMoney } from '../../lib/format';
import { PRINT_SOFTWARE_CREDIT_LINE } from '../../config/printCredit';
import type { BusinessSettings, ExchangeResult, SaleReturn } from '../../lib/api';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function conditionLabel(c: string) {
  if (c === 'GOOD') return 'Good';
  if (c === 'DAMAGED') return 'Damaged';
  return 'Other';
}

export function buildReturnReceiptHtml(
  data: SaleReturn | ExchangeResult,
  settings: BusinessSettings,
  kind: 'return' | 'exchange',
): string {
  const isExchange = kind === 'exchange';
  const exchange = isExchange ? (data as ExchangeResult) : null;
  const saleReturn = isExchange ? null : (data as SaleReturn);
  const title = isExchange ? 'Exchange Receipt' : 'Return Receipt';
  const invoiceNumber = isExchange ? exchange!.invoiceNumber : saleReturn!.invoiceNumber;

  const returnRows = (isExchange ? exchange!.returnItems : saleReturn!.items)
    .map((item) => {
      const name =
        'product' in item && item.product && typeof item.product === 'object' && 'name' in item.product
          ? String(item.product.name)
          : `Product #${item.productId}`;
      const cond = 'condition' in item ? conditionLabel(item.condition) : 'Good';
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${item.quantity}</td>
        <td>${cond}</td>
        <td class="num">${formatMoney(item.lineTotal)}</td>
      </tr>`;
    })
    .join('');

  const newRows =
    isExchange && exchange!.newItems.length
      ? exchange!.newItems
          .map(
            (item) => `<tr>
        <td>Product #${item.productId}</td>
        <td class="num">${item.quantity}</td>
        <td>—</td>
        <td class="num">${formatMoney(item.lineTotal)}</td>
      </tr>`,
          )
          .join('')
      : '';

  const summary = isExchange
    ? `<p class="row"><span>Returned value</span><span>Rs ${formatMoney(exchange!.returnTotal)}</span></p>
       <p class="row"><span>New items</span><span>Rs ${formatMoney(exchange!.newSaleTotal)}</span></p>
       <p class="row total"><span>Net ${exchange!.netAmount >= 0 ? 'due' : 'refund'}</span><span>Rs ${formatMoney(Math.abs(exchange!.netAmount))}</span></p>`
    : `<p class="row total"><span>Refund</span><span>Rs ${formatMoney(saleReturn!.refundAmount)}</span></p>`;

  return `<!DOCTYPE html><html><head><title>${title}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0 auto; width: 76mm; max-width: 76mm; overflow-x: hidden; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; word-wrap: break-word; }
  .meta { text-align: center; font-size: 10px; color: #444; margin: 2px 0; word-wrap: break-word; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; table-layout: fixed; }
  th, td { padding: 3px 1px; border-bottom: 1px dashed #ccc; word-wrap: break-word; overflow-wrap: anywhere; }
  .num { text-align: right; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
  .total { font-weight: 700; font-size: 12px; }
  .footer { text-align: center; font-size: 9px; color: #555; margin-top: 10px; word-wrap: break-word; }
  .credit { text-align: center; font-size: 7px; color: #888; margin-top: 6px; }
</style></head><body>
  <h1>${escapeHtml(settings.businessName)}</h1>
  <p class="meta">${title}</p>
  <p class="meta">Invoice: ${escapeHtml(invoiceNumber)} · ${formatDate(data.date)}</p>
  <h2 style="font-size:12px;margin:8px 0 4px;">Returned items</h2>
  <table><thead><tr><th>Item</th><th>Qty</th><th>Cond.</th><th>Total</th></tr></thead><tbody>${returnRows}</tbody></table>
  ${newRows ? `<h2 style="font-size:12px;margin:8px 0 4px;">New items</h2><table><thead><tr><th>Item</th><th>Qty</th><th></th><th>Total</th></tr></thead><tbody>${newRows}</tbody></table>` : ''}
  ${summary}
  <p class="footer">${escapeHtml(settings.invoiceFooter)}</p>
  <p class="credit">${escapeHtml(PRINT_SOFTWARE_CREDIT_LINE)}</p>
<script>window.onload=function(){window.print();};<\/script>
</body></html>`;
}

export function printReturnReceipt(
  data: SaleReturn | ExchangeResult,
  settings: BusinessSettings,
  kind: 'return' | 'exchange',
) {
  const html = buildReturnReceiptHtml(data, settings, kind);
  const win = window.open('', '_blank', 'width=480,height=720');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
