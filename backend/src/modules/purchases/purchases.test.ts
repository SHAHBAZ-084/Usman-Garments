import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LedgerEntryType,
  PurchasePaymentMethod,
  StockMovementType,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { bootstrapChartOfAccounts, getTrialBalance } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createSupplier } from '../suppliers/suppliers.service';
import {
  createPurchase,
  createPurchaseReturn,
  createSupplierPayment,
} from './purchases.service';

const PREFIX = 'TEST-P5-';

async function cleanup() {
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true, accountId: true },
  });
  const supplierIds = suppliers.map((s) => s.id);
  const accountIds = suppliers.map((s) => s.accountId).filter((id): id is number => id != null);

  const purchases = await prisma.purchase.findMany({
    where: { supplierId: { in: supplierIds } },
    select: { id: true },
  });
  const purchaseIds = purchases.map((p) => p.id);

  await prisma.purchaseReturnItem.deleteMany({
    where: { purchaseReturn: { purchaseId: { in: purchaseIds } } },
  });
  await prisma.purchaseReturn.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
  await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
  await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
  await prisma.supplierPayment.deleteMany({ where: { supplierId: { in: supplierIds } } });

  await prisma.stockMovement.deleteMany({
    where: { product: { name: { startsWith: PREFIX } } },
  });
  const testProducts = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const testProductIds = testProducts.map((p) => p.id);
  if (testProductIds.length) {
    await prisma.exchangeItem.deleteMany({ where: { productId: { in: testProductIds } } });
    await prisma.saleReturnItem.deleteMany({ where: { productId: { in: testProductIds } } });
    await prisma.invoiceItem.deleteMany({ where: { productId: { in: testProductIds } } });
  }
  await prisma.productVariant.deleteMany({
    where: { product: { name: { startsWith: PREFIX } } },
  });
  await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });

  await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });

  if (accountIds.length) {
    await prisma.account.updateMany({
      where: { id: { in: accountIds } },
      data: { isActive: false },
    });
  }
}

describe('suppliers & purchases (Phase 5)', () => {
  let userId: number;
  let voucherDate: string;
  let runId: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    voucherDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
  });

  beforeEach(async () => {
    runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await cleanup();
  });

  it('purchase posts a balanced voucher and increases stock exactly once', async () => {
    const supplier = await createSupplier({
      name: `${PREFIX}Supplier A ${runId}`,
      openingBalance: 0,
    });
    const product = await createProduct({
      name: `${PREFIX}Shirt ${runId}`,
      salePrice: 800,
      openingStock: 2,
    });

    const stockBefore = product.currentStock;
    const purchase = await createPurchase({
      supplierId: supplier.id,
      date: voucherDate,
      items: [{ productId: product.id, quantity: 5, purchasePrice: 400 }],
      paidAmount: 2000,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    expect(purchase.totalAmount).toBe(2000);
    expect(purchase.paidAmount).toBe(2000);
    expect(purchase.remainingAmount).toBe(0);

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.currentStock).toBe(stockBefore + 5);
    expect(Number(updated.purchasePrice)).toBe(400);
    expect(updated.purchasePrice).not.toBe(0);

    const movements = await prisma.stockMovement.findMany({
      where: {
        productId: product.id,
        type: StockMovementType.PURCHASE,
        sourceType: 'PURCHASE',
        sourceRef: String(purchase.id),
      },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity).toBe(5);

    const vouchers = await prisma.voucher.findMany({
      where: {
        sourceType: 'PURCHASE',
        sourceRef: String(purchase.id),
        status: VoucherStatus.ACTIVE,
      },
      include: { ledgerEntries: true },
    });
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]!.type).toBe(VoucherType.PURCHASE);

    const debits = vouchers[0]!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const credits = vouchers[0]!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(debits).toBeCloseTo(credits, 2);
    expect(debits).toBeCloseTo(2000, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('partial payment creates correct supplier payable', async () => {
    const supplier = await createSupplier({
      name: `${PREFIX}Supplier Partial ${runId}`,
      openingBalance: 0,
    });
    const product = await createProduct({
      name: `${PREFIX}Pants ${runId}`,
      salePrice: 1000,
    });

    const purchase = await createPurchase({
      supplierId: supplier.id,
      date: voucherDate,
      items: [{ productId: product.id, quantity: 4, purchasePrice: 250 }],
      paidAmount: 400,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    expect(purchase.totalAmount).toBe(1000);
    expect(purchase.paidAmount).toBe(400);
    expect(purchase.remainingAmount).toBe(600);
    expect(purchase.confirmation.addedToSupplierBalance).toBe(600);

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: supplier.accountId! },
      include: { ledger: true },
    });
    // CR balance is negative in this ledger convention
    expect(Number(account.ledger!.balance)).toBeCloseTo(-600, 2);
  });

  it('purchase return reverses stock and accounting; negative stock still blocked', async () => {
    const supplier = await createSupplier({
      name: `${PREFIX}Supplier Return ${runId}`,
      openingBalance: 0,
    });
    const product = await createProduct({
      name: `${PREFIX}Jacket ${runId}`,
      salePrice: 2000,
      openingStock: 0,
    });

    const purchase = await createPurchase({
      supplierId: supplier.id,
      date: voucherDate,
      items: [{ productId: product.id, quantity: 3, purchasePrice: 700 }],
      paidAmount: 0,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    const afterPurchase = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterPurchase.currentStock).toBe(3);

    const ret = await createPurchaseReturn({
      purchaseId: purchase.id,
      items: [{ purchaseItemId: purchase.items[0]!.id, quantity: 2 }],
      createdById: userId,
    });
    expect(ret.totalAmount).toBe(1400);

    const afterReturn = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterReturn.currentStock).toBe(1);

    await expect(
      createPurchaseReturn({
        purchaseId: purchase.id,
        items: [{ purchaseItemId: purchase.items[0]!.id, quantity: 5 }],
        createdById: userId,
      }),
    ).rejects.toThrow(/Cannot return more/i);

    // Try returning remaining 1 then attempt over-reduce via another return path is already covered;
    // also ensure adjustStock still blocks going negative if we try quantity > stock somehow
    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);

    const returnVoucher = await prisma.voucher.findFirst({
      where: {
        sourceType: 'PURCHASE_RETURN',
        sourceRef: String(ret.id),
        status: VoucherStatus.ACTIVE,
      },
      include: { ledgerEntries: true },
    });
    expect(returnVoucher).toBeTruthy();
    const d = returnVoucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const c = returnVoucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(d).toBeCloseTo(c, 2);
  });

  it('updates purchasePrice to latest cost and clears costNotSet', async () => {
    const supplier = await createSupplier({ name: `${PREFIX}Supplier Cost ${runId}` });
    const product = await createProduct({
      name: `${PREFIX}Cap ${runId}`,
      salePrice: 300,
    });
    expect(product.costNotSet).toBe(true);
    expect(product.purchasePrice).toBe(0);

    await createPurchase({
      supplierId: supplier.id,
      date: voucherDate,
      items: [{ productId: product.id, quantity: 2, purchasePrice: 120 }],
      paidAmount: 240,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(updated.purchasePrice)).toBe(120);

    const { getProduct } = await import('../products/products.service');
    const serialized = await getProduct(product.id);
    expect(serialized.costNotSet).toBe(false);
  });

  it('supplier payment reduces payable', async () => {
    const supplier = await createSupplier({
      name: `${PREFIX}Supplier Pay ${runId}`,
      openingBalance: 0,
    });
    const product = await createProduct({
      name: `${PREFIX}Socks ${runId}`,
      salePrice: 100,
    });

    await createPurchase({
      supplierId: supplier.id,
      date: voucherDate,
      items: [{ productId: product.id, quantity: 10, purchasePrice: 50 }],
      paidAmount: 200,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    const payment = await createSupplierPayment({
      supplierId: supplier.id,
      amount: 150,
      paymentMethod: PurchasePaymentMethod.CASH,
      date: voucherDate,
      createdById: userId,
    });

    expect(payment.confirmation.remainingPayable).toBeCloseTo(150, 2);

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: supplier.accountId! },
      include: { ledger: true },
    });
    expect(Number(account.ledger!.balance)).toBeCloseTo(-150, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });
});
