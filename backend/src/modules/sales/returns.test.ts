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
import { syncInvoiceNumberCounter } from '../../test-helpers/invoice-counter';
import { getTrialBalance } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createSale } from './sales.service';
import { createExchange, createSaleReturn } from './returns.service';

const PREFIX = 'TEST-P9-';

async function cleanup(userId?: number) {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);

  const invoices = await prisma.invoice.findMany({
    where: { items: { some: { productId: { in: productIds } } } },
    select: { id: true, status: true },
  });

  if (invoices.length) {
    const invoiceIds = invoices.map((i) => i.id);
    await prisma.exchangeItem.deleteMany({ where: { exchange: { invoiceId: { in: invoiceIds } } } });
    await prisma.exchange.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.saleReturnItem.deleteMany({ where: { saleReturn: { invoiceId: { in: invoiceIds } } } });
    await prisma.saleReturn.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }

  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });

  void userId;
}

describe('Sale returns & exchanges (Phase 9)', () => {
  let userId: number;
  let runId: string;

  beforeAll(async () => {
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
  });

  beforeEach(async () => {
    runId = `${Date.now()}`;
    await cleanup(userId);
    await syncInvoiceNumberCounter();
  });

  async function makeSale(quantity = 3, salePrice = 500, purchasePrice = 200) {
    const product = await createProduct({
      name: `${PREFIX}Item ${runId}`,
      salePrice,
      purchasePrice,
      openingStock: 10,
    });
    const invoice = await createSale({
      items: [{ productId: product.id, quantity, rate: salePrice }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: quantity * salePrice,
      createdById: userId,
    });
    return { product, invoice };
  }

  it('good-condition return restocks and posts balanced offsetting voucher', async () => {
    const { product, invoice } = await makeSale(3);
    const afterSale = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterSale.currentStock).toBe(7);

    const line = invoice.items[0]!;
    const saleReturn = await createSaleReturn({
      invoiceId: invoice.id,
      items: [{ invoiceItemId: line.id, quantity: 2, condition: ReturnCondition.GOOD }],
      refundMethod: PurchasePaymentMethod.CASH,
      refundToCash: true,
      createdById: userId,
    });

    expect(saleReturn.totalAmount).toBe(1000);

    const afterReturn = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterReturn.currentStock).toBe(9);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: StockMovementType.SALE_RETURN },
    });
    expect(movement).toBeTruthy();

    const voucher = await prisma.voucher.findFirst({
      where: {
        sourceType: 'SALE_RETURN',
        sourceRef: String(saleReturn.id),
        status: VoucherStatus.ACTIVE,
      },
      include: { ledgerEntries: true },
    });
    expect(voucher?.type).toBe(VoucherType.SALE_RETURN);
    const d = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const c = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(d).toBeCloseTo(c, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('damaged return does not restock but posts loss and refund', async () => {
    const { product, invoice } = await makeSale(2);
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;

    const line = invoice.items[0]!;
    const saleReturn = await createSaleReturn({
      invoiceId: invoice.id,
      items: [{ invoiceItemId: line.id, quantity: 1, condition: ReturnCondition.DAMAGED }],
      refundToCash: true,
      createdById: userId,
    });

    expect(saleReturn.totalAmount).toBe(500);

    const stockAfter = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(stockAfter).toBe(stockBefore);

    const damagedMove = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: StockMovementType.DAMAGED },
    });
    expect(damagedMove?.quantity).toBe(1);

    const saleReturnMove = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: StockMovementType.SALE_RETURN },
    });
    expect(saleReturnMove).toBeNull();

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('exchange updates both stocks and posts balanced net difference', async () => {
    const { product, invoice } = await makeSale(2, 400, 150);
    const newProduct = await createProduct({
      name: `${PREFIX}New ${runId}`,
      salePrice: 600,
      purchasePrice: 250,
      openingStock: 5,
    });

    const returnLine = invoice.items[0]!;
    const exchange = await createExchange({
      invoiceId: invoice.id,
      returnItems: [{ invoiceItemId: returnLine.id, quantity: 1, condition: ReturnCondition.GOOD }],
      newItems: [{ productId: newProduct.id, quantity: 1, rate: 600 }],
      paymentMethod: PurchasePaymentMethod.CASH,
      paidAmount: 200,
      createdById: userId,
    });

    expect(exchange.returnTotal).toBe(400);
    expect(exchange.newSaleTotal).toBe(600);
    expect(exchange.netAmount).toBe(200);

    const oldStock = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    const newStock = (await prisma.product.findUniqueOrThrow({ where: { id: newProduct.id } })).currentStock;
    expect(oldStock).toBe(9);
    expect(newStock).toBe(4);

    const voucher = await prisma.voucher.findFirst({
      where: { sourceType: 'EXCHANGE', sourceRef: String(exchange.id), status: VoucherStatus.ACTIVE },
      include: { ledgerEntries: true },
    });
    expect(voucher?.type).toBe(VoucherType.EXCHANGE);
    const d = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const c = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(d).toBeCloseTo(c, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('blocks return quantity exceeding sold quantity', async () => {
    const { invoice } = await makeSale(2);
    const line = invoice.items[0]!;

    await createSaleReturn({
      invoiceId: invoice.id,
      items: [{ invoiceItemId: line.id, quantity: 1, condition: ReturnCondition.GOOD }],
      refundToCash: true,
      createdById: userId,
    });

    await expect(
      createSaleReturn({
        invoiceId: invoice.id,
        items: [{ invoiceItemId: line.id, quantity: 2, condition: ReturnCondition.GOOD }],
        refundToCash: true,
        createdById: userId,
      }),
    ).rejects.toThrow(/Cannot return more than/i);

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(inv.status).toBe(InvoiceStatus.ACTIVE);
  });
});
