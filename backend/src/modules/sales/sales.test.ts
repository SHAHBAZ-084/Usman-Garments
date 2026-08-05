import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InvoiceStatus,
  LedgerEntryType,
  PurchasePaymentMethod,
  ReturnCondition,
  SalePaymentMethod,
  StockMovementType,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { syncInvoiceNumberCounter } from '../../test-helpers/invoice-counter';
import {
  bootstrapChartOfAccounts,
  COGS_ACCOUNT_NAME,
  INVENTORY_ACCOUNT_NAME,
  SALE_REVENUE_ACCOUNT_NAME,
} from '../accounting/accounting.service';
import { createCustomer } from '../customers/customers.service';
import { createProduct } from '../products/products.service';
import { cancelSale, createSale, deleteSale } from './sales.service';
import { createExchange, createSaleReturn } from './returns.service';

const PREFIX = 'TEST-P7-';

async function cleanup(cancelUserId?: number) {
  const customers = await prisma.customer.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true, accountId: true },
  });
  const customerIds = customers.map((c) => c.id);
  const accountIds = customers.map((c) => c.accountId).filter((id): id is number => id != null);

  const invoices = await prisma.invoice.findMany({
    where: { items: { some: { product: { name: { startsWith: PREFIX } } } } },
    select: { id: true },
  });
  const invoiceIds = invoices.map((i) => i.id);

  if (invoiceIds.length) {
    for (const id of invoiceIds) {
      const inv = await prisma.invoice.findUnique({ where: { id } });
      if (inv?.status === InvoiceStatus.ACTIVE && cancelUserId) {
        try {
          await cancelSale(id, cancelUserId);
        } catch {
          /* already cancelled or blocked */
        }
      }
    }
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }

  await prisma.stockMovement.deleteMany({
    where: { product: { name: { startsWith: PREFIX } } },
  });
  await prisma.productVariant.deleteMany({
    where: { product: { name: { startsWith: PREFIX } } },
  });
  await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });

  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  if (accountIds.length) {
    await prisma.account.updateMany({
      where: { id: { in: accountIds } },
      data: { isActive: false },
    });
  }
}

describe('POS sales (Phase 7)', () => {
  let userId: number;
  let runId: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
  });

  beforeEach(async () => {
    runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await cleanup(userId);
    await syncInvoiceNumberCounter();
  });

  async function assertVoucherBalanced(invoiceId: number) {
    const voucher = await prisma.voucher.findFirstOrThrow({
      where: { sourceType: 'SALE', sourceRef: String(invoiceId), status: VoucherStatus.ACTIVE },
      include: { ledgerEntries: true },
    });
    const debits = voucher.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const credits = voucher.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(debits).toBeCloseTo(credits, 2);
  }

  it('reduces product stock exactly once on cash sale', async () => {
    const product = await createProduct({
      name: `${PREFIX}Shirt ${runId}`,
      salePrice: 1000,
      purchasePrice: 400,
      openingStock: 10,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 3, rate: 1000 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 3000,
      createdById: userId,
    });

    expect(invoice.totalAmount).toBe(3000);
    expect(invoice.status).toBe(InvoiceStatus.ACTIVE);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.currentStock).toBe(7);

    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id, type: StockMovementType.SALE },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity).toBe(3);

    const voucher = await prisma.voucher.findFirst({
      where: { sourceType: 'SALE', sourceRef: String(invoice.id), status: VoucherStatus.ACTIVE },
      include: { ledgerEntries: { include: { ledger: { include: { account: true } } } } },
    });
    expect(voucher?.type).toBe(VoucherType.SALE);

    await assertVoucherBalanced(invoice.id);
  });

  it('accepts cash overpayment and returns change on invoice', async () => {
    const product = await createProduct({
      name: `${PREFIX}Change ${runId}`,
      salePrice: 750,
      openingStock: 3,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: SalePaymentMethod.CASH,
      amountReceived: 1000,
      createdById: userId,
    });

    expect(invoice.totalAmount).toBe(750);
    expect(invoice.amountReceived).toBe(1000);
    expect(invoice.paidAmount).toBe(750);
    expect(invoice.remainingAmount).toBe(0);
    expect(invoice.changeAmount).toBe(250);
  });

  it('reduces variant stock and posts COGS/inventory legs', async () => {
    const product = await createProduct({
      name: `${PREFIX}Variant ${runId}`,
      salePrice: 500,
      purchasePrice: 200,
      variants: [{ size: 'M', currentStock: 5 }],
    });
    const variant = product.variants![0]!;

    const invoice = await createSale({
      items: [{ productId: product.id, variantId: variant.id, quantity: 2 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 1000,
      createdById: userId,
    });

    const variantRow = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.currentStock).toBe(3);

    const voucher = await prisma.voucher.findFirstOrThrow({
      where: { sourceType: 'SALE', sourceRef: String(invoice.id) },
      include: { ledgerEntries: { include: { ledger: { include: { account: true } } } } },
    });

    const revenueLeg = voucher.ledgerEntries.find(
      (e) => e.ledger.account.name === SALE_REVENUE_ACCOUNT_NAME && e.type === LedgerEntryType.CREDIT,
    );
    const cogsLeg = voucher.ledgerEntries.find(
      (e) => e.ledger.account.name === COGS_ACCOUNT_NAME && e.type === LedgerEntryType.DEBIT,
    );
    const inventoryLeg = voucher.ledgerEntries.find(
      (e) => e.ledger.account.name === INVENTORY_ACCOUNT_NAME && e.type === LedgerEntryType.CREDIT,
    );
    expect(revenueLeg).toBeTruthy();
    expect(cogsLeg).toBeTruthy();
    expect(inventoryLeg).toBeTruthy();
    expect(Number(cogsLeg!.amount)).toBe(400);
  });

  it('blocks insufficient stock with no partial side effects', async () => {
    const product = await createProduct({
      name: `${PREFIX}LowStock ${runId}`,
      salePrice: 100,
      openingStock: 2,
    });

    const movementsBefore = await prisma.stockMovement.count({
      where: { productId: product.id },
    });
    const invoicesBefore = await prisma.invoice.count();

    await expect(
      createSale({
        items: [{ productId: product.id, quantity: 5 }],
        paymentMethod: SalePaymentMethod.CASH,
        paidAmount: 500,
        createdById: userId,
      }),
    ).rejects.toThrow(/insufficient stock/i);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.currentStock).toBe(2);

    const movementsAfter = await prisma.stockMovement.count({
      where: { productId: product.id },
    });
    expect(movementsAfter).toBe(movementsBefore);
    expect(await prisma.invoice.count()).toBe(invoicesBefore);
  });

  it('creates customer balance on partial payment sale', async () => {
    const customer = await createCustomer({
      name: `${PREFIX}Buyer ${runId}`,
      phone: '03001234567',
    });
    const product = await createProduct({
      name: `${PREFIX}Credit ${runId}`,
      salePrice: 1000,
      openingStock: 5,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 400,
      customerId: customer.id,
      createdById: userId,
    });

    expect(invoice.remainingAmount).toBe(600);
    expect(invoice.paidAmount).toBe(400);

    const cust = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(cust.currentBalance)).toBe(600);
  });

  it('auto-increments invoice numbers with configured prefix', async () => {
    const prior = await prisma.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.businessSettings.update({
      where: { id: 1 },
      data: { invoicePrefix: 'TST-', nextInvoiceNumber: 100 },
    });

    const product = await createProduct({
      name: `${PREFIX}InvNum ${runId}`,
      salePrice: 50,
      openingStock: 10,
    });

    const first = await createSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 50,
      createdById: userId,
    });
    const second = await createSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 50,
      createdById: userId,
    });

    expect(first.invoiceNumber).toBe('TST-000100');
    expect(second.invoiceNumber).toBe('TST-000101');

    await prisma.businessSettings.update({
      where: { id: 1 },
      data: { invoicePrefix: prior.invoicePrefix, nextInvoiceNumber: prior.nextInvoiceNumber },
    });
    await syncInvoiceNumberCounter();
  });

  it('cancels sale reversing stock and voucher', async () => {
    const product = await createProduct({
      name: `${PREFIX}Cancel ${runId}`,
      salePrice: 200,
      purchasePrice: 80,
      openingStock: 4,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 400,
      createdById: userId,
    });

    const stockAfterSale = (
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    ).currentStock;
    expect(stockAfterSale).toBe(2);

    const cancelled = await cancelSale(invoice.id, userId);
    expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);

    const stockAfterCancel = (
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    ).currentStock;
    expect(stockAfterCancel).toBe(4);

    const activeVoucher = await prisma.voucher.findFirst({
      where: { sourceType: 'SALE', sourceRef: String(invoice.id), status: VoucherStatus.ACTIVE },
    });
    expect(activeVoucher).toBeNull();
  });

  it('deletes sale with GOOD-condition return and reverses stock and return records', async () => {
    const product = await createProduct({
      name: `${PREFIX}GoodReturn ${runId}`,
      salePrice: 500,
      purchasePrice: 200,
      openingStock: 10,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 3 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 1500,
      createdById: userId,
    });

    const afterSaleStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(afterSaleStock).toBe(7);

    const saleReturn = await createSaleReturn({
      invoiceId: invoice.id,
      items: [{ invoiceItemId: invoice.items[0]!.id, quantity: 1, condition: ReturnCondition.GOOD }],
      refundMethod: PurchasePaymentMethod.CASH,
      refundToCash: true,
      createdById: userId,
    });

    const afterReturnStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(afterReturnStock).toBe(8);

    await deleteSale(invoice.id, userId);

    const finalStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(finalStock).toBe(10);

    const remainingReturns = await prisma.saleReturn.findMany({ where: { invoiceId: invoice.id } });
    expect(remainingReturns).toHaveLength(0);
    const remainingReturnItems = await prisma.saleReturnItem.findMany({
      where: { saleReturnId: saleReturn.id },
    });
    expect(remainingReturnItems).toHaveLength(0);
  });

  it('deletes sale with DAMAGED-condition return without incorrectly restocking sellable stock', async () => {
    const product = await createProduct({
      name: `${PREFIX}DamagedReturn ${runId}`,
      salePrice: 400,
      purchasePrice: 150,
      openingStock: 10,
    });

    const invoice = await createSale({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 800,
      createdById: userId,
    });

    const afterSaleStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(afterSaleStock).toBe(8);

    await createSaleReturn({
      invoiceId: invoice.id,
      items: [{ invoiceItemId: invoice.items[0]!.id, quantity: 1, condition: ReturnCondition.DAMAGED }],
      refundMethod: PurchasePaymentMethod.CASH,
      refundToCash: true,
      createdById: userId,
    });

    const afterReturnStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(afterReturnStock).toBe(8);

    await deleteSale(invoice.id, userId);

    const finalStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(finalStock).toBe(10);
  });

  it('deletes sale with Exchange and reverses both returned and new item stocks', async () => {
    const productA = await createProduct({
      name: `${PREFIX}ExchA ${runId}`,
      salePrice: 600,
      purchasePrice: 250,
      openingStock: 10,
    });
    const productB = await createProduct({
      name: `${PREFIX}ExchB ${runId}`,
      salePrice: 600,
      purchasePrice: 250,
      openingStock: 10,
    });

    const invoice = await createSale({
      items: [{ productId: productA.id, quantity: 2 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 1200,
      createdById: userId,
    });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })).currentStock).toBe(8);

    const exchange = await createExchange({
      invoiceId: invoice.id,
      returnItems: [{ invoiceItemId: invoice.items[0]!.id, quantity: 1, condition: ReturnCondition.GOOD }],
      newItems: [{ productId: productB.id, quantity: 1, rate: 600 }],
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })).currentStock).toBe(9);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productB.id } })).currentStock).toBe(9);

    await deleteSale(invoice.id, userId);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })).currentStock).toBe(10);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productB.id } })).currentStock).toBe(10);

    const remainingExchanges = await prisma.exchange.findMany({ where: { id: exchange.id } });
    expect(remainingExchanges).toHaveLength(0);
    const remainingExchangeItems = await prisma.exchangeItem.findMany({
      where: { exchangeId: exchange.id },
    });
    expect(remainingExchangeItems).toHaveLength(0);
  });
});
