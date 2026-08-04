import JsBarcode from 'jsbarcode';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { BusinessSettings, Invoice } from '../../lib/api';
import { formatDeveloperCreditForPrint } from '../../config/printCredit';
import {
  printHtmlDocument,
  RECEIPT_78MM_FALLBACK_HEIGHT_MICRONS,
  RECEIPT_78MM_WIDTH_MICRONS,
  resolveLogoDataUrl,
  type ElectronPrintResult,
} from '../../lib/electronPrint';

/** Physical invoice paper width (mm). Content is slightly narrower and centered. */
export const RECEIPT_PAGE_WIDTH_MM = 78;
export const RECEIPT_CONTENT_WIDTH_MM = 73;

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
    BANK_TRANSFER: 'E-payment',
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

export type BuildInvoiceHtmlOptions = {
  /** Pre-resolved data URL or absolute logo src */
  logoSrc?: string | null;
  /** Force thermal 78mm template even if settings say A4 */
  forceThermal78?: boolean;
};

/**
 * Self-contained receipt HTML (no app screen CSS).
 * Thermal: 78mm page width, ~73mm content, height grows with cart rows.
 */
export function buildInvoicePrintHtml(
  invoice: Invoice,
  settings: BusinessSettings,
  options: BuildInvoiceHtmlOptions = {},
): string {
  const isA4 = !options.forceThermal78 && settings.receiptSize === 'A4';
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
      const lineDiscount = item.discount > 0 ? `<div class="line-disc">- Rs ${formatMoney(item.discount)}</div>` : '';
      return `<tr>
        <td class="col-item"><div class="item-name">${name}</div>${variantHtml}${lineDiscount}</td>
        <td class="col-qty">${item.quantity}</td>
        <td class="col-rate">${formatMoney(item.rate)}</td>
        <td class="col-total">${formatMoney(item.total)}</td>
      </tr>`;
    })
    .join('');

  const logoSrc = options.logoSrc ?? settings.logoUrl;
  console.info('[print-client] building invoice HTML logo check', { logoUrl: settings.logoUrl, logoSrc: logoSrc ? `${logoSrc.slice(0, 30)}...` : null });
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="" class="logo" />`
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
    `<div class="sum-row"><span>Amount received</span><span>Rs ${formatMoney(amountReceived)}</span></div>`,
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
      `<div class="sum-row sum-due"><span>Due (udhaar)</span><span>Rs ${formatMoney(invoice.remainingAmount)}</span></div>`,
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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  img, svg, table, td, th, div, p, span { max-width: 100%; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice { width: 100%; margin: 0 auto; }
  .header { text-align: center; padding: 0 0 2px; }
  .logo {
    display: block;
    max-height: 42px;
    max-width: 55%;
    width: auto;
    height: auto;
    object-fit: contain;
    margin: 0 auto 5px;
  }
  .shop-name { font-size: 15px; font-weight: 800; letter-spacing: 0.02em; line-height: 1.2; word-wrap: break-word; }
  .tagline { font-size: 9px; color: #555; margin: 2px 0 4px; }
  .address { font-size: 9px; color: #333; line-height: 1.35; word-wrap: break-word; }
  .contacts { margin-top: 3px; }
  .contact { font-size: 9px; color: #222; margin: 1px 0; font-weight: 600; }
  .rule { border: none; border-top: 1px dashed #888; margin: 6px 0; height: 0; }
  .meta { display: block; width: 100%; }
  .meta-block {
    display: block;
    width: 100%;
    padding: 4px 3px;
    margin: 0 0 4px;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: #fafafa;
  }
  .meta-label {
    display: block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #666;
    margin: 0 0 2px;
  }
  .meta-value {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #111;
    line-height: 1.3;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .meta-value.strong { font-size: 12px; font-weight: 800; }
  .muted { color: #555; font-size: 9px; font-weight: 500; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9.5px;
  }
  col.c-item { width: 46%; }
  col.c-qty { width: 12%; }
  col.c-rate { width: 21%; }
  col.c-total { width: 21%; }
  table.items th {
    font-weight: 700;
    border-bottom: 1.5px solid #222;
    padding: 3px 1px 4px;
    vertical-align: bottom;
  }
  table.items td {
    padding: 4px 1px;
    vertical-align: top;
    border-bottom: 1px dotted #ccc;
  }
  .col-item { text-align: left; word-wrap: break-word; overflow-wrap: anywhere; }
  .col-qty, .col-rate, .col-total {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .item-name { font-weight: 700; line-height: 1.25; word-break: break-word; overflow-wrap: anywhere; }
  .variant { color: #555; font-size: 8px; margin-top: 1px; font-weight: 600; }
  .line-disc { color: #666; font-size: 8px; margin-top: 1px; }
  .summary { padding: 2px 0; width: 100%; }
  .sum-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    margin: 3px 0;
    font-size: 10px;
    width: 100%;
  }
  .sum-row span:first-child { flex: 1 1 auto; min-width: 0; word-break: break-word; }
  .sum-row span:last-child {
    flex: 0 0 auto;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .sum-total {
    font-size: 12px;
    font-weight: 800;
    border-top: 1.5px solid #222;
    margin-top: 5px;
    padding-top: 5px;
  }
  .sum-total span:last-child { font-weight: 800; }
  .sum-change { font-weight: 700; }
  .sum-due { font-weight: 700; color: #9a3412; }
  .footer { text-align: center; padding: 2px; }
  .footer-note { font-size: 10px; font-weight: 700; margin: 3px 0; word-wrap: break-word; }
  .policy { font-size: 8px; color: #555; line-height: 1.35; margin: 3px 0 0; word-wrap: break-word; }
  .invoice-barcode {
    text-align: center;
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #888;
  }
  .barcode-caption {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 4px;
  }
  .barcode-wrap { display: flex; justify-content: center; width: 100%; overflow: hidden; }
  .barcode-wrap svg { max-width: 100%; height: auto; }
  .barcode-fallback {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 4px;
  }
  .credit {
    font-size: 8px;
    font-weight: 600;
    color: #333;
    margin-top: 8px;
    text-align: center;
    line-height: 1.3;
  }
  `;

  if (isA4) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${sharedCss}
  .invoice { max-width: 170mm; margin: 0 auto; }
  .shop-name { font-size: 22pt; }
  .tagline, .address, .contact { font-size: 10pt; }
  table.items { font-size: 10pt; }
</style></head><body>${body}</body></html>`;
  }

  // Dedicated 78mm thermal receipt — height grows with items (no fixed height).
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page {
    size: ${RECEIPT_PAGE_WIDTH_MM}mm auto;
    margin: 0;
  }
  html {
    width: ${RECEIPT_PAGE_WIDTH_MM}mm;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  body {
    width: ${RECEIPT_PAGE_WIDTH_MM}mm;
    max-width: ${RECEIPT_PAGE_WIDTH_MM}mm;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    background: #fff;
  }
  ${sharedCss}
  .invoice {
    width: ${RECEIPT_CONTENT_WIDTH_MM}mm;
    max-width: ${RECEIPT_CONTENT_WIDTH_MM}mm;
    height: auto;
    margin: 0 auto;
    padding: 1.5mm 0 2mm;
  }
  @media print {
    html, body {
      width: ${RECEIPT_PAGE_WIDTH_MM}mm;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .invoice {
      width: ${RECEIPT_CONTENT_WIDTH_MM}mm;
      max-width: ${RECEIPT_CONTENT_WIDTH_MM}mm;
      margin: 0 auto;
    }
  }
</style></head><body>${body}</body></html>`;
}

export type PrintInvoiceOptions = {
  preview?: boolean;
  forceThermal78?: boolean;
};

let invoicePrintLock = false;

/**
 * Print invoice after logo/fonts are ready. Uses Electron deviceName when set.
 * Never prints before the sale document is available (caller must pass saved invoice).
 */
export async function printInvoice(
  invoice: Invoice,
  settings: BusinessSettings,
  options: PrintInvoiceOptions = {},
): Promise<ElectronPrintResult> {
  if (invoicePrintLock && !options.preview) {
    return { ok: false, failureReason: 'Print already in progress', jobType: 'invoice' };
  }
  if (!options.preview) invoicePrintLock = true;

  try {
    const logoSrc = await resolveLogoDataUrl(settings.logoUrl);
    const forceThermal78 = options.forceThermal78 ?? settings.receiptSize !== 'A4';
    const html = buildInvoicePrintHtml(invoice, settings, {
      logoSrc,
      forceThermal78,
    });
    const isThermal = forceThermal78 || settings.receiptSize !== 'A4';

    const result = await printHtmlDocument(html, {
      deviceName: settings.printerName,
      pageSize: isThermal
        ? { width: RECEIPT_78MM_WIDTH_MICRONS, height: RECEIPT_78MM_FALLBACK_HEIGHT_MICRONS }
        : 'A4',
      jobType: options.preview ? 'invoice-preview' : 'invoice',
      copies: 1,
      preview: options.preview,
      contentWidthMm: isThermal ? RECEIPT_CONTENT_WIDTH_MM : 170,
    });
    return result;
  } finally {
    if (!options.preview) invoicePrintLock = false;
  }
}

/** Build a short sample invoice for Test Receipt (does not save or change stock). */
export function buildTestInvoice(_settings: BusinessSettings, itemCount: number): Invoice {
  const count = Math.max(1, Math.min(40, itemCount));
  const items = Array.from({ length: count }, (_, i) => {
    const rate = 500 + i * 25;
    const quantity = 1 + (i % 3);
    const discount = i % 5 === 0 ? 50 : 0;
    const total = Math.max(0, quantity * rate - discount);
    return {
      id: i + 1,
      productId: i + 1,
      variantId: i % 2 === 0 ? i + 1 : null,
      quantity,
      rate,
      discount,
      total,
      costAtSale: rate * 0.6,
      product: {
        id: i + 1,
        name:
          i % 4 === 0
            ? `Very long product name example ${i + 1} with extra words that must wrap on the receipt`
            : `Sample item ${i + 1}`,
        productCode: `T${i + 1}`,
      },
      variant:
        i % 2 === 0
          ? { id: i + 1, size: 'L', colour: 'Black', productCode: `T${i + 1}-L` }
          : null,
    };
  });
  const subtotal = items.reduce((s, it) => s + it.quantity * it.rate, 0);
  const discount = items.reduce((s, it) => s + it.discount, 0) + 100;
  const totalAmount = Math.max(0, subtotal - discount);
  const now = new Date().toISOString();
  return {
    id: 0,
    invoiceNumber: 'TEST-RECEIPT',
    customerId: 1,
    date: now,
    status: 'ACTIVE',
    subtotal,
    discount,
    totalAmount,
    amountReceived: totalAmount,
    paidAmount: totalAmount,
    remainingAmount: 0,
    changeAmount: 0,
    paymentMethod: 'CASH',
    notes: null,
    customer: { id: 1, name: 'Test Customer', phone: '0300-0000000' },
    items,
    createdAt: now,
  };
}
