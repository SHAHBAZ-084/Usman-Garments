import { formatDate, formatMoney } from '../../lib/format';
import { formatDeveloperCreditForPrint } from '../../config/printCredit';
import type { BusinessSettings, ExchangeResult, SaleReturn } from '../../lib/api';
import { resolveLogoDataUrl } from '../../lib/electronPrint';
import { RECEIPT_PAGE_WIDTH_MM, RECEIPT_CONTENT_WIDTH_MM } from './InvoicePrint';

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

export type BuildReturnReceiptHtmlOptions = {
  logoSrc?: string | null;
};

export function buildReturnReceiptHtml(
  data: SaleReturn | ExchangeResult,
  settings: BusinessSettings,
  kind: 'return' | 'exchange',
  options: BuildReturnReceiptHtmlOptions = {},
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

  const logoSrc = options.logoSrc ?? settings.logoUrl;
  const logo = logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="" class="logo" />` : '';

  return `<!DOCTYPE html><html><head><title>${title}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: ${RECEIPT_PAGE_WIDTH_MM}mm auto; margin: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #111; margin: 0 auto; width: ${RECEIPT_CONTENT_WIDTH_MM}mm; max-width: ${RECEIPT_CONTENT_WIDTH_MM}mm; overflow-x: hidden; font-weight: 700; padding: 1.5mm 0 2mm; }
  .logo {
    display: block;
    max-height: 42px;
    max-width: 55%;
    width: auto;
    height: auto;
    object-fit: contain;
    margin: 0 auto 5px;
  }
  h1 { font-size: 14px; font-weight: 800; text-align: center; margin: 0 0 4px; word-wrap: break-word; }
  .meta { text-align: center; font-size: 10px; font-weight: 700; color: #111; margin: 2px 0; word-wrap: break-word; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5px; font-weight: 700; table-layout: fixed; }
  th { font-weight: 800; border-bottom: 1.5px solid #111; padding: 3px 1px 4px; }
  td { padding: 4px 1px; border-bottom: 1px dotted #888; word-wrap: break-word; overflow-wrap: anywhere; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; font-weight: 700; }
  .total { font-weight: 800; font-size: 11.5px; }
  .footer { text-align: center; font-size: 9.5px; font-weight: 700; color: #111; margin-top: 10px; word-wrap: break-word; }
  .credit { text-align: center; font-size: 8px; font-weight: 700; color: #111; margin-top: 8px; }
</style></head><body>
  ${logo}
  <h1>${escapeHtml(settings.businessName)}</h1>
  <p class="meta">${title}</p>
  <p class="meta">Invoice: ${escapeHtml(invoiceNumber)} · ${formatDate(data.date)}</p>
  <h2 style="font-size:12px;margin:8px 0 4px;">Returned items</h2>
  <table><thead><tr><th>Item</th><th>Qty</th><th>Cond.</th><th>Total</th></tr></thead><tbody>${returnRows}</tbody></table>
  ${newRows ? `<h2 style="font-size:12px;margin:8px 0 4px;">New items</h2><table><thead><tr><th>Item</th><th>Qty</th><th></th><th>Total</th></tr></thead><tbody>${newRows}</tbody></table>` : ''}
  ${summary}
  <p class="footer">${escapeHtml(settings.invoiceFooter)}</p>
  <p class="credit">${escapeHtml(formatDeveloperCreditForPrint(settings.developerCreditLine))}</p>
<script>window.onload=function(){window.print();};<\/script>
</body></html>`;
}

export async function printReturnReceipt(
  data: SaleReturn | ExchangeResult,
  settings: BusinessSettings,
  kind: 'return' | 'exchange',
  options: BuildReturnReceiptHtmlOptions = {},
) {
  const logoSrc = await resolveLogoDataUrl(options.logoSrc ?? settings.logoUrl);
  const html = buildReturnReceiptHtml(data, settings, kind, { ...options, logoSrc });
  const win = window.open('', '_blank', 'width=480,height=720');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
