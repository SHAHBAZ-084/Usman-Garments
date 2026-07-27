import { beforeAll, describe, expect, it } from 'vitest';
import { LedgerEntryType, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  cancelActiveVouchersBySourceInTx,
  COGS_ACCOUNT_NAME,
  createMultiLegVoucherInTx,
  ensureRetailSystemAccounts,
  getTrialBalance,
  SALES_RETURN_ACCOUNT_NAME,
} from './accounting.service';

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUniqueOrThrow({ where: { accountId } });
  return Number(ledger.balance);
}

describe('retail multi-leg posting foundation', () => {
  let userId: number;
  let voucherDate: string;
  let cashId: number;
  let salesId: number;
  let inventoryId: number;
  let cogsId: number;

  beforeAll(async () => {
    voucherDate = await voucherDateInActiveYear();
    await bootstrapChartOfAccounts();

    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const accounts = await prisma.$transaction(async (tx) => ensureRetailSystemAccounts(tx));
    cashId = accounts.cashInHand.id;
    salesId = accounts.saleRevenue.id;
    inventoryId = accounts.inventory.id;
    cogsId = accounts.cogs.id;

    // Second call must stay idempotent (no duplicates).
    const again = await prisma.$transaction(async (tx) => ensureRetailSystemAccounts(tx));
    expect(again.cashInHand.id).toBe(cashId);
    expect(again.saleRevenue.id).toBe(salesId);
    expect(again.inventory.id).toBe(inventoryId);
    expect(again.cogs.id).toBe(cogsId);
    expect(again.salesReturn.name).toBe(SALES_RETURN_ACCOUNT_NAME);
    expect(again.cogs.name).toBe(COGS_ACCOUNT_NAME);
  });

  it('posts a synthetic cash sale (cash + COGS/inventory) under source SALE', async () => {
    const sourceRef = `TEST-SALE-${Date.now()}`;
    const saleAmount = 1000;
    const costAmount = 400;

    const cashBefore = await ledgerBalance(cashId);
    const salesBefore = await ledgerBalance(salesId);
    const inventoryBefore = await ledgerBalance(inventoryId);
    const cogsBefore = await ledgerBalance(cogsId);

    await prisma.$transaction(async (tx) => {
      await createMultiLegVoucherInTx(tx, {
        type: VoucherType.SALE,
        amount: saleAmount,
        date: voucherDate,
        description: 'Synthetic cash sale with COGS',
        sourceType: 'SALE',
        sourceRef,
        createdById: userId,
        legs: [
          { accountId: cashId, type: LedgerEntryType.DEBIT, amount: saleAmount },
          { accountId: salesId, type: LedgerEntryType.CREDIT, amount: saleAmount },
          { accountId: cogsId, type: LedgerEntryType.DEBIT, amount: costAmount },
          { accountId: inventoryId, type: LedgerEntryType.CREDIT, amount: costAmount },
        ],
      });
    });

    expect(await ledgerBalance(cashId)).toBeCloseTo(cashBefore + saleAmount, 2);
    expect(await ledgerBalance(salesId)).toBeCloseTo(salesBefore - saleAmount, 2);
    expect(await ledgerBalance(inventoryId)).toBeCloseTo(inventoryBefore - costAmount, 2);
    expect(await ledgerBalance(cogsId)).toBeCloseTo(cogsBefore + costAmount, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);

    const posted = await prisma.voucher.findMany({
      where: { sourceType: 'SALE', sourceRef, status: VoucherStatus.ACTIVE },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe(VoucherType.SALE);
    expect(posted[0]!.reference).toBe(sourceRef);
  });

  it('posts a synthetic cash purchase under source PURCHASE', async () => {
    const sourceRef = `TEST-PURCHASE-${Date.now()}`;
    const amount = 250;

    const cashBefore = await ledgerBalance(cashId);
    const inventoryBefore = await ledgerBalance(inventoryId);

    await prisma.$transaction(async (tx) => {
      await createMultiLegVoucherInTx(tx, {
        type: VoucherType.PURCHASE,
        amount,
        date: voucherDate,
        description: 'Synthetic cash purchase',
        sourceType: 'PURCHASE',
        sourceRef,
        createdById: userId,
        legs: [
          { accountId: inventoryId, type: LedgerEntryType.DEBIT, amount },
          { accountId: cashId, type: LedgerEntryType.CREDIT, amount },
        ],
      });
    });

    expect(await ledgerBalance(inventoryId)).toBeCloseTo(inventoryBefore + amount, 2);
    expect(await ledgerBalance(cashId)).toBeCloseTo(cashBefore - amount, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('rejects unbalanced multi-leg posting before commit', async () => {
    await expect(
      prisma.$transaction(async (tx) =>
        createMultiLegVoucherInTx(tx, {
          type: VoucherType.SALE,
          amount: 100,
          date: voucherDate,
          description: 'Unbalanced',
          sourceType: 'SALE',
          sourceRef: `TEST-UNBALANCED-${Date.now()}`,
          createdById: userId,
          legs: [
            { accountId: cashId, type: LedgerEntryType.DEBIT, amount: 100 },
            { accountId: salesId, type: LedgerEntryType.CREDIT, amount: 90 },
          ],
        }),
      ),
    ).rejects.toThrow(/do not balance/i);
  });

  it('rejects duplicate active posting for same sourceType+sourceRef+voucherType', async () => {
    const sourceRef = `TEST-DUP-${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      await createMultiLegVoucherInTx(tx, {
        type: VoucherType.SALE,
        amount: 50,
        date: voucherDate,
        description: 'First post',
        sourceType: 'SALE',
        sourceRef,
        createdById: userId,
        legs: [
          { accountId: cashId, type: LedgerEntryType.DEBIT, amount: 50 },
          { accountId: salesId, type: LedgerEntryType.CREDIT, amount: 50 },
        ],
      });
    });

    await expect(
      prisma.$transaction(async (tx) =>
        createMultiLegVoucherInTx(tx, {
          type: VoucherType.SALE,
          amount: 50,
          date: voucherDate,
          description: 'Duplicate post',
          sourceType: 'SALE',
          sourceRef,
          createdById: userId,
          legs: [
            { accountId: cashId, type: LedgerEntryType.DEBIT, amount: 50 },
            { accountId: salesId, type: LedgerEntryType.CREDIT, amount: 50 },
          ],
        }),
      ),
    ).rejects.toThrow(/Duplicate posting blocked/i);
  });

  it('cancels by source and reverses ledger net effect to zero for that group', async () => {
    const sourceRef = `TEST-REV-${Date.now()}`;
    const amount = 75;

    const cashBefore = await ledgerBalance(cashId);
    const salesBefore = await ledgerBalance(salesId);

    await prisma.$transaction(async (tx) => {
      await createMultiLegVoucherInTx(tx, {
        type: VoucherType.SALE,
        amount,
        date: voucherDate,
        description: 'Reversal scenario sale',
        sourceType: 'SALE',
        sourceRef,
        createdById: userId,
        legs: [
          { accountId: cashId, type: LedgerEntryType.DEBIT, amount },
          { accountId: salesId, type: LedgerEntryType.CREDIT, amount },
        ],
      });
    });

    expect(await ledgerBalance(cashId)).toBeCloseTo(cashBefore + amount, 2);

    await prisma.$transaction(async (tx) => {
      const cancelled = await cancelActiveVouchersBySourceInTx(tx, 'SALE', sourceRef, userId);
      expect(cancelled).toBe(1);
    });

    const vouchers = await prisma.voucher.findMany({
      where: { sourceType: 'SALE', sourceRef },
    });
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]!.status).toBe(VoucherStatus.CANCELLED);

    expect(await ledgerBalance(cashId)).toBeCloseTo(cashBefore, 2);
    expect(await ledgerBalance(salesId)).toBeCloseTo(salesBefore, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });
});
