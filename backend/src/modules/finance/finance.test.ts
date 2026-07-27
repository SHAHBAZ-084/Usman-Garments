import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LedgerEntryType,
  PurchasePaymentMethod,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { bootstrapChartOfAccounts, getTrialBalance } from '../accounting/accounting.service';
import {
  createExpense,
  createExpenseCategory,
  createOtherIncome,
  listExpenseCategories,
  listOtherIncomeCategories,
} from './finance.service';

const PREFIX = 'TEST-P10-';

async function cleanup() {
  await prisma.expense.deleteMany({
    where: { description: { startsWith: PREFIX } },
  });
  await prisma.otherIncome.deleteMany({
    where: { description: { startsWith: PREFIX } },
  });
  await prisma.expenseCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.otherIncomeCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

describe('Expenses & other income (Phase 10)', () => {
  let userId: number;
  let voucherDate: string;
  let runId: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    voucherDate = await voucherDateInActiveYear();
  });

  beforeEach(async () => {
    runId = `${Date.now()}`;
    await cleanup();
  });

  it('expense posts balanced voucher correctly', async () => {
    const categories = await listExpenseCategories();
    const electricity = categories.find((c) => c.name === 'Electricity');
    expect(electricity).toBeTruthy();

    const expense = await createExpense({
      categoryId: electricity!.id,
      date: voucherDate,
      amount: 1500,
      paymentMethod: PurchasePaymentMethod.CASH,
      description: `${PREFIX}Shop electricity bill ${runId}`,
      paidTo: 'LESCO',
      createdById: userId,
    });

    expect(expense.confirmation.message).toMatch(/Expense recorded/i);

    const voucher = await prisma.voucher.findFirst({
      where: {
        sourceType: 'EXPENSE',
        sourceRef: String(expense.id),
        status: VoucherStatus.ACTIVE,
      },
      include: { ledgerEntries: true },
    });
    expect(voucher?.type).toBe(VoucherType.EXPENSE);
    const d = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    const c = voucher!.ledgerEntries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((s, e) => s + Number(e.amount), 0);
    expect(d).toBeCloseTo(1500, 2);
    expect(c).toBeCloseTo(1500, 2);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('other income posts balanced voucher correctly', async () => {
    const categories = await listOtherIncomeCategories();
    const misc = categories.find((c) => c.name === 'Miscellaneous');
    expect(misc).toBeTruthy();

    const income = await createOtherIncome({
      categoryId: misc!.id,
      date: voucherDate,
      amount: 800,
      paymentMethod: PurchasePaymentMethod.CASH,
      description: `${PREFIX}Scrap sale ${runId}`,
      createdById: userId,
    });

    expect(income.confirmation.message).toMatch(/Other income recorded/i);

    const voucher = await prisma.voucher.findFirst({
      where: {
        sourceType: 'OTHER_INCOME',
        sourceRef: String(income.id),
        status: VoucherStatus.ACTIVE,
      },
      include: { ledgerEntries: true },
    });
    expect(voucher?.type).toBe(VoucherType.OTHER_INCOME);
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

  it('expense category quick-add works', async () => {
    const name = `${PREFIX}Custom ${runId}`;
    const created = await createExpenseCategory(name);
    expect(created.name).toBe(name);

    const catRow = await prisma.expenseCategory.findUniqueOrThrow({
      where: { id: created.id },
      include: { account: true },
    });
    expect(catRow.accountId).toBeTruthy();
    expect(catRow.account?.type).toBe('EXPENSE');
  });
});
