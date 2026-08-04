import { formatDate, formatMoney } from '../../lib/format';
import type { BusinessSettings, CustomerStatement } from '../../lib/api';
import { resolveLogoDataUrl } from '../../lib/electronPrint';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type BuildCustomerStatementHtmlOptions = {
  logoSrc?: string | null;
};

export function buildCustomerStatementHtml(
  statement: CustomerStatement,
  settings: BusinessSettings,
  options: BuildCustomerStatementHtmlOptions = {},
): string {
  const { customer, lines, closingBalance } = statement;

  const rows = lines
    .map(
      (line) => `<tr>
        <td>${formatDate(line.date)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="num">${line.debit > 0 ? formatMoney(line.debit) : '—'}</td>
        <td class="num">${line.credit > 0 ? formatMoney(line.credit) : '—'}</td>
        <td class="num">${formatMoney(line.balance)}</td>
      </tr>`,
    )
    .join('');

  const logoSrc = options.logoSrc ?? settings.logoUrl;
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="" class="logo" />`
    : '';

  return `<!DOCTYPE html><html><head><title>Statement — ${escapeHtml(customer.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #111; font-weight: 600; margin: 0; }
  .sheet { max-width: 180mm; margin: 0 auto; }
  h1 { font-size: 16pt; font-weight: 800; margin: 0 0 4px; }
  .meta { font-size: 10pt; font-weight: 700; color: #111; margin: 2px 0; }
  .logo { max-height: 48px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10pt; font-weight: 600; }
  th, td { border-bottom: 1px solid #aaa; padding: 6px 4px; text-align: left; }
  th { font-weight: 800; background: #f0f0f0; }
  .num { text-align: right; white-space: nowrap; font-weight: 700; }
  .closing { display: flex; justify-content: space-between; font-size: 12pt; font-weight: 800; margin-top: 12px; padding-top: 8px; border-top: 2px solid #111; }
  .footer { font-size: 9.5pt; font-weight: 700; color: #111; margin-top: 24px; text-align: center; }
</style></head><body>
<div class="sheet">
  ${logo}
  <h1>${escapeHtml(settings.businessName)}</h1>
  <p class="meta">${escapeHtml(settings.address)} · ${escapeHtml(settings.phone)}</p>
  <h2 style="font-size: 13pt; margin: 16px 0 4px;">Customer Statement</h2>
  <p class="meta"><strong>${escapeHtml(customer.name)}</strong>${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}</p>
  ${customer.address ? `<p class="meta">${escapeHtml(customer.address)}</p>` : ''}
  <p class="meta">Printed: ${formatDate(new Date().toISOString())}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th class="num">Charge</th>
        <th class="num">Payment</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5" style="text-align:center;color:#666;padding:16px">No transactions yet.</td></tr>'}
    </tbody>
  </table>
  <div class="closing">
    <span>Customer owes</span>
    <span>Rs ${formatMoney(closingBalance)}</span>
  </div>
  <p class="footer">${escapeHtml(settings.invoiceFooter)}</p>
</div>
<script>window.onload=function(){window.print();};<\/script>
</body></html>`;
}

export async function printCustomerStatement(statement: CustomerStatement, settings: BusinessSettings) {
  const logoSrc = await resolveLogoDataUrl(settings.logoUrl);
  const html = buildCustomerStatementHtml(statement, settings, { logoSrc });
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
