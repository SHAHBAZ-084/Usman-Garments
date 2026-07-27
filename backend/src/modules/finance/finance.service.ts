import {
  AccountType,
  LedgerEntryType,
  Prisma,
  PurchasePaymentMethod,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createMultiLegVoucherInTx,
  EXPENSES_CATEGORY_NAME,
  ensureSystemAccount,
  INCOME_CATEGORY_NAME,
} from '../accounting/accounting.service';
import { ensurePaymentMethodAccount } from '../purchases/purchases.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salary',
  'Transport',
  'Packaging',
  'Refreshments',
  'Repair',
  'Internet',
  'Miscellaneous',
] as const;

export const DEFAULT_OTHER_INCOME_CATEGORIES = ['Miscellaneous', 'Scrap', 'Commission'] as const;

async function ensureExpenseCategoryAccountInTx(tx: Prisma.TransactionClient, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await tx.expenseCategory.findUnique({ where: { name: trimmed } });
  if (existing?.accountId) return existing;

  const account = await ensureSystemAccount(
    tx,
    EXPENSES_CATEGORY_NAME,
    trimmed,
    AccountType.EXPENSE,
  );

  if (existing) {
    return tx.expenseCategory.update({
      where: { id: existing.id },
      data: { accountId: account.id },
    });
  }

  return tx.expenseCategory.create({
    data: { name: trimmed, accountId: account.id },
  });
}

async function ensureOtherIncomeCategoryAccountInTx(tx: Prisma.TransactionClient, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await tx.otherIncomeCategory.findUnique({ where: { name: trimmed } });
  if (existing?.accountId) return existing;

  const account = await ensureSystemAccount(
    tx,
    INCOME_CATEGORY_NAME,
    trimmed,
    AccountType.REVENUE,
  );

  if (existing) {
    return tx.otherIncomeCategory.update({
      where: { id: existing.id },
      data: { accountId: account.id },
    });
  }

  return tx.otherIncomeCategory.create({
    data: { name: trimmed, accountId: account.id },
  });
}

export async function ensureDefaultExpenseCategories() {
  await prisma.$transaction(async (tx) => {
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await ensureExpenseCategoryAccountInTx(tx, name);
    }
  });
}

export async function ensureDefaultOtherIncomeCategories() {
  await prisma.$transaction(async (tx) => {
    for (const name of DEFAULT_OTHER_INCOME_CATEGORIES) {
      await ensureOtherIncomeCategoryAccountInTx(tx, name);
    }
  });
}

export async function listExpenseCategories() {
  await ensureDefaultExpenseCategories();
  const rows = await prisma.expenseCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive }));
}

export async function createExpenseCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await prisma.expenseCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    if (!existing.isActive) {
      const updated = await prisma.expenseCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      return { id: updated.id, name: updated.name, isActive: updated.isActive };
    }
    throw new AppError(409, `Expense category "${trimmed}" already exists`);
  }

  const row = await prisma.$transaction((tx) => ensureExpenseCategoryAccountInTx(tx, trimmed));
  return { id: row.id, name: row.name, isActive: row.isActive };
}

export async function listOtherIncomeCategories() {
  await ensureDefaultOtherIncomeCategories();
  const rows = await prisma.otherIncomeCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive }));
}

export async function createOtherIncomeCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await prisma.otherIncomeCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    if (!existing.isActive) {
      const updated = await prisma.otherIncomeCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      return { id: updated.id, name: updated.name, isActive: updated.isActive };
    }
    throw new AppError(409, `Income category "${trimmed}" already exists`);
  }

  const row = await prisma.$transaction((tx) => ensureOtherIncomeCategoryAccountInTx(tx, trimmed));
  return { id: row.id, name: row.name, isActive: row.isActive };
}

export type CreateExpenseInput = {
  categoryId: number;
  date: string;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  description: string;
  paidTo?: string | null;
  note?: string | null;
  createdById: number;
};

export async function createExpense(input: CreateExpenseInput) {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than zero');

  const description = input.description.trim();
  if (!description) throw new AppError(400, 'Description is required');

  const category = await prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.isActive) throw new AppError(400, 'Expense category not found');
  if (!category.accountId) throw new AppError(400, 'Expense category has no ledger account');

  const expenseId = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        categoryId: category.id,
        date: new Date(input.date),
        amount,
        paymentMethod: input.paymentMethod,
        description,
        paidTo: input.paidTo?.trim() || null,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    const paymentAccount = await ensurePaymentMethodAccount(tx, input.paymentMethod);

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.EXPENSE,
      amount,
      date: input.date,
      description: `${category.name}: ${description}`,
      sourceType: 'EXPENSE',
      sourceRef: String(expense.id),
      createdById: input.createdById,
      legs: [
        { accountId: category.accountId!, type: LedgerEntryType.DEBIT, amount },
        { accountId: paymentAccount.id, type: LedgerEntryType.CREDIT, amount },
      ],
    });

    return expense.id;
  });

  const row = await prisma.expense.findUniqueOrThrow({
    where: { id: expenseId },
    include: { category: { select: { id: true, name: true } } },
  });

  return {
    id: row.id,
    categoryId: row.categoryId,
    category: row.category,
    date: row.date,
    amount: Number(row.amount),
    paymentMethod: row.paymentMethod,
    description: row.description,
    paidTo: row.paidTo,
    note: row.note,
    createdAt: row.createdAt,
    confirmation: {
      message: `Expense recorded: Rs ${Number(row.amount).toLocaleString('en-PK')}`,
    },
  };
}

export async function listExpenses(params: { fromDate?: string; toDate?: string } = {}) {
  const where: Prisma.ExpenseWhereInput = {};
  if (params.fromDate || params.toDate) {
    where.date = {};
    if (params.fromDate) where.date.gte = new Date(params.fromDate);
    if (params.toDate) {
      const end = new Date(params.toDate);
      end.setHours(23, 59, 59, 999);
      where.date.lte = end;
    }
  }

  const rows = await prisma.expense.findMany({
    where,
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    category: r.category,
    date: r.date,
    amount: Number(r.amount),
    paymentMethod: r.paymentMethod,
    description: r.description,
    paidTo: r.paidTo,
    note: r.note,
    createdAt: r.createdAt,
  }));
}

export type CreateOtherIncomeInput = {
  categoryId: number;
  date: string;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  description: string;
  note?: string | null;
  createdById: number;
};

export async function createOtherIncome(input: CreateOtherIncomeInput) {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than zero');

  const description = input.description.trim();
  if (!description) throw new AppError(400, 'Description is required');

  const category = await prisma.otherIncomeCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.isActive) throw new AppError(400, 'Income category not found');
  if (!category.accountId) throw new AppError(400, 'Income category has no ledger account');

  const incomeId = await prisma.$transaction(async (tx) => {
    const income = await tx.otherIncome.create({
      data: {
        categoryId: category.id,
        date: new Date(input.date),
        amount,
        paymentMethod: input.paymentMethod,
        description,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    const paymentAccount = await ensurePaymentMethodAccount(tx, input.paymentMethod);

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.OTHER_INCOME,
      amount,
      date: input.date,
      description: `${category.name}: ${description}`,
      sourceType: 'OTHER_INCOME',
      sourceRef: String(income.id),
      createdById: input.createdById,
      legs: [
        { accountId: paymentAccount.id, type: LedgerEntryType.DEBIT, amount },
        { accountId: category.accountId!, type: LedgerEntryType.CREDIT, amount },
      ],
    });

    return income.id;
  });

  const row = await prisma.otherIncome.findUniqueOrThrow({
    where: { id: incomeId },
    include: { category: { select: { id: true, name: true } } },
  });

  return {
    id: row.id,
    categoryId: row.categoryId,
    category: row.category,
    date: row.date,
    amount: Number(row.amount),
    paymentMethod: row.paymentMethod,
    description: row.description,
    note: row.note,
    createdAt: row.createdAt,
    confirmation: {
      message: `Other income recorded: Rs ${Number(row.amount).toLocaleString('en-PK')}`,
    },
  };
}

export async function listOtherIncomes(params: { fromDate?: string; toDate?: string } = {}) {
  const where: Prisma.OtherIncomeWhereInput = {};
  if (params.fromDate || params.toDate) {
    where.date = {};
    if (params.fromDate) where.date.gte = new Date(params.fromDate);
    if (params.toDate) {
      const end = new Date(params.toDate);
      end.setHours(23, 59, 59, 999);
      where.date.lte = end;
    }
  }

  const rows = await prisma.otherIncome.findMany({
    where,
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    category: r.category,
    date: r.date,
    amount: Number(r.amount),
    paymentMethod: r.paymentMethod,
    description: r.description,
    note: r.note,
    createdAt: r.createdAt,
  }));
}
