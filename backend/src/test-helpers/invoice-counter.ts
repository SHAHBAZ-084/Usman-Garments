import { prisma } from '../lib/prisma';

/** Keep BusinessSettings.nextInvoiceNumber ahead of existing invoice numbers (shared DB tests). */
export async function syncInvoiceNumberCounter() {
  const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
  const prefix = settings.invoicePrefix.trim() || 'UM-';
  const invoices = await prisma.invoice.findMany({ select: { invoiceNumber: true } });
  let maxSeq = 0;
  for (const inv of invoices) {
    if (!inv.invoiceNumber.startsWith(prefix)) continue;
    const num = parseInt(inv.invoiceNumber.slice(prefix.length), 10);
    if (!Number.isNaN(num)) maxSeq = Math.max(maxSeq, num);
  }
  const requiredNext = maxSeq + 1;
  if (settings.nextInvoiceNumber <= maxSeq) {
    await prisma.businessSettings.update({
      where: { id: 1 },
      data: { nextInvoiceNumber: requiredNext },
    });
  }
}
