import { formatDate, formatMoney } from '../../lib/format';
import type { BusinessSettings, Invoice } from '../../lib/api';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paymentLabel(method: string): string {
  const labels: Record<string, string> = {
    CASH: 'Cash',
    CARD: 'Card',
    EASYPAISA: 'Easypaisa',
    JAZZCASH: 'JazzCash',
    BANK_TRANSFER: 'Bank transfer',
    UDHAAR: 'Udhaar (credit)',
  };
  return labels[method] ?? method;
}

export function buildInvoicePrintHtml(invoice: Invoice, settings: BusinessSettings): string {
  const isA4 = settings.receiptSize === 'A4';
  const widthMm = settings.receiptSize === 'THERMAL_58' ? 58 : settings.receiptSize === 'THERMAL_80' ? 80 : 210;

  const rows = invoice.items
    .map((item) => {
      const variant = [item.variant?.size, item.variant?.colour].filter(Boolean).join(' / ');
      return `<tr>
        <td>${escapeHtml(item.product.name)}${variant ? `<br/><span class="muted">${escapeHtml(variant)}</span>` : ''}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatMoney(item.rate)}</td>
        <td class="num">${formatMoney(item.total)}</td>
      </tr>`;
    })
    .join('');

  const logo = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="" class="logo" />`
    : '';

  const body = `
    <div class="invoice">
      ${logo}
      <h1>${escapeHtml(settings.businessName)}</h1>
      ${settings.tagline ? `<p class="tagline">${escapeHtml(settings.tagline)}</p>` : ''}
      <p class="address">${escapeHtml(settings.address)}</p>
      <p class="phone">${escapeHtml(settings.phone)}</p>
      <hr />
      <p class="inv-no"><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
      <p class="date">${formatDate(invoice.date)}</p>
      ${invoice.customer ? `<p class="customer">Customer: ${escapeHtml(invoice.customer.name)}${invoice.customer.phone ? ` · ${escapeHtml(invoice.customer.phone)}` : ''}</p>` : '<p class="customer">Walk-in customer</p>'}
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${invoice.discount > 0 ? `<p class="row"><span>Discount</span><span>- ${formatMoney(invoice.discount)}</span></p>` : ''}
      <p class="row total"><span>Total</span><span>Rs ${formatMoney(invoice.totalAmount)}</span></p>
      <p class="row"><span>Paid</span><span>Rs ${formatMoney(invoice.paidAmount)}</span></p>
      ${invoice.remainingAmount > 0 ? `<p class="row due"><span>Remaining</span><span>Rs ${formatMoney(invoice.remainingAmount)}</span></p>` : ''}
      ${invoice.paidAmount > invoice.totalAmount ? `<p class="row"><span>Change</span><span>Rs ${formatMoney(invoice.paidAmount - invoice.totalAmount)}</span></p>` : ''}
      <p class="pay">Payment: ${escapeHtml(paymentLabel(invoice.paymentMethod))}</p>
      <hr />
      <p class="footer">${escapeHtml(settings.invoiceFooter)}</p>
      <p class="policy">${escapeHtml(settings.returnPolicy)}</p>
    </div>`;

  if (isA4) {
    return `<!DOCTYPE html><html><head><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #111; margin: 0; }
  .invoice { max-width: 180mm; margin: 0 auto; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  .tagline, .address, .phone { font-size: 10pt; color: #444; margin: 2px 0; }
  .logo { max-height: 48px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; }
  th { font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  .muted { color: #666; font-size: 9pt; }
  .row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 11pt; }
  .total { font-weight: 700; font-size: 13pt; }
  .due { color: #b45309; font-weight: 600; }
  .footer, .policy { font-size: 9pt; color: #555; margin-top: 8px; }
</style></head><body>${body}
<script>window.onload=function(){window.print();};<\/script></body></html>`;
  }

  return `<!DOCTYPE html><html><head><title>Invoice</title>
<style>
  * { box-sizing: border-box; }
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0 auto; width: ${widthMm - 4}mm; max-width: ${widthMm - 4}mm; overflow-x: hidden; }
  h1 { font-size: 14px; margin: 0 0 2px; text-align: center; word-wrap: break-word; }
  .tagline, .address, .phone, .customer, .date, .inv-no { text-align: center; margin: 2px 0; word-wrap: break-word; }
  .logo { display: block; max-height: 36px; max-width: 100%; margin: 0 auto 4px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10px; table-layout: fixed; }
  th, td { padding: 2px 1px; text-align: left; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
  th { border-bottom: 1px dashed #999; }
  .num { text-align: right; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; gap: 4px; }
  .total { font-weight: 700; font-size: 12px; }
  .due { font-weight: 600; }
  .footer, .policy { font-size: 9px; color: #444; margin-top: 6px; text-align: center; word-wrap: break-word; }
  hr { border: none; border-top: 1px dashed #999; margin: 6px 0; }
</style></head><body>${body}
<script>window.onload=function(){window.print();};<\/script></body></html>`;
}

export function printInvoice(invoice: Invoice, settings: BusinessSettings) {
  const html = buildInvoicePrintHtml(invoice, settings);
  const win = window.open('', '_blank', 'width=480,height=720');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
