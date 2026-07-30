import JsBarcode from 'jsbarcode';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { BusinessSettings, Invoice } from '../../lib/api';
import { formatDeveloperCreditForPrint } from '../../config/printCredit';

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

function contactLines(settings: BusinessSettings): string[] {
  const lines = [settings.phone?.trim(), settings.whatsapp?.trim()].filter(Boolean) as string[];
  return [...new Set(lines)];
}

/** Encode invoice number exactly as stored — used for return scan lookup. */
function invoiceBarcodeSvg(invoiceNumber: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, invoiceNumber, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 11,
      height: 36,
      margin: 0,
      width: 1.35,
      textMargin: 2,
    });
  } catch {
    return `<div class="barcode-fallback">${escapeHtml(invoiceNumber)}</div>`;
  }
  return svg.outerHTML;
}

export function buildInvoicePrintHtml(invoice: Invoice, settings: BusinessSettings): string {
  const isA4 = settings.receiptSize === 'A4';
  const widthMm = settings.receiptSize === 'THERMAL_58' ? 58 : settings.receiptSize === 'THERMAL_80' ? 80 : 210;
  const amountReceived = invoice.amountReceived ?? invoice.paidAmount;
  const changeAmount =
    invoice.changeAmount ??
    Math.max(0, amountReceived - invoice.totalAmount - (invoice.udhaarRecoveryApplied ?? 0));

  const customerLine = invoice.customer
    ? `${escapeHtml(invoice.customer.name)}${
        invoice.customer.phone ? `<br/><span class="muted">${escapeHtml(invoice.customer.phone)}</span>` : ''
      }`
    : null;

  const rows = invoice.items
    .map((item) => {
      const variant = [item.variant?.size, item.variant?.colour].filter(Boolean).join('/');
      const name = escapeHtml(item.product.name);
      const variantHtml = variant ? `<div class="variant">${escapeHtml(variant)}</div>` : '';
      return `<tr>
        <td class="col-item"><div class="item-name">${name}</div>${variantHtml}</td>
        <td class="col-qty">${item.quantity}</td>
        <td class="col-rate">${formatMoney(item.rate)}</td>
        <td class="col-total">${formatMoney(item.total)}</td>
      </tr>`;
    })
    .join('');

  const logo = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="" class="logo" />`
    : '';

  const contacts = contactLines(settings)
    .map((line) => `<div class="contact">${escapeHtml(line)}</div>`)
    .join('');

  const summaryParts: string[] = [
    `<div class="sum-row"><span>Subtotal</span><span>Rs ${formatMoney(invoice.subtotal)}</span></div>`,
  ];
  if (invoice.discount > 0) {
    summaryParts.push(
      `<div class="sum-row"><span>Discount</span><span>- Rs ${formatMoney(invoice.discount)}</span></div>`,
    );
  }
  summaryParts.push(
    `<div class="sum-row sum-total"><span>Bill total</span><span>Rs ${formatMoney(invoice.totalAmount)}</span></div>`,
  );
  summaryParts.push(
    `<div class="sum-row"><span>Cash received</span><span>Rs ${formatMoney(amountReceived)}</span></div>`,
  );
  if (changeAmount > 0) {
    summaryParts.push(
      `<div class="sum-row sum-change"><span>Change due</span><span>Rs ${formatMoney(changeAmount)}</span></div>`,
    );
  }
  if ((invoice.udhaarRecoveryApplied ?? 0) > 0) {
    summaryParts.push(
      `<div class="sum-row"><span>Udhaar recovery</span><span>Rs ${formatMoney(invoice.udhaarRecoveryApplied!)}</span></div>`,
    );
  }
  if (invoice.remainingAmount > 0) {
    summaryParts.push(
      `<div class="sum-row sum-due"><span>Remaining (udhaar)</span><span>Rs ${formatMoney(invoice.remainingAmount)}</span></div>`,
    );
  }
  summaryParts.push(
    `<div class="sum-row"><span>Payment</span><span>${escapeHtml(
      invoice.paymentMethod === 'CASH' || invoice.paymentMethod === 'UDHAAR'
        ? paymentLabel(invoice.paymentMethod)
        : 'E-payment',
    )}</span></div>`,
  );

  const barcodeMarkup = invoiceBarcodeSvg(invoice.invoiceNumber);

  const body = `
    <div class="invoice">
      <header class="header">
        ${logo}
        <div class="shop-name">${escapeHtml(settings.businessName)}</div>
        ${settings.tagline ? `<div class="tagline">${escapeHtml(settings.tagline)}</div>` : ''}
        <div class="address">${escapeHtml(settings.address)}</div>
        <div class="contacts">${contacts}</div>
      </header>

      <div class="rule"></div>

      <section class="meta">
        <div class="meta-block">
          <div class="meta-label">Invoice no.</div>
          <div class="meta-value strong">${escapeHtml(invoice.invoiceNumber)}</div>
        </div>
        <div class="meta-block">
          <div class="meta-label">Date & time</div>
          <div class="meta-value">${escapeHtml(formatDateTime(invoice.date))}</div>
        </div>
        ${
          customerLine
            ? `<div class="meta-block">
          <div class="meta-label">Customer</div>
          <div class="meta-value">${customerLine}</div>
        </div>`
            : ''
        }
      </section>

      <div class="rule"></div>

      <table class="items">
        <colgroup>
          <col class="c-item" />
          <col class="c-qty" />
          <col class="c-rate" />
          <col class="c-total" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-item">Item</th>
            <th class="col-qty">Qty</th>
            <th class="col-rate">Rate</th>
            <th class="col-total">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="rule"></div>

      <section class="summary">
        ${summaryParts.join('')}
      </section>

      <div class="rule"></div>

      <footer class="footer">
        <div class="footer-note">${escapeHtml(settings.invoiceFooter)}</div>
        <div class="policy">${escapeHtml(settings.returnPolicy)}</div>
      </footer>

      <section class="invoice-barcode">
        <div class="barcode-caption">Scan for return / exchange</div>
        <div class="barcode-wrap">${barcodeMarkup}</div>
      </section>

      ${(() => {
        const credit = formatDeveloperCreditForPrint(settings.developerCreditLine);
        return credit ? `<div class="credit">${escapeHtml(credit)}</div>` : '';
      })()}
    </div>`;

  const sharedCss = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .invoice { width: 100%; margin: 0 auto; }
  .header { text-align: center; padding: 0 1px 2px; }
  .logo { display: block; max-height: 48px; max-width: 48%; margin: 0 auto 6px; }
  .shop-name { font-size: 17px; font-weight: 800; letter-spacing: 0.03em; margin: 0; line-height: 1.2; }
  .tagline { font-size: 10px; color: #555; margin: 3px 0 6px; }
  .address { font-size: 10px; color: #333; margin: 0 auto; width: 100%; line-height: 1.4; }
  .contacts { margin-top: 4px; }
  .contact { font-size: 10px; color: #222; margin: 1px 0; font-weight: 600; }
  .rule { border: none; border-top: 1px dashed #888; margin: 10px 0; height: 0; }
  .meta { display: block; width: 100%; }
  .meta-block {
    display: block;
    width: 100%;
    padding: 6px 4px;
    margin: 0 0 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .meta-block:last-child { margin-bottom: 0; }
  .meta-label {
    display: block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #666;
    margin: 0 0 3px;
  }
  .meta-value {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #111;
    line-height: 1.35;
    word-break: break-word;
  }
  .meta-value.strong { font-size: 13px; font-weight: 800; }
  .muted { color: #555; font-size: 10px; font-weight: 500; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10px;
  }
  col.c-item { width: 44%; }
  col.c-qty { width: 12%; }
  col.c-rate { width: 22%; }
  col.c-total { width: 22%; }
  table.items th {
    font-weight: 700;
    border-bottom: 1.5px solid #222;
    padding: 4px 2px 5px;
    vertical-align: bottom;
  }
  table.items td {
    padding: 6px 2px;
    vertical-align: top;
    border-bottom: 1px dotted #ccc;
  }
  .col-item { text-align: left; word-wrap: break-word; overflow-wrap: anywhere; }
  .col-qty, .col-rate, .col-total {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .item-name { font-weight: 700; line-height: 1.25; }
  .variant { color: #555; font-size: 9px; margin-top: 2px; font-weight: 600; }
  .summary { padding: 2px 0; width: 100%; }
  .sum-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin: 4px 0;
    font-size: 11px;
    width: 100%;
  }
  .sum-row span:last-child {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .sum-total {
    font-size: 13px;
    font-weight: 800;
    border-top: 1.5px solid #222;
    margin-top: 6px;
    padding-top: 6px;
  }
  .sum-total span:last-child { font-weight: 800; }
  .sum-change { font-weight: 700; }
  .sum-due { font-weight: 700; color: #9a3412; }
  .footer { text-align: center; padding: 2px 2px; }
  .footer-note { font-size: 11px; font-weight: 700; margin: 4px 0; }
  .policy { font-size: 9px; color: #555; line-height: 1.4; margin: 4px 0 0; }
  .invoice-barcode {
    text-align: center;
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed #888;
  }
  .barcode-caption {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 6px;
  }
  .barcode-wrap { display: flex; justify-content: center; width: 100%; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
  .barcode-fallback {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    padding: 6px;
  }
  .credit {
    font-size: 9px;
    font-weight: 600;
    color: #333;
    margin-top: 10px;
    text-align: center;
    line-height: 1.35;
  }
  `;

  if (isA4) {
    return `<!DOCTYPE html><html><head><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  ${sharedCss}
  .invoice { max-width: 170mm; margin: 0 auto; }
  .shop-name { font-size: 22pt; }
  .tagline, .address, .contact { font-size: 10pt; }
  .meta-block { padding: 10px 12px; margin-bottom: 10px; }
  .meta-label { font-size: 8pt; }
  .meta-value { font-size: 12pt; }
  .meta-value.strong { font-size: 13pt; }
  table.items { font-size: 10pt; }
  .variant { font-size: 9pt; }
  .sum-row { font-size: 11pt; }
  .sum-total { font-size: 14pt; }
  .footer-note { font-size: 11pt; }
  .policy { font-size: 9pt; }
  .credit { font-size: 9pt; color: #333; }
</style></head><body>${body}
<script>window.onload=function(){window.print();};<\/script></body></html>`;
  }

  // Thermal: full paper width, centered in print preview window
  return `<!DOCTYPE html><html><head><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 1.5mm; }
  html { background: #d0d0d0; }
  body {
    width: ${widthMm - 3}mm;
    max-width: ${widthMm - 3}mm;
    margin: 0 auto;
    padding: 1.5mm;
    overflow-x: hidden;
    background: #fff;
  }
  ${sharedCss}
  .invoice { width: 100%; max-width: 100%; }
  @media print {
    html { background: #fff; }
    body { width: 100%; max-width: 100%; margin: 0; padding: 0; }
  }
</style></head><body>${body}
<script>window.onload=function(){window.print();};<\/script></body></html>`;
}

export function printInvoice(invoice: Invoice, settings: BusinessSettings) {
  const html = buildInvoicePrintHtml(invoice, settings);
  const isThermal = settings.receiptSize !== 'A4';
  const win = window.open('', '_blank', isThermal ? 'width=360,height=780' : 'width=720,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
