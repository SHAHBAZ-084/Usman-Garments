import { describe, expect, it, beforeEach } from 'vitest';
import { AccountType, PurchasePaymentMethod, SalePaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { bootstrapChartOfAccounts, getFinanceCommandCenter } from '../accounting/accounting.service';
import { getFinancialSummary } from '../reports/financial-summary.service';
import { createSale } from '../sales/sales.service';
import { createProduct } from '../products/products.service';
import {
  listBankAccounts,
  resolvePaymentAccount,
  paymentMethodNeedsBankAccount,
  createSupplierPayment,
  createPurchase,
} from '../purchases/purchases.service';
import { createSupplier } from '../suppliers/suppliers.service';

describe('multi-bank accounts & finance command center', () => {
  let bankCatId: number;
  let userId: number;
  let bankAId: number;
  let bankBId: number;

  beforeEach(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('no user');
    userId = user.id;

    const bankCat = await prisma.accountCategory.findFirst({ where: { name: 'Bank' } });
    if (!bankCat) throw new Error('Bank category missing');
    bankCatId = bankCat.id;

    const a = await prisma.account.create({
      data: {
        categoryId: bankCatId,
        name: `HBL Test ${Date.now()}`,
        code: `HBL-${Date.now()}`,
        type: AccountType.ASSET,
      },
    });
    await prisma.ledger.create({ data: { accountId: a.id, balance: 0 } });
    bankAId = a.id;

    const b = await prisma.account.create({
      data: {
        categoryId: bankCatId,
        name: `Meezan Test ${Date.now() + 1}`,
        code: `MZN-${Date.now() + 1}`,
        type: AccountType.ASSET,
      },
    });
    await prisma.ledger.create({ data: { accountId: b.id, balance: 0 } });
    bankBId = b.id;
  });

  it('lists bank accounts independently', async () => {
    const banks = await listBankAccounts();
    expect(banks.some((x) => x.id === bankAId)).toBe(true);
    expect(banks.some((x) => x.id === bankBId)).toBe(true);
    expect(paymentMethodNeedsBankAccount(PurchasePaymentMethod.CARD)).toBe(true);
    expect(paymentMethodNeedsBankAccount(PurchasePaymentMethod.CASH)).toBe(false);
  });

  it('rejects card/bank transfer without paymentAccountId', async () => {
    await expect(
      prisma.$transaction((tx) =>
        resolvePaymentAccount(tx, PurchasePaymentMethod.BANK_TRANSFER, null),
      ),
    ).rejects.toThrow(/Select a bank account/i);
  });

  it('bank-transfer sale updates only the selected bank account', async () => {
    const product = await createProduct({
      name: `Bank Sale Prod ${Date.now()}`,
      salePrice: 1000,
      purchasePrice: 500,
      openingStock: 10,
    });

    const beforeA = Number((await prisma.ledger.findUnique({ where: { accountId: bankAId } }))!.balance);
    const beforeB = Number((await prisma.ledger.findUnique({ where: { accountId: bankBId } }))!.balance);

    await createSale({
      items: [{ productId: product.id, quantity: 1, rate: 1000 }],
      paymentMethod: SalePaymentMethod.BANK_TRANSFER,
      paidAmount: 1000,
      paymentAccountId: bankAId,
      createdById: userId,
    });

    const afterA = Number((await prisma.ledger.findUnique({ where: { accountId: bankAId } }))!.balance);
    const afterB = Number((await prisma.ledger.findUnique({ where: { accountId: bankBId } }))!.balance);
    expect(afterA - beforeA).toBeCloseTo(1000, 2);
    expect(afterB - beforeB).toBeCloseTo(0, 2);
  });

  it('supplier payment isolates to selected bank only', async () => {
    const supplier = await createSupplier({
      name: `Bank Sup ${Date.now()}`,
      openingBalance: 5000,
    });
    const product = await createProduct({
      name: `Bank Pur Prod ${Date.now()}`,
      salePrice: 200,
      purchasePrice: 100,
      openingStock: 0,
    });
    await createPurchase({
      supplierId: supplier.id,
      date: new Date().toISOString(),
      items: [{ productId: product.id, quantity: 1, purchasePrice: 100 }],
      paidAmount: 0,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: userId,
    });

    const beforeA = Number((await prisma.ledger.findUnique({ where: { accountId: bankAId } }))!.balance);
    const beforeB = Number((await prisma.ledger.findUnique({ where: { accountId: bankBId } }))!.balance);

    await createSupplierPayment({
      supplierId: supplier.id,
      amount: 500,
      paymentMethod: PurchasePaymentMethod.BANK_TRANSFER,
      paymentAccountId: bankBId,
      date: new Date().toISOString(),
      createdById: userId,
    });

    const afterA = Number((await prisma.ledger.findUnique({ where: { accountId: bankAId } }))!.balance);
    const afterB = Number((await prisma.ledger.findUnique({ where: { accountId: bankBId } }))!.balance);
    expect(afterA - beforeA).toBeCloseTo(0, 2);
    expect(afterB - beforeB).toBeCloseTo(-500, 2);
  });

  it('finance overview outstanding matches financial-summary; vouchers still queryable', async () => {
    const overview = await getFinanceCommandCenter({ preset: 'month' });
    const summary = await getFinancialSummary('month');
    expect(overview.customerOutstanding).toBe(summary.customerOutstanding);
    expect(overview.supplierOutstanding).toBe(summary.supplierOutstanding);
    expect(overview.totalRevenue).toBe(summary.netSales);
    expect(overview.bankAccounts.some((a) => a.id === bankAId)).toBe(true);

    const vouchers = await prisma.voucher.findMany({ take: 5 });
    expect(Array.isArray(vouchers)).toBe(true);
  });
});
