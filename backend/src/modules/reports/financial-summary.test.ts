import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InvoiceStatus,
  PurchasePaymentMethod,
  ReturnCondition,
  SalePaymentMethod,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { activeFinancialYearStartDate } from '../../test-helpers/financial-year';
import { syncInvoiceNumberCounter } from '../../test-helpers/invoice-counter';
import { bootstrapChartOfAccounts } from '../accounting/accounting.service';
import { createCustomer, createCustomerPayment } from '../customers/customers.service';
import { createExpense, listExpenseCategories } from '../finance/finance.service';
import { createProduct, updateProduct } from '../products/products.service';
import { createSaleReturn } from '../sales/returns.service';
import { createSale } from '../sales/sales.service';
import {
  computeChangePercent,
  getDashboardPayload,
  getFinancialSummary,
  getInvoiceWiseProfit,
  getProductWiseProfit,
  resolveDateRange,
  resolvePreviousDateRange,
} from './financial-summary.service';

const PREFIX = 'TEST-P11-';

async function cleanup() {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  if (!productIds.length) {
    await prisma.expense.deleteMany({ where: { description: { startsWith: PREFIX } } });
    await prisma.customer.deleteMany({ where: { name: { startsWith: PREFIX } } });
    return;
  }

  const invoiceIds = [
    ...new Set(
      (
        await prisma.invoiceItem.findMany({
          where: { productId: { in: productIds } },
          select: { invoiceId: true },
        })
      ).map((i) => i.invoiceId),
    ),
  ];

  if (invoiceIds.length) {
    const returnIds = (
      await prisma.saleReturn.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { id: true },
      })
    ).map((r) => r.id);

    await prisma.saleReturnItem.deleteMany({ where: { saleReturnId: { in: returnIds } } });
    await prisma.saleReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.exchangeItem.deleteMany({
      where: { exchange: { invoiceId: { in: invoiceIds } } },
    });
    await prisma.exchange.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.voucher.deleteMany({
      where: {
        OR: invoiceIds.flatMap((id) => [
          { sourceType: 'SALE', sourceRef: String(id) },
          { sourceType: 'SALE_RETURN', sourceRef: { contains: String(id) } },
        ]),
      },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }

  await prisma.expense.deleteMany({ where: { description: { startsWith: PREFIX } } });
  await prisma.customerPayment.deleteMany({
    where: { customer: { name: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}

describe('Financial summary service (Phase 11)', () => {
  let userId: number;
  let runId: string;
  let testDayOffset = 0;

  async function isolatedTestDate(): Promise<string> {
    const start = await activeFinancialYearStartDate();
    testDayOffset++;
    const base = new Date(start);
    base.setDate(base.getDate() + 10 + testDayOffset);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
  });

  beforeEach(async () => {
    runId = `${Date.now()}`;
    await cleanup();
    await syncInvoiceNumberCounter();
  });

  it('computes Net Sales, COGS, Gross Profit, Net Profit for mixed transactions', async () => {
    const testDate = await isolatedTestDate();
    const product = await createProduct({
      name: `${PREFIX}Kurta ${runId}`,
      salePrice: 1000,
      purchasePrice: 400,
      openingStock: 20,
    });

    const customer = await createCustomer({
      name: `${PREFIX}Buyer ${runId}`,
      phone: '03001234567',
    });

    const cashSale = await createSale({
      items: [{ productId: product.id, quantity: 2, rate: 1000 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 1900,
      discount: 100,
      date: testDate,
      createdById: userId,
    });

    const udhaarSale = await createSale({
      items: [{ productId: product.id, quantity: 1, rate: 1000 }],
      paymentMethod: SalePaymentMethod.UDHAAR,
      paidAmount: 0,
      customerId: customer.id,
      date: testDate,
      createdById: userId,
    });

    const line = cashSale.items[0]!;
    const saleReturn = await createSaleReturn({
      invoiceId: cashSale.id,
      items: [{ invoiceItemId: line.id, quantity: 1, condition: ReturnCondition.GOOD }],
      refundMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });
    await prisma.saleReturn.update({
      where: { id: saleReturn.id },
      data: { date: new Date(testDate) },
    });

    const categories = await listExpenseCategories();
    const misc = categories.find((c) => c.name === 'Miscellaneous');
    await createExpense({
      categoryId: misc!.id,
      date: testDate,
      amount: 500,
      paymentMethod: PurchasePaymentMethod.CASH,
      description: `${PREFIX}Shop expense ${runId}`,
      createdById: userId,
    });

    const summary = await getFinancialSummary('custom', testDate, testDate);

    // Gross: 2000 + 1000 = 3000 (qty*rate before discounts)
    expect(summary.grossSales).toBe(3000);
    // Invoice discount 100 on cash sale
    expect(summary.discounts).toBe(100);
    // Return 1 item at 1000
    expect(summary.saleReturns).toBe(1000);
    // Net sales = 3000 - 100 - 1000 = 1900
    expect(summary.netSales).toBe(1900);
    // COGS: sold 3, returned 1 => net 2 units * 400 = 800
    expect(summary.costOfGoodsSold).toBe(800);
    expect(summary.grossProfit).toBe(1100);
    expect(summary.expenses).toBe(500);
    expect(summary.netProfit).toBe(600);
    expect(summary.udhaarSales).toBe(1000);
    expect(summary.invoiceCount).toBe(2);
  });

  it('udhaar sale counts at sale time; customer payment does not double-count as new sale', async () => {
    const testDate = await isolatedTestDate();
    const product = await createProduct({
      name: `${PREFIX}Udhaar ${runId}`,
      salePrice: 500,
      purchasePrice: 200,
      openingStock: 10,
    });
    const customer = await createCustomer({
      name: `${PREFIX}UdhaarCust ${runId}`,
      phone: '03009998877',
    });

    await createSale({
      items: [{ productId: product.id, quantity: 2, rate: 500 }],
      paymentMethod: SalePaymentMethod.UDHAAR,
      paidAmount: 0,
      customerId: customer.id,
      date: testDate,
      createdById: userId,
    });

    const beforePayment = await getFinancialSummary('custom', testDate, testDate);
    expect(beforePayment.netSales).toBe(1000);
    expect(beforePayment.udhaarSales).toBe(1000);
    expect(beforePayment.cashReceived).toBe(0);

    await createCustomerPayment({
      customerId: customer.id,
      amount: 1000,
      paymentMethod: PurchasePaymentMethod.CASH,
      date: testDate,
      createdById: userId,
    });

    const afterPayment = await getFinancialSummary('custom', testDate, testDate);
    expect(afterPayment.netSales).toBe(1000);
    expect(afterPayment.cashReceived).toBe(1000);
    expect(afterPayment.netProfit).toBe(beforePayment.netProfit);
  });

  it('historical costAtSale unchanged when product purchasePrice is updated later', async () => {
    const testDate = await isolatedTestDate();
    const product = await createProduct({
      name: `${PREFIX}HistCost ${runId}`,
      salePrice: 800,
      purchasePrice: 300,
      openingStock: 5,
    });

    const sale = await createSale({
      items: [{ productId: product.id, quantity: 2, rate: 800 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 1600,
      date: testDate,
      createdById: userId,
    });

    const range = resolveDateRange('custom', testDate, testDate);

    const before = await getInvoiceWiseProfit(range.from, range.to);
    const row = before.find((r) => r.invoiceId === sale.id);
    expect(row!.costOfGoodsSold).toBe(600);
    expect(row!.grossProfit).toBe(1000);

    await updateProduct(product.id, { purchasePrice: 900 });

    const after = await getInvoiceWiseProfit(range.from, range.to);
    const rowAfter = after.find((r) => r.invoiceId === sale.id);
    expect(rowAfter!.costOfGoodsSold).toBe(600);
    expect(rowAfter!.grossProfit).toBe(1000);

    const productProfit = await getProductWiseProfit(range.from, range.to);
    const profitRow = productProfit.find((p) => p.productId === product.id);
    expect(profitRow?.costOfGoodsSold).toBe(600);
    expect(profitRow?.grossProfit).toBe(1000);
  });

  it('excludes cancelled invoices from totals', async () => {
    const testDate = await isolatedTestDate();
    const product = await createProduct({
      name: `${PREFIX}Cancel ${runId}`,
      salePrice: 100,
      purchasePrice: 40,
      openingStock: 10,
    });

    const sale = await createSale({
      items: [{ productId: product.id, quantity: 1, rate: 100 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 100,
      date: testDate,
      createdById: userId,
    });

    await prisma.invoice.update({
      where: { id: sale.id },
      data: { status: InvoiceStatus.CANCELLED },
    });

    const summary = await getFinancialSummary('custom', testDate, testDate);
    expect(summary.grossSales).toBe(0);
    expect(summary.invoiceCount).toBe(0);
  });

  it('computeChangePercent handles zero and growth', () => {
    expect(computeChangePercent(0, 0)).toBe(0);
    expect(computeChangePercent(150, 100)).toBe(50);
    expect(computeChangePercent(80, 100)).toBe(-20);
    expect(computeChangePercent(100, 0)).toBeNull();
  });

  it('resolvePreviousDateRange returns equal-length prior window', () => {
    const range = resolveDateRange('week');
    const prev = resolvePreviousDateRange(range);
    expect(prev).not.toBeNull();
    expect(prev!.to!.getTime()).toBeLessThan(range.from!.getTime());
    const currentMs = range.to!.getTime() - range.from!.getTime();
    const prevMs = prev!.to!.getTime() - prev!.from!.getTime();
    expect(Math.abs(prevMs - currentMs)).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('dashboard payload includes comparisons and payment breakdown', async () => {
    const testDate = await isolatedTestDate();
    const product = await createProduct({
      name: `${PREFIX}Dash ${runId}`,
      salePrice: 200,
      purchasePrice: 80,
      openingStock: 10,
    });

    await createSale({
      items: [{ productId: product.id, quantity: 1, rate: 200 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 200,
      date: testDate,
      createdById: userId,
    });

    const payload = await getDashboardPayload('custom', testDate, testDate);
    expect(payload.netSales).toBe(200);
    expect(payload.comparisons).not.toBeNull();
    expect(payload.comparisons!.netSales.current).toBe(200);
    expect(payload.paymentMethodBreakdown.some((r) => r.paymentMethod === 'CASH')).toBe(true);
  });
});
