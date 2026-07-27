import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvoiceStatus, PurchasePaymentMethod, SalePaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { syncInvoiceNumberCounter } from '../../test-helpers/invoice-counter';
import { bootstrapChartOfAccounts, getTrialBalance } from '../accounting/accounting.service';
import { createCustomer, createCustomerPayment } from './customers.service';
import { createProduct } from '../products/products.service';
import { cancelSale, createSale } from '../sales/sales.service';

const PREFIX = 'TEST-P8-';

async function cleanup(cancelUserId?: number) {
  const customers = await prisma.customer.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true, accountId: true },
  });
  const customerIds = customers.map((c) => c.id);
  const accountIds = customers.map((c) => c.accountId).filter((id): id is number => id != null);

  const invoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        { items: { some: { product: { name: { startsWith: PREFIX } } } } },
      ],
    },
    select: { id: true, status: true },
  });

  if (invoices.length && cancelUserId) {
    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.ACTIVE) {
        try {
          await cancelSale(inv.id, cancelUserId);
        } catch {
          /* already cancelled */
        }
      }
    }
  }

  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length) {
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }

  if (customerIds.length) {
    await prisma.customerPayment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  await prisma.stockMovement.deleteMany({
    where: { product: { name: { startsWith: PREFIX } } },
  });
  await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });

  if (accountIds.length) {
    await prisma.account.updateMany({
      where: { id: { in: accountIds } },
      data: { isActive: false },
    });
  }
}

describe('Customer management (Phase 8)', () => {
  let userId: number;
  let runId: string;
  let voucherDate: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    voucherDate = await voucherDateInActiveYear();
  });

  beforeEach(async () => {
    runId = `${Date.now()}`;
    await cleanup(userId);
    await syncInvoiceNumberCounter();
  });

  it('customer payment reduces balance and posts balanced voucher', async () => {
    const customer = await createCustomer({
      name: `${PREFIX}Udhaar ${runId}`,
      phone: '03001234567',
    });
    const product = await createProduct({
      name: `${PREFIX}Shirt ${runId}`,
      salePrice: 500,
      purchasePrice: 200,
      openingStock: 10,
    });

    await createSale({
      items: [{ productId: product.id, quantity: 2, rate: 500 }],
      paymentMethod: SalePaymentMethod.UDHAAR,
      paidAmount: 200,
      customerId: customer.id,
      date: voucherDate,
      createdById: userId,
    });

    const beforePay = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(beforePay.currentBalance)).toBeCloseTo(800, 2);

    const payment = await createCustomerPayment({
      customerId: customer.id,
      amount: 300,
      paymentMethod: PurchasePaymentMethod.CASH,
      date: voucherDate,
      createdById: userId,
    });

    expect(payment.confirmation.remainingReceivable).toBeCloseTo(500, 2);

    const afterPay = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      include: { account: { include: { ledger: true } } },
    });
    expect(Number(afterPay.currentBalance)).toBeCloseTo(500, 2);
    expect(Number(afterPay.account!.ledger!.balance)).toBeCloseTo(500, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('rejects payment exceeding customer balance', async () => {
    const customer = await createCustomer({ name: `${PREFIX}Small ${runId}` });
    const product = await createProduct({
      name: `${PREFIX}Cap ${runId}`,
      salePrice: 100,
      purchasePrice: 40,
      openingStock: 5,
    });

    await createSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: SalePaymentMethod.UDHAAR,
      paidAmount: 0,
      customerId: customer.id,
      date: voucherDate,
      createdById: userId,
    });

    await expect(
      createCustomerPayment({
        customerId: customer.id,
        amount: 150,
        paymentMethod: PurchasePaymentMethod.CASH,
        date: voucherDate,
        createdById: userId,
      }),
    ).rejects.toThrow(/exceeds customer balance/i);
  });
});
