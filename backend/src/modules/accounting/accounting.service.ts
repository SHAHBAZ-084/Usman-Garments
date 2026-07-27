import { AccountType, FinancialYearStatus, LedgerEntryType, Prisma, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { assertNotMaalKhataLinkedAccount, isMaalKhataCategoryName } from './maal-khata-legacy';
import {
  compareLedgerEntries,
  computeLedgerBalance,
  endOfDay,
  entryEffectiveDate,
  isTrialBalanceBalanced,
  parseVoucherDateInput,
  startOfDay,
  trialBalanceFromSignedBalance,
} from './ledger-utils';

type DbClient = Prisma.TransactionClient | typeof prisma;

export function fiscalYearLabelForDate(date: Date): { label: string; startDate: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 6) {
    return { label: `${year}-${year + 1}`, startDate: new Date(year, 6, 1) };
  }
  return { label: `${year - 1}-${year}`, startDate: new Date(year - 1, 6, 1) };
}

function nextFiscalYearLabel(label: string): string {
  const startYear = parseInt(label.split('-')[0] ?? '', 10);
  if (!Number.isFinite(startYear)) {
    throw new AppError(500, 'Invalid financial year label');
  }
  return `${startYear + 1}-${startYear + 2}`;
}

export async function getActiveFinancialYearId(db: DbClient): Promise<number> {
  const year = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
    select: { id: true },
  });
  if (!year) throw new AppError(400, 'No active financial year');
  return year.id;
}

export async function assertActiveFinancialYear(
  db: DbClient,
  financialYearId: number | null | undefined,
): Promise<void> {
  const activeId = await getActiveFinancialYearId(db);
  if (financialYearId == null || financialYearId !== activeId) {
    throw new AppError(
      403,
      'This record belongs to a closed financial year and can no longer be edited or deleted.',
    );
  }
}

/** Voucher accounting date must fall inside the active financial year (not just "a year exists"). */
export async function assertVoucherDateInActiveFinancialYear(
  db: DbClient,
  voucherDate: Date,
): Promise<number> {
  const activeYear = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!activeYear) throw new AppError(400, 'No active financial year');

  const day = startOfDay(voucherDate);
  const yearStart = startOfDay(activeYear.startDate);
  if (day < yearStart) {
    throw new AppError(400, 'Voucher date is before the active financial year');
  }
  if (activeYear.endDate) {
    const yearEnd = endOfDay(activeYear.endDate);
    if (day > yearEnd) {
      throw new AppError(400, 'Voucher date is after the active financial year');
    }
  }
  return activeYear.id;
}

async function assertTrialBalanceInDev(db: DbClient) {
  if (process.env.NODE_ENV === 'production') return;
  const ledgers = await db.ledger.findMany({ select: { balance: true } });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of ledgers) {
    const { debit, credit } = trialBalanceFromSignedBalance(Number(l.balance));
    totalDebit += debit;
    totalCredit += credit;
  }
  if (!isTrialBalanceBalanced(totalDebit, totalCredit)) {
    console.error('[accounting] Trial balance mismatch after voucher change', {
      totalDebit,
      totalCredit,
    });
  }
}

async function getOpeningBalanceSnapshot(
  db: DbClient,
  accountId: number,
  financialYearId: number,
): Promise<{ balance: number; priorYearLabel: string | null }> {
  const currentYear = await db.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!currentYear) return { balance: 0, priorYearLabel: null };

  const priorYear = await db.financialYear.findFirst({
    where: { startDate: { lt: currentYear.startDate } },
    orderBy: { startDate: 'desc' },
    select: { id: true, label: true },
  });
  if (!priorYear) return { balance: 0, priorYearLabel: null };

  const snapshot = await db.financialYearClosingBalance.findUnique({
    where: {
      financialYearId_accountId: {
        financialYearId: priorYear.id,
        accountId,
      },
    },
  });
  return {
    balance: snapshot ? Number(snapshot.balance) : 0,
    priorYearLabel: priorYear.label,
  };
}

export async function listFinancialYears() {
  return prisma.financialYear.findMany({
    where: {},
    orderBy: { startDate: 'desc' },
    include: {
      closedBy: { select: { id: true, displayName: true, username: true } },
    },
  });
}

export async function closeFinancialYear(userId: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const activeYear = await tx.financialYear.findFirst({
      where: { status: FinancialYearStatus.ACTIVE },
    });
    if (!activeYear) throw new AppError(400, 'No active financial year to close');

    const accounts = await tx.account.findMany({
      where: {},
      include: { ledger: true },
    });

    for (const account of accounts) {
      const balance = account.ledger ? Number(account.ledger.balance) : 0;
      await tx.financialYearClosingBalance.create({
        data: {
          financialYearId: activeYear.id,
          accountId: account.id,
          balance,
        },
      });
    }

    const endDate = new Date();
    const closedYear = await tx.financialYear.update({
      where: { id: activeYear.id },
      data: {
        status: FinancialYearStatus.CLOSED,
        closedAt: endDate,
        closedById: userId,
        endDate,
      },
    });

    const nextStart = new Date(endDate);
    nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(0, 0, 0, 0);

    const newYear = await tx.financialYear.create({
      data: {
        label: nextFiscalYearLabel(activeYear.label),
        startDate: nextStart,
        status: FinancialYearStatus.ACTIVE,
      },
    });

    return { closedYear, newYear };
  });
}

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

async function loadAccounts(
  tx: Prisma.TransactionClient,
  debitAccountId: number,
  creditAccountId: number,
) {
  if (debitAccountId === creditAccountId) {
    throw new AppError(400, 'Debit and credit accounts must be different');
  }

  const [debitAccount, creditAccount] = await Promise.all([
    tx.account.findFirst({
      where: { id: debitAccountId, isActive: true },
      include: { category: true },
    }),
    tx.account.findFirst({
      where: { id: creditAccountId, isActive: true },
      include: { category: true },
    }),
  ]);

  if (!debitAccount || !creditAccount) {
    throw new AppError(400, 'One or both accounts are invalid');
  }

  return { debitAccount, creditAccount };
}

function assertVoucherAccountRules(
  type: VoucherType,
  debitAccount: { category: { name: string } },
  creditAccount: { category: { name: string } },
) {
  if (type === 'RECEIPT' && !isBankOrCashCategory(debitAccount.category.name)) {
    throw new AppError(400, 'Receipt must debit a Bank or Cash account (To side)');
  }
  if (type === 'PAYMENT' && !isBankOrCashCategory(creditAccount.category.name)) {
    throw new AppError(400, 'Payment must credit a Bank or Cash account (From side)');
  }
}

type VoucherCreateInput = {
  type: VoucherType;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  date: Date;
  description?: string;
  reference: string;
};

/** Shared server-side validation for all voucher types (payment, receipt, journal). */
async function validateVoucherCreate(
  tx: Prisma.TransactionClient,
  data: VoucherCreateInput,
) {
  if (!(data.amount > 0)) {
    throw new AppError(400, 'Amount must be greater than zero');
  }

  if (isMultiLegVoucherType(data.type)) {
    throw new AppError(400, 'Invoice vouchers are created via invoice posting');
  }

  const reference = data.reference?.trim();
  if (!reference) {
    throw new AppError(400, 'Reference is required');
  }

  const { debitAccount, creditAccount } = await loadAccounts(
    tx,
    data.debitAccountId,
    data.creditAccountId,
  );
  assertVoucherAccountRules(data.type, debitAccount, creditAccount);

  const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, data.date);

  return { debitAccount, creditAccount, financialYearId };
}

async function recomputeLedgerRunningBalancesInTx(
  tx: Prisma.TransactionClient,
  ledgerId: number,
  financialYearId: number,
) {
  const ledger = await tx.ledger.findUniqueOrThrow({
    where: { id: ledgerId },
    include: { account: true },
  });

  const { balance: opening } = await getOpeningBalanceSnapshot(tx, ledger.accountId, financialYearId);
  const { yearStart, yearEnd } = await loadFinancialYearBounds(tx, financialYearId);

  const entries = await tx.ledgerEntry.findMany({
    where: ledgerEntriesForYearWhere(ledgerId, financialYearId, yearStart, yearEnd),
    include: { voucher: { select: { date: true, number: true } } },
    orderBy: { id: 'asc' },
  });

  entries.sort(compareLedgerEntries);

  let running = opening;
  for (const entry of entries) {
    const debit = entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : 0;
    const credit = entry.type === LedgerEntryType.CREDIT ? Number(entry.amount) : 0;
    running = computeLedgerBalance(running, debit, credit);
    const stored = Number(entry.balance);
    if (Math.abs(stored - running) >= 0.005) {
      await tx.ledgerEntry.update({ where: { id: entry.id }, data: { balance: running } });
    }
  }

  await tx.ledger.update({ where: { id: ledgerId }, data: { balance: running } });
}

export const CUSTOMERS_CATEGORY_NAME = 'Customers';

export function isCustomersCategoryName(name: string) {
  return name.trim().toLowerCase() === CUSTOMERS_CATEGORY_NAME.toLowerCase();
}

export async function ensureCustomersCategory() {
  const existing = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: { equals: CUSTOMERS_CATEGORY_NAME } },
  });
  if (existing) return existing;
  return prisma.accountCategory.create({ data: { name: CUSTOMERS_CATEGORY_NAME } });
}

export const SUPPLIERS_CATEGORY_NAME = 'Suppliers';

export const INCOME_CATEGORY_NAME = 'Income';
export const SALE_REVENUE_ACCOUNT_NAME = 'Sale Revenue';
export const SERVICE_REVENUE_ACCOUNT_NAME = 'Service Revenue';
export const INVENTORY_CATEGORY_NAME = 'Inventory';
export const INVENTORY_ACCOUNT_NAME = 'Inventory';
export const CASH_IN_HAND_ACCOUNT_NAME = 'Cash in Hand';
export const COGS_ACCOUNT_NAME = 'Cost of Goods Sold';
export const SALES_RETURN_ACCOUNT_NAME = 'Sales Return';
export const PURCHASE_RETURN_ACCOUNT_NAME = 'Purchase Return';
export const DAMAGED_STOCK_LOSS_ACCOUNT_NAME = 'Damaged Stock Loss';
export const EXPENSES_CATEGORY_NAME = 'Expenses';

/** Voucher types that use multi-leg posting (not the standard debit/credit pair API). */
export const MULTI_LEG_VOUCHER_TYPES: VoucherType[] = [
  VoucherType.KACHI,
  VoucherType.PURCHASE_MAAL,
  VoucherType.SALE,
  VoucherType.SALE_RETURN,
  VoucherType.PURCHASE,
  VoucherType.PURCHASE_RETURN,
  VoucherType.EXCHANGE,
  VoucherType.CUSTOMER_PAYMENT,
  VoucherType.SUPPLIER_PAYMENT,
  VoucherType.EXPENSE,
  VoucherType.OTHER_INCOME,
  VoucherType.ADJUSTMENT,
];

export function isMultiLegVoucherType(type: VoucherType): boolean {
  return MULTI_LEG_VOUCHER_TYPES.includes(type);
}

export const DEFAULT_CATEGORY_NAMES = ['Bank', 'Cash'] as const;

export function isSuppliersCategoryName(name: string) {
  return name.trim().toLowerCase() === SUPPLIERS_CATEGORY_NAME.toLowerCase();
}

export function isInventoryCategoryName(name: string) {
  return name.trim().toLowerCase() === INVENTORY_CATEGORY_NAME.toLowerCase();
}

export function isSystemAccountCategoryName(name: string) {
  return (
    isCustomersCategoryName(name)
    || isSuppliersCategoryName(name)
    || isInventoryCategoryName(name)
    || isMaalKhataCategoryName(name)
  );
}

export async function ensureSuppliersCategory() {
  const existing = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: { equals: SUPPLIERS_CATEGORY_NAME } },
  });
  if (existing) return existing;
  return prisma.accountCategory.create({ data: { name: SUPPLIERS_CATEGORY_NAME } });
}

export async function ensureInventoryCategory() {
  const existing = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INVENTORY_CATEGORY_NAME } },
  });
  if (existing) return existing;
  return prisma.accountCategory.create({ data: { name: INVENTORY_CATEGORY_NAME } });
}

export async function listAccountCategories() {
  await bootstrapChartOfAccounts();

  const categories = await prisma.accountCategory.findMany({
    where: { isActive: true },
    include: { accounts: { where: { isActive: true }, include: { ledger: true } } },
    orderBy: { name: 'asc' },
  });

  return categories.map((category) => {
    const isCustomers = isCustomersCategoryName(category.name);
    const isSuppliers = isSuppliersCategoryName(category.name);
    const isInventory = isInventoryCategoryName(category.name);
    return {
      ...category,
      isCustomersCategory: isCustomers,
      isSuppliersCategory: isSuppliers,
      isInventoryCategory: isInventory,
      entryCount: category.accounts.length,
    };
  });
}

export async function createAccountCategory(name: string) {
  const trimmedName = await assertUniqueCategoryName(name);
  return prisma.accountCategory.create({ data: { name: trimmedName } });
}

export async function updateAccountCategory(id: number, name: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { id, isActive: true },
  });
  if (!category) throw new AppError(404, 'Category not found');

  if (isSystemAccountCategoryName(category.name)) {
    throw new AppError(400, `The ${category.name} category cannot be renamed`);
  }

  const trimmedName = await assertUniqueCategoryName(name, id);
  return prisma.accountCategory.update({
    where: { id },
    data: { name: trimmedName },
  });
}

export async function softDeleteAccountCategory(id: number) {
  const category = await prisma.accountCategory.findFirst({
    where: { id, isActive: true },
    include: { accounts: { where: { isActive: true } } },
  });
  if (!category) throw new AppError(404, 'Category not found');

  if (isSystemAccountCategoryName(category.name)) {
    throw new AppError(400, `The ${category.name} category cannot be deleted`);
  }

  if (category.accounts.length > 0) {
    throw new AppError(
      400,
      `Category "${category.name}" has ${category.accounts.length} active account(s) and cannot be deleted`,
    );
  }

  return prisma.accountCategory.update({
    where: { id },
    data: { isActive: false },
  });
}

async function generateNextAccountCode(): Promise<string> {
  const accounts = await prisma.account.findMany({
    where: {},
    select: { code: true },
  });

  let max = 0;
  for (const { code } of accounts) {
    if (!/^\d+$/.test(code)) continue;
    const num = parseInt(code, 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return String(max + 1);
}

async function resolveAccountType(
  categoryId: number,
  explicit?: AccountType,
): Promise<AccountType> {
  if (explicit) return explicit;

  const sibling = await prisma.account.findFirst({
    where: { categoryId, isActive: true },
    select: { type: true },
  });
  return sibling?.type ?? AccountType.ASSET;
}

async function generateNextAccountCodeInTx(
  tx: Prisma.TransactionClient,
  ): Promise<string> {
  const accounts = await tx.account.findMany({ where: {}, select: { code: true } });
  let max = 0;
  for (const { code } of accounts) {
    if (!/^\d+$/.test(code)) continue;
    const num = parseInt(code, 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return String(max + 1);
}

async function findOrCreateOpeningBalanceEquityAccount(
  tx: Prisma.TransactionClient,
  ) {
  const existing = await tx.account.findFirst({
    where: { isActive: true,
      type: AccountType.EQUITY,
      name: { equals: 'Opening Balance Equity' },
    },
    include: { ledger: true },
  });
  if (existing?.ledger) return existing;

  let category = await tx.accountCategory.findFirst({
    where: { isActive: true,
      name: { equals: 'Capital' },
    },
  });
  if (!category) {
    category = await tx.accountCategory.create({
      data: { name: 'Capital' },
    });
  }

  const account = await tx.account.create({
    data: { categoryId: category.id,
      name: 'Opening Balance Equity',
      code: await generateNextAccountCodeInTx(tx),
      type: AccountType.EQUITY,
    },
  });

  const ledger = await tx.ledger.create({
    data: { accountId: account.id, balance: 0 },
  });

  return tx.account.findUniqueOrThrow({
    where: { id: account.id },
    include: { ledger: true },
  });
}

async function postOpeningBalanceOffset(
  tx: Prisma.TransactionClient,
  accountName: string,
  amount: number,
  side: 'DR' | 'CR',
) {
  const equityAccount = await findOrCreateOpeningBalanceEquityAccount(tx);
  const equityLedger = equityAccount.ledger!;
  const offsetType = side === 'DR' ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT;
  const offsetBalance = Number(equityLedger.balance) + (side === 'DR' ? -amount : amount);

  await tx.ledgerEntry.create({
    data: {
      ledgerId: equityLedger.id,
      type: offsetType,
      amount,
      balance: offsetBalance,
      notes: `Opening Balance — offset for ${accountName}`,
      isOpeningBalance: true,
    },
  });
  await tx.ledger.update({
    where: { id: equityLedger.id },
    data: { balance: offsetBalance },
  });
}

export async function createAccount(data: {
  categoryId: number;
  name: string;
  code?: string;
  type?: AccountType;
  openingBalance?: number;
  openingBalanceSide?: 'DR' | 'CR';
}) {
  const trimmedName = await assertUniqueAccountName(data.name);

  if (isInventoryAccountName(trimmedName)) {
    throw new AppError(
      400,
      'The Inventory account is managed automatically under the Inventory category',
    );
  }

  const category = await prisma.accountCategory.findFirst({
    where: { id: data.categoryId, isActive: true },
  });
  if (!category) throw new AppError(400, 'Invalid category');

  const type = await resolveAccountType(data.categoryId, data.type);
  const trimmedCode = data.code
    ? await assertUniqueAccountCode(data.code)
    : await generateNextAccountCode();

  const amount = Math.abs(data.openingBalance ?? 0);
  const side = data.openingBalanceSide ?? defaultOpeningSide(type);
  const signedBalance = amount === 0 ? 0 : side === 'DR' ? amount : -amount;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const account = await tx.account.create({
      data: {
        categoryId: data.categoryId,
        name: trimmedName,
        code: trimmedCode,
        type,
      },
    });

    const ledger = await tx.ledger.create({
      data: { accountId: account.id, balance: signedBalance },
    });

    if (amount > 0 && trimmedName.toLowerCase() !== 'opening balance equity') {
      await tx.ledgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: side === 'DR' ? LedgerEntryType.DEBIT : LedgerEntryType.CREDIT,
          amount,
          balance: signedBalance,
          notes: 'Opening Balance',
          isOpeningBalance: true,
        },
      });
      await postOpeningBalanceOffset(tx, trimmedName, amount, side);
    }

    return tx.account.findUniqueOrThrow({
      where: { id: account.id },
      include: { category: true, ledger: true },
    });
  });
}

function defaultOpeningSide(type: AccountType): 'DR' | 'CR' {
  return type === AccountType.ASSET || type === AccountType.EXPENSE ? 'DR' : 'CR';
}

function ledgerEntriesForYearWhere(
  ledgerId: number,
  financialYearId: number,
  yearStart: Date,
  yearEnd: Date | null,
): Prisma.LedgerEntryWhereInput {
  return {
    ledgerId,
    isReversal: false,
    OR: [
      {
        voucher: {
          financialYearId,
          status: VoucherStatus.ACTIVE,
        },
      },
      {
        isOpeningBalance: true,
        createdAt: {
          gte: yearStart,
          ...(yearEnd ? { lte: yearEnd } : {}),
        },
      },
    ],
  };
}

async function loadFinancialYearBounds(db: DbClient, financialYearId: number) {
  const year = await db.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true },
  });
  if (!year) throw new AppError(404, 'Financial year not found');
  return {
    yearStart: startOfDay(year.startDate),
    yearEnd: year.endDate ? endOfDay(year.endDate) : null,
  };
}

function normalizeLabel(value: string) {
  return value.trim();
}

async function assertUniqueCategoryName(name: string, excludeId?: number) {
  const trimmed = normalizeLabel(name);
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await prisma.accountCategory.findFirst({
    where: {
      isActive: true,
      name: { equals: trimmed },
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new AppError(400, `Category "${existing.name}" already exists`);
  }
  return trimmed;
}

/**
 * Outstanding customer balances (receivables).
 * Ledger uses signed balance (debit − credit). Customer ASSET balances are typically positive.
 */
export function sumCustomerReceivables(
  accounts: { categoryName: string; balance: number }[],
): number {
  let total = 0;
  for (const account of accounts) {
    if (!isCustomersCategoryName(account.categoryName)) continue;
    total += Math.max(0, account.balance);
  }
  return total;
}

/**
 * Outstanding supplier balances (payables).
 * Supplier LIABILITY credit balances are negative in signed-ledger form.
 */
export function sumSupplierPayables(
  accounts: { categoryName: string; balance: number }[],
): number {
  let total = 0;
  for (const account of accounts) {
    if (!isSuppliersCategoryName(account.categoryName)) continue;
    total += Math.max(0, -account.balance);
  }
  return total;
}

async function assertUniqueAccountName(name: string) {
  const trimmed = normalizeLabel(name);
  if (!trimmed) throw new AppError(400, 'Account name is required');

  const existing = await prisma.account.findFirst({
    where: { name: { equals: trimmed } },
  });
  if (existing) {
    throw new AppError(400, `Account "${existing.name}" already exists`);
  }
  return trimmed;
}

async function assertUniqueAccountCode(code: string) {
  const trimmed = normalizeLabel(code);
  if (!trimmed) throw new AppError(400, 'Account code is required');

  const existing = await prisma.account.findFirst({
    where: { code: { equals: trimmed } },
  });
  if (existing) {
    throw new AppError(400, `Account code "${existing.code}" already exists`);
  }
  return trimmed;
}

function isSaleRevenueAccountName(name?: string | null) {
  return name?.trim().toLowerCase() === SALE_REVENUE_ACCOUNT_NAME.toLowerCase();
}

function isInventoryAccountName(name?: string | null) {
  return name?.trim().toLowerCase() === INVENTORY_ACCOUNT_NAME.toLowerCase();
}

function isSaleVoucher(voucher: {
  type?: VoucherType | null;
  creditAccount?: { name: string } | null;
  debitAccount?: { name: string } | null;
} | null) {
  if (!voucher || voucher.type !== VoucherType.JOURNAL) return false;
  return isSaleRevenueAccountName(voucher.creditAccount?.name) && !!voucher.debitAccount?.name;
}

function isPurchaseVoucher(voucher: {
  type?: VoucherType | null;
  creditAccount?: { name: string } | null;
  debitAccount?: { name: string } | null;
} | null) {
  if (!voucher || voucher.type !== VoucherType.JOURNAL) return false;
  return (
    isInventoryAccountName(voucher.debitAccount?.name)
    && !!voucher.creditAccount?.name
    && !isSaleRevenueAccountName(voucher.creditAccount?.name)
  );
}

function voucherTypeLabel(
  voucher: {
    type?: VoucherType | null;
    creditAccount?: { name: string } | null;
    debitAccount?: { name: string } | null;
  } | null,
  isReversal: boolean,
) {
  if (isSaleVoucher(voucher)) {
    return isReversal ? 'Sale (Reversal)' : 'Sale';
  }
  if (isPurchaseVoucher(voucher)) {
    return isReversal ? 'Purchase (Reversal)' : 'Purchase';
  }
  const type = voucher?.type;
  if (!type) return isReversal ? 'Journal (Reversal)' : 'Journal';
  const base =
    type === 'PAYMENT' ? 'Payment'
      : type === 'RECEIPT' ? 'Receipt'
        : type === 'KACHI' ? 'Kachi'
          : type === 'PURCHASE_MAAL' ? 'Purchase Maal'
          : type === 'SALE' ? 'Sale'
          : type === 'SALE_RETURN' ? 'Sale Return'
          : type === 'PURCHASE' ? 'Purchase'
          : type === 'PURCHASE_RETURN' ? 'Purchase Return'
          : type === 'EXCHANGE' ? 'Exchange'
          : type === 'CUSTOMER_PAYMENT' ? 'Customer Payment'
          : type === 'SUPPLIER_PAYMENT' ? 'Supplier Payment'
          : type === 'EXPENSE' ? 'Expense'
          : type === 'OTHER_INCOME' ? 'Other Income'
          : type === 'ADJUSTMENT' ? 'Adjustment'
          : 'Journal';
  return isReversal ? `${base} (Reversal)` : base;
}

function voucherDisplayNo(type: VoucherType | null | undefined, number: number | null | undefined) {
  return formatVoucherLabel(type, number);
}

/** Shared voucher label: number only (type shown separately). Kachi uses K-{n}. */
export function formatVoucherLabel(
  type: VoucherType | null | undefined,
  number: number | null | undefined,
): string {
  if (!number) return '0';
  if (type === 'KACHI') return `K-${number}`;
  if (type === 'PURCHASE_MAAL') return `PM-${number}`;
  return String(number);
}

export function formatPurchaseItemsDescription(
  items: { quantity: number; product?: { name: string } | null; part?: { name: string } | null }[],
): string {
  if (!items.length) return '';
  return items
    .map((item) => {
      const name = item.product?.name ?? item.part?.name ?? 'Item';
      return `${name} × ${item.quantity}`;
    })
    .join(', ');
}

async function loadPurchaseDescriptionsByRef(_refs: string[]) {
  return new Map<string, string>();
}

async function loadSaleDescriptionsByRef(_refs: string[]) {
  return new Map<string, string>();
}

function buildLedgerEntryDescription(
  e: { isOpeningBalance: boolean; notes?: string | null },
  voucher: {
    type?: VoucherType | null;
    description?: string | null;
    creditAccount?: { name: string } | null;
    debitAccount?: { name: string } | null;
  } | null,
  purchaseSummary?: string,
  saleSummary?: string,
): string {
  if (e.isOpeningBalance) return 'Opening Balance';
  if (!voucher?.creditAccount || !voucher?.debitAccount) {
    return e.notes?.trim() || voucher?.description?.trim() || '';
  }

  if (isSaleVoucher(voucher)) {
    const base = `From sale revenue to ${voucher.debitAccount.name}`;
    return saleSummary ? `${base} — ${saleSummary}` : base;
  }

  if (isPurchaseVoucher(voucher)) {
    const base = `From ${voucher.creditAccount.name} to inventory`;
    return purchaseSummary ? `${base} — ${purchaseSummary}` : base;
  }

  const auto = `From ${voucher.creditAccount.name} to ${voucher.debitAccount.name}`;
  const custom = voucher.description?.trim();
  return custom ? `${auto} — ${custom}` : auto;
}

/** Payment, Receipt, and Journal share one number sequence per financial year. */
const STANDARD_VOUCHER_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'JOURNAL'];

async function nextVoucherNumber(
  tx: Prisma.TransactionClient,
  financialYearId: number,
): Promise<number> {
  const { _max } = await tx.voucher.aggregate({
    where: { financialYearId, type: { in: STANDARD_VOUCHER_TYPES } },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

async function nextMultiLegVoucherNumber(
  tx: Prisma.TransactionClient,
  financialYearId: number,
  type: VoucherType,
): Promise<number> {
  const { _max } = await tx.voucher.aggregate({
    where: { financialYearId, type },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

/** Read-only preview of the next voucher number for the active financial year. */
export async function previewNextVoucherNumber(): Promise<{
  number: number;
  financialYearId: number;
}> {
  const financialYearId = await getActiveFinancialYearId(prisma);
  const number = await nextVoucherNumber(prisma, financialYearId);
  return { number, financialYearId };
}

function parseDateStart(value: string) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateEnd(value: string) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function entryDebitCredit(type: LedgerEntryType, amount: number) {
  if (type === LedgerEntryType.DEBIT) return { debit: amount, credit: 0 };
  return { debit: 0, credit: amount };
}

/** Reversal rows and cancelled vouchers are bookkeeping only — omit from reports. */
function isReportableLedgerEntry(e: {
  isReversal: boolean;
  voucher: { status: VoucherStatus } | null;
}) {
  if (e.isReversal) return false;
  if (e.voucher?.status === VoucherStatus.CANCELLED) return false;
  return true;
}

function reportBalanceFromEntries(
  entries: { type: LedgerEntryType; amount: number | Prisma.Decimal; isReversal: boolean; voucher: { status: VoucherStatus } | null }[],
) {
  return entries
    .filter(isReportableLedgerEntry)
    .reduce((sum, e) => {
      const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
      return sum + debit - credit;
    }, 0);
}

export async function listAccounts() {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { category: true, ledger: true },
    orderBy: { code: 'asc' },
  });

  return accounts.map(({ ledger, ...account }) => ({
    ...account,
    ledger: ledger
      ? { ...ledger, balance: Number(ledger.balance) }
      : null,
  }));
}

export async function ensureSaleRevenueAccount(tx: Prisma.TransactionClient) {
  let category = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INCOME_CATEGORY_NAME } },
  });
  if (!category) {
    category = await tx.accountCategory.create({ data: { name: INCOME_CATEGORY_NAME } });
  }

  const existing = await tx.account.findFirst({
    where: { isActive: true, categoryId: category.id,
      name: { equals: SALE_REVENUE_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });
  if (existing?.ledger) return existing;

  const account = await tx.account.create({
    data: { categoryId: category.id,
      name: SALE_REVENUE_ACCOUNT_NAME,
      code: await generateNextAccountCodeInTx(tx),
      type: AccountType.REVENUE,
    },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { ledger: true } });
}

export async function ensureServiceRevenueAccount(tx: Prisma.TransactionClient) {
  let category = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INCOME_CATEGORY_NAME } },
  });
  if (!category) {
    category = await tx.accountCategory.create({ data: { name: INCOME_CATEGORY_NAME } });
  }

  const existing = await tx.account.findFirst({
    where: { isActive: true, categoryId: category.id,
      name: { equals: SERVICE_REVENUE_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });
  if (existing?.ledger) return existing;

  const account = await tx.account.create({
    data: { categoryId: category.id,
      name: SERVICE_REVENUE_ACCOUNT_NAME,
      code: await generateNextAccountCodeInTx(tx),
      type: AccountType.REVENUE,
    },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { ledger: true } });
}

export const KACHI_MAAL_CATEGORY_NAMES = {
  INT_PURCHASE: 'Int. Purchase Party',
  EXT_PURCHASE: 'Ext. Purchase Party',
  SALE_PARTY: 'Sale Party',
  REVENUE: 'Revenue',
  SALE_FEE: 'Sale Fee',
  BARDANA: 'Bardana',
} as const;

export type KachiMaalSystemAccounts = {
  bori: { id: number; name: string };
  thela: { id: number; name: string };
  commission: { id: number; name: string };
  mazduri: { id: number; name: string };
  broker: { id: number; name: string };
  marketFee: { id: number; name: string };
  misc: { id: number; name: string };
};

/** One-time auto-creation of Kachi Maal fee/bardana categories and accounts. */
export async function ensureKachiMaalAccounts(
  tx: Prisma.TransactionClient,
): Promise<KachiMaalSystemAccounts> {
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE);
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE);
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY);
  const revenue = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.REVENUE);
  const saleFee = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_FEE);
  const bardana = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.BARDANA);

  const bori = await ensureDefaultAccountInTx(tx, bardana.id, 'Bori', AccountType.ASSET, 'BD-BORI');
  const thela = await ensureDefaultAccountInTx(tx, bardana.id, 'Thela', AccountType.ASSET, 'BD-THELA');
  const commission = await ensureDefaultAccountInTx(tx, revenue.id, 'Commission', AccountType.REVENUE, 'REV-COMM');
  const mazduri = await ensureDefaultAccountInTx(tx, saleFee.id, 'Mazduri', AccountType.EXPENSE, 'SF-MAZ');
  const broker = await ensureDefaultAccountInTx(tx, saleFee.id, 'Broker', AccountType.EXPENSE, 'SF-BRK');
  const marketFee = await ensureDefaultAccountInTx(tx, saleFee.id, 'Market Fee', AccountType.EXPENSE, 'SF-MKT');
  const misc = await ensureDefaultAccountInTx(tx, saleFee.id, 'Misc', AccountType.EXPENSE, 'SF-MISC');

  return {
    bori: { id: bori.id, name: bori.name },
    thela: { id: thela.id, name: thela.name },
    commission: { id: commission.id, name: commission.name },
    mazduri: { id: mazduri.id, name: mazduri.name },
    broker: { id: broker.id, name: broker.name },
    marketFee: { id: marketFee.id, name: marketFee.name },
    misc: { id: misc.id, name: misc.name },
  };
}

export async function ensureInventoryAccount(tx: Prisma.TransactionClient) {
  const category = await ensureInventoryCategoryInTx(tx);

  const allNamed = await tx.account.findMany({
    where: { isActive: true, name: { equals: INVENTORY_ACCOUNT_NAME },
    },
    include: { ledger: true },
    orderBy: { id: 'asc' },
  });

  let canonical =
    allNamed.find((a) => a.categoryId === category.id && a.ledger) ??
    allNamed.find((a) => a.categoryId === category.id) ??
    allNamed.find((a) => a.ledger) ??
    allNamed[0] ??
    null;

  if (canonical && canonical.categoryId !== category.id) {
    canonical = await tx.account.update({
      where: { id: canonical.id },
      data: { categoryId: category.id, type: AccountType.ASSET },
      include: { ledger: true },
    });
  }

  if (canonical && !canonical.ledger) {
    await tx.ledger.create({ data: { accountId: canonical.id, balance: 0 } });
    canonical = await tx.account.findUniqueOrThrow({
      where: { id: canonical.id },
      include: { ledger: true },
    });
  }

  if (!canonical) {
    const account = await tx.account.create({
      data: { categoryId: category.id,
        name: INVENTORY_ACCOUNT_NAME,
        code: await generateNextAccountCodeInTx(tx),
        type: AccountType.ASSET,
      },
    });
    await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
    return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { ledger: true } });
  }

  return canonical;
}

async function mergeInventoryAccountIntoCanonical(
  tx: Prisma.TransactionClient,
  canonical: { id: number; ledger: { id: number } | null },
  duplicate: { id: number; ledger: { id: number; balance: unknown } | null },
) {
  if (duplicate.id === canonical.id) return;

  if (duplicate.ledger) {
    await tx.ledgerEntry.updateMany({
      where: { ledgerId: duplicate.ledger.id },
      data: { ledgerId: canonical.ledger!.id },
    });

    await tx.voucher.updateMany({
      where: { debitAccountId: duplicate.id },
      data: { debitAccountId: canonical.id },
    });
    await tx.voucher.updateMany({
      where: { creditAccountId: duplicate.id },
      data: { creditAccountId: canonical.id },
    });

    const entries = await tx.ledgerEntry.findMany({
      where: { ledgerId: canonical.ledger!.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    let balance = 0;
    for (const entry of entries) {
      balance +=
        entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : -Number(entry.amount);
      await tx.ledgerEntry.update({ where: { id: entry.id }, data: { balance } });
    }

    await tx.ledger.update({
      where: { id: canonical.ledger!.id },
      data: { balance },
    });

    await tx.ledger.update({
      where: { id: duplicate.ledger.id },
      data: { balance: 0 },
    });
  }

  await tx.account.update({
    where: { id: duplicate.id },
    data: { isActive: false },
  });
}

/** Keep a single Inventory account under the Inventory category; merge/remove duplicates. */
export async function consolidateDuplicateInventoryAccounts(
  tx: Prisma.TransactionClient,
  ) {
  const canonical = await ensureInventoryAccount(tx);

  const duplicates = await tx.account.findMany({
    where: { isActive: true,
      id: { not: canonical.id },
      name: { equals: INVENTORY_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });

  for (const dup of duplicates) {
    await mergeInventoryAccountIntoCanonical(tx, canonical, dup);
  }

  return canonical;
}

async function ensureCategoryInTx(tx: Prisma.TransactionClient, name: string) {
  const existing = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: name } },
  });
  if (existing) return existing;
  return tx.accountCategory.create({ data: { name } });
}

async function ensureDefaultAccountInTx(
  tx: Prisma.TransactionClient,
  categoryId: number,
  accountName: string,
  type: AccountType,
  preferredCode?: string,
) {
  const existing = await tx.account.findFirst({
    where: { isActive: true,
      name: { equals: accountName },
    },
    include: { ledger: true },
  });

  if (existing) {
    if (!existing.ledger) {
      await tx.ledger.create({ data: { accountId: existing.id, balance: 0 } });
    }
    if (existing.categoryId !== categoryId) {
      await tx.account.update({
        where: { id: existing.id },
        data: { categoryId, type },
      });
    }
    return existing;
  }

  let code = preferredCode;
  if (code) {
    const codeTaken = await tx.account.findFirst({ where: { code } });
    if (codeTaken) code = undefined;
  }
  if (!code) code = await generateNextAccountCodeInTx(tx);

  const account = await tx.account.create({
    data: { categoryId, name: accountName, code, type },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return account;
}

/**
 * Idempotent ensure for a named account under a named category.
 * Reuses existing account by name when present; creates category + ledger as needed.
 */
export async function ensureSystemAccount(
  tx: Prisma.TransactionClient,
  categoryName: string,
  accountName: string,
  type: AccountType,
  preferredCode?: string,
) {
  const category = await ensureCategoryInTx(tx, categoryName);
  return ensureDefaultAccountInTx(tx, category.id, accountName, type, preferredCode);
}

/**
 * Bootstrap retail chart accounts used by future POS/purchase/return posting.
 * Idempotent — safe to call repeatedly. Does not create per-customer/supplier ledgers.
 */
export async function ensureRetailSystemAccounts(tx: Prisma.TransactionClient) {
  await ensureCustomersCategoryInTx(tx);
  await ensureSuppliersCategoryInTx(tx);

  const saleRevenue = await ensureSaleRevenueAccount(tx);
  const inventory = await ensureInventoryAccount(tx);
  const cashCategory = await ensureCategoryInTx(tx, 'Cash');
  const cashInHand = await ensureDefaultAccountInTx(
    tx,
    cashCategory.id,
    CASH_IN_HAND_ACCOUNT_NAME,
    AccountType.ASSET,
    '1',
  );
  const cogs = await ensureSystemAccount(
    tx,
    EXPENSES_CATEGORY_NAME,
    COGS_ACCOUNT_NAME,
    AccountType.EXPENSE,
    'COGS',
  );
  const salesReturn = await ensureSystemAccount(
    tx,
    INCOME_CATEGORY_NAME,
    SALES_RETURN_ACCOUNT_NAME,
    AccountType.REVENUE,
    'SRET',
  );
  const purchaseReturn = await ensureSystemAccount(
    tx,
    EXPENSES_CATEGORY_NAME,
    PURCHASE_RETURN_ACCOUNT_NAME,
    AccountType.EXPENSE,
    'PRET',
  );
  const damagedLoss = await ensureSystemAccount(
    tx,
    EXPENSES_CATEGORY_NAME,
    DAMAGED_STOCK_LOSS_ACCOUNT_NAME,
    AccountType.EXPENSE,
    'DMG',
  );

  return {
    saleRevenue,
    inventory,
    cashInHand,
    cogs,
    salesReturn,
    purchaseReturn,
    damagedLoss,
  };
}

async function ensureCustomersCategoryInTx(tx: Prisma.TransactionClient) {
  return ensureCategoryInTx(tx, CUSTOMERS_CATEGORY_NAME);
}

async function ensureSuppliersCategoryInTx(tx: Prisma.TransactionClient) {
  return ensureCategoryInTx(tx, SUPPLIERS_CATEGORY_NAME);
}

async function consolidateDuplicateInventoryCategories(tx: Prisma.TransactionClient) {
  const categories = await tx.accountCategory.findMany({
    where: { isActive: true,
      name: { equals: INVENTORY_CATEGORY_NAME },
    },
    include: { accounts: { where: { isActive: true } } },
    orderBy: { id: 'asc' },
  });

  if (categories.length <= 1) return categories[0] ?? null;

  const [canonical, ...duplicates] = categories;
  for (const dup of duplicates) {
    for (const account of dup.accounts) {
      await tx.account.update({
        where: { id: account.id },
        data: { categoryId: canonical.id, type: AccountType.ASSET },
      });
    }
    await tx.accountCategory.update({ where: { id: dup.id }, data: { isActive: false } });
  }
  return canonical;
}

/** Create default chart-of-accounts categories and core accounts for a branch. Idempotent. */
export async function bootstrapChartOfAccounts() {
  await prisma.$transaction(async (tx) => {
    for (const name of DEFAULT_CATEGORY_NAMES) {
      await ensureCategoryInTx(tx, name);
    }

    const cashCategory = await ensureCategoryInTx(tx, 'Cash');
    await ensureDefaultAccountInTx(
      tx,
      cashCategory.id,
      CASH_IN_HAND_ACCOUNT_NAME,
      AccountType.ASSET,
      '1',
    );
  });
}

async function ensureInventoryCategoryInTx(tx: Prisma.TransactionClient) {
  const existing = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INVENTORY_CATEGORY_NAME } },
  });
  if (existing) return existing;
  return tx.accountCategory.create({ data: { name: INVENTORY_CATEGORY_NAME } });
}

export async function createVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    type: VoucherType;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: Date | string;
    description?: string;
    reference: string;
    createdById: number;
  },
) {
  const trimmedReference = data.reference.trim();
  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }
  const { financialYearId } = await validateVoucherCreate(tx, {
    type: data.type,
    debitAccountId: data.debitAccountId,
    creditAccountId: data.creditAccountId,
    amount: data.amount,
    date: voucherDate,
    description: data.description,
    reference: trimmedReference,
  });

  const number = await nextVoucherNumber(tx, financialYearId);

  const voucher = await tx.voucher.create({
    data: {
      type: data.type,
      number,
      date: voucherDate,
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId,
      amount: data.amount,
      description: data.description,
      reference: trimmedReference,
      createdById: data.createdById,
      financialYearId,
      status: VoucherStatus.ACTIVE,
    },
  });

  await postVoucherLedgerEntries(
    tx,
    voucher.id,
    data.debitAccountId,
    data.creditAccountId,
    data.amount,
    data.description,
    financialYearId,
  );

  await assertTrialBalanceInDev(tx);

  return voucher;
}

export async function createVoucher(data: {
  type: VoucherType;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  date: Date | string;
  description?: string;
  reference: string;
  createdById: number;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const voucher = await createVoucherInTx(tx, data);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
  });
}

async function postVoucherLedgerEntries(
  tx: Prisma.TransactionClient,
  voucherId: number,
  debitAccountId: number,
  creditAccountId: number,
  amount: number,
  notes: string | null | undefined,
  financialYearId: number,
) {
  const debitLedger = await tx.ledger.findUniqueOrThrow({ where: { accountId: debitAccountId } });
  const creditLedger = await tx.ledger.findUniqueOrThrow({ where: { accountId: creditAccountId } });

  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerId: debitLedger.id,
        voucherId,
        type: LedgerEntryType.DEBIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
      {
        ledgerId: creditLedger.id,
        voucherId,
        type: LedgerEntryType.CREDIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
    ],
  });

  await recomputeLedgerRunningBalancesInTx(tx, debitLedger.id, financialYearId);
  await recomputeLedgerRunningBalancesInTx(tx, creditLedger.id, financialYearId);
}

export type VoucherLeg = {
  accountId: number;
  type: LedgerEntryType;
  amount: number;
  description?: string;
};

async function postMultiLegVoucherEntries(
  tx: Prisma.TransactionClient,
  voucherId: number,
  legs: VoucherLeg[],
  financialYearId: number,
) {
  const ledgerByAccountId = new Map<number, number>();

  for (const leg of legs) {
    let ledgerId = ledgerByAccountId.get(leg.accountId);
    if (ledgerId == null) {
      const ledger = await tx.ledger.findUniqueOrThrow({ where: { accountId: leg.accountId } });
      ledgerId = ledger.id;
      ledgerByAccountId.set(leg.accountId, ledgerId);
    }

    await tx.ledgerEntry.create({
      data: {
        ledgerId,
        voucherId,
        type: leg.type,
        amount: leg.amount,
        balance: 0,
        notes: leg.description ?? undefined,
        isReversal: false,
      },
    });
  }

  for (const ledgerId of ledgerByAccountId.values()) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, financialYearId);
  }
}

export async function createMultiLegVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    type: VoucherType;
    legs: VoucherLeg[];
    amount: number;
    date: Date | string;
    description: string;
    /** Legacy reference string; if omitted and sourceRef is set, sourceRef is copied here. */
    reference?: string;
    /** Business document kind, e.g. SALE / PURCHASE — required with sourceRef for idempotent posting. */
    sourceType?: string;
    /** Business document key within sourceType. */
    sourceRef?: string;
    createdById: number;
  },
) {
  if (!isMultiLegVoucherType(data.type)) {
    throw new AppError(400, `Voucher type ${data.type} is not a multi-leg posting type`);
  }

  if (data.legs.length < 2) {
    throw new AppError(400, 'Multi-leg voucher requires at least two ledger legs');
  }

  for (const leg of data.legs) {
    if (!(leg.amount > 0)) {
      throw new AppError(400, 'Each voucher leg amount must be greater than zero');
    }
  }

  const totalDebits = roundMoney(
    data.legs
      .filter((leg) => leg.type === LedgerEntryType.DEBIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );
  const totalCredits = roundMoney(
    data.legs
      .filter((leg) => leg.type === LedgerEntryType.CREDIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(400, 'Multi-leg voucher debits and credits do not balance');
  }

  const sourceType = data.sourceType?.trim() || null;
  const sourceRef = data.sourceRef?.trim() || null;
  if ((sourceType && !sourceRef) || (!sourceType && sourceRef)) {
    throw new AppError(400, 'sourceType and sourceRef must be provided together');
  }

  const trimmedReference = (data.reference?.trim() || sourceRef || '').trim();
  if (!trimmedReference) {
    throw new AppError(400, 'Reference is required');
  }

  if (sourceType && sourceRef) {
    const existing = await tx.voucher.findFirst({
      where: {
        sourceType,
        sourceRef,
        type: data.type,
        status: VoucherStatus.ACTIVE,
      },
      select: { id: true, number: true },
    });
    if (existing) {
      throw new AppError(
        409,
        `Duplicate posting blocked: active ${data.type} already exists for ${sourceType}/${sourceRef}`,
      );
    }
  }

  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }

  const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, voucherDate);
  const number = await nextMultiLegVoucherNumber(tx, financialYearId, data.type);

  const voucher = await tx.voucher.create({
    data: {
      type: data.type,
      number,
      date: voucherDate,
      debitAccountId: null,
      creditAccountId: null,
      amount: data.amount,
      description: data.description,
      reference: trimmedReference,
      sourceType,
      sourceRef,
      createdById: data.createdById,
      financialYearId,
      status: VoucherStatus.ACTIVE,
    },
  });

  await postMultiLegVoucherEntries(tx, voucher.id, data.legs, financialYearId);
  await assertTrialBalanceInDev(tx);

  return voucher;
}

export async function createKachiVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    legs: VoucherLeg[];
    amount: number;
    date: Date | string;
    description: string;
    reference: string;
    createdById: number;
  },
) {
  return createMultiLegVoucherInTx(tx, { ...data, type: VoucherType.KACHI });
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function reverseVoucherLedgerEntries(
  tx: Prisma.TransactionClient,
  voucher: { id: number },
  notes: string,
) {
  const entries = await tx.ledgerEntry.findMany({
    where: { voucherId: voucher.id, isReversal: false },
    orderBy: { id: 'asc' },
  });

  for (const entry of entries) {
    await tx.ledgerEntry.create({
      data: {
        ledgerId: entry.ledgerId,
        voucherId: voucher.id,
        type: entry.type === LedgerEntryType.DEBIT ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT,
        amount: entry.amount,
        balance: 0,
        notes,
        isReversal: true,
      },
    });
  }
}

const voucherInclude = {
  debitAccount: true,
  creditAccount: true,
  ledgerEntries: {
    where: { isReversal: false },
    orderBy: { id: 'asc' as const },
    include: {
      ledger: {
        include: {
          account: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  createdBy: { select: { id: true, displayName: true, username: true } },
  modifiedBy: { select: { id: true, displayName: true, username: true } },
  deletedBy: { select: { id: true, displayName: true, username: true } },
} as const;

function voucherDashboardAccountLabel(voucher: {
  type: VoucherType;
  description?: string | null;
  debitAccount?: { name: string } | null;
  creditAccount?: { name: string } | null;
}) {
  if (voucher.type === 'KACHI') {
    return voucher.description?.trim() || 'Kachi Maal';
  }
  if (voucher.type === 'PURCHASE_MAAL') {
    return voucher.description?.trim() || 'Purchase Maal';
  }
  if (voucher.type === 'RECEIPT') return voucher.creditAccount?.name ?? '—';
  if (voucher.type === 'PAYMENT') return voucher.debitAccount?.name ?? '—';
  const debit = voucher.debitAccount?.name ?? '—';
  const credit = voucher.creditAccount?.name ?? '—';
  return `${debit} → ${credit}`;
}

export async function getDashboardSummary() {
  let financialYearId: number | undefined;
  try {
    financialYearId = await getActiveFinancialYearId(prisma);
  } catch {
    financialYearId = undefined;
  }

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { category: true, ledger: true },
  });

  let cashBalance = 0;
  const categoryBalances: { categoryName: string; balance: number }[] = [];
  for (const account of accounts) {
    if (!account.category || !account.ledger) continue;
    const balance = Number(account.ledger.balance);
    if (isBankOrCashCategory(account.category.name)) {
      cashBalance += balance;
    }
    categoryBalances.push({ categoryName: account.category.name, balance });
  }

  const receivables = sumCustomerReceivables(categoryBalances);
  const payables = sumSupplierPayables(categoryBalances);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [vouchersToday, recentRows] = financialYearId
    ? await Promise.all([
        prisma.voucher.count({
          where: {
            financialYearId,
            date: { gte: todayStart, lte: todayEnd },
          },
        }),
        prisma.voucher.findMany({
          where: { financialYearId },
          include: voucherInclude,
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
          take: 10,
        }),
      ])
    : [0, []];

  return {
    cashBalance,
    receivables,
    payables,
    vouchersToday,
    recentVouchers: recentRows.map((v) => ({
      id: v.id,
      number: v.number,
      type: v.type,
      amount: Number(v.amount),
      date: v.date,
      status: v.status,
      accountLabel: voucherDashboardAccountLabel(v),
    })),
  };
}

async function batchOpeningBalanceSnapshots(
  db: DbClient,
  accountIds: number[],
  financialYearId: number,
): Promise<Map<number, number>> {
  const balances = new Map<number, number>();
  for (const accountId of accountIds) {
    balances.set(accountId, 0);
  }
  if (accountIds.length === 0) return balances;

  const currentYear = await db.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!currentYear) return balances;

  const priorYear = await db.financialYear.findFirst({
    where: { startDate: { lt: currentYear.startDate } },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });
  if (!priorYear) return balances;

  const snapshots = await db.financialYearClosingBalance.findMany({
    where: {
      financialYearId: priorYear.id,
      accountId: { in: accountIds },
    },
  });

  for (const snapshot of snapshots) {
    balances.set(snapshot.accountId, Number(snapshot.balance));
  }

  return balances;
}

export async function listVouchers(filters?: {
  fromDate?: string;
  toDate?: string;
  type?: VoucherType;
}) {
  let financialYearId: number | undefined;
  try {
    financialYearId = await getActiveFinancialYearId(prisma);
  } catch {
    financialYearId = undefined;
  }

  const where: Prisma.VoucherWhereInput = {
    ...(financialYearId != null && { financialYearId }),
  };

  if (filters?.fromDate || filters?.toDate) {
    where.date = {};
    if (filters.fromDate) {
      where.date.gte = parseDateStart(filters.fromDate);
    }
    if (filters.toDate) {
      where.date.lte = parseDateEnd(filters.toDate);
    }
  }

  if (filters?.type) {
    where.type = filters.type;
  }

  return prisma.voucher.findMany({
    where,
    include: voucherInclude,
    orderBy: [{ date: 'desc' }, { number: 'desc' }],
  });
}

export async function updateVoucherAmount(
  voucherId: number,
  newAmount: number,
  userId: number,
) {
  if (newAmount <= 0) {
    throw new AppError(400, 'Amount must be greater than zero');
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const voucher = await tx.voucher.findFirst({
      where: { id: voucherId },
    });
    if (!voucher) throw new AppError(404, 'Voucher not found');
    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new AppError(400, 'Cannot update amount on a cancelled voucher');
    }
    if (voucher.type === 'KACHI' || voucher.type === 'PURCHASE_MAAL') {
      throw new AppError(400, 'Invoice voucher amounts cannot be edited');
    }
    await assertActiveFinancialYear(tx, voucher.financialYearId);

    const oldAmount = Number(voucher.amount);
    const delta = newAmount - oldAmount;
    if (Math.abs(delta) < 0.005) {
      return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
    }

    const entries = await tx.ledgerEntry.findMany({
      where: { voucherId: voucher.id, isReversal: false },
      orderBy: { id: 'asc' },
    });

    if (entries.length !== 2) {
      throw new AppError(400, 'Voucher ledger entries are invalid for amount update');
    }

    const debitEntry = entries.find((e) => e.type === LedgerEntryType.DEBIT);
    const creditEntry = entries.find((e) => e.type === LedgerEntryType.CREDIT);
    if (!debitEntry || !creditEntry) {
      throw new AppError(400, 'Voucher ledger entries are invalid for amount update');
    }

    await tx.ledgerEntry.update({
      where: { id: debitEntry.id },
      data: { amount: newAmount },
    });
    await tx.ledgerEntry.update({
      where: { id: creditEntry.id },
      data: { amount: newAmount },
    });

    await recomputeLedgerRunningBalancesInTx(tx, debitEntry.ledgerId, voucher.financialYearId!);
    await recomputeLedgerRunningBalancesInTx(tx, creditEntry.ledgerId, voucher.financialYearId!);

    await assertTrialBalanceInDev(tx);

    return tx.voucher.update({
      where: { id: voucher.id },
      data: { amount: newAmount, modifiedById: userId },
      include: voucherInclude,
    });
  });
}

export async function cancelVoucher(voucherId: number, userId: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return cancelVoucherInTx(tx, voucherId, userId);
  });
}

export async function cancelVoucherInTx(
  tx: Prisma.TransactionClient,
  voucherId: number,
  userId: number,
) {
  const voucher = await tx.voucher.findFirst({
    where: { id: voucherId },
  });
  if (!voucher) throw new AppError(404, 'Voucher not found');
  if (voucher.status === VoucherStatus.CANCELLED) {
    throw new AppError(400, 'Voucher is already cancelled');
  }
  await assertActiveFinancialYear(tx, voucher.financialYearId);

  await reverseVoucherLedgerEntries(
    tx,
    voucher,
    `Reversal — cancelled voucher #${formatVoucherLabel(voucher.type, voucher.number)}`,
  );

  const now = new Date();
  const updated = await tx.voucher.update({
    where: { id: voucher.id },
    data: {
      status: VoucherStatus.CANCELLED,
      deletedById: userId,
      deletedAt: now,
      modifiedById: userId,
    },
    include: voucherInclude,
  });

  const affectedEntries = await tx.ledgerEntry.findMany({
    where: { voucherId: voucher.id },
    select: { ledgerId: true },
  });
  const ledgerIds = [...new Set(affectedEntries.map((entry) => entry.ledgerId))];
  for (const ledgerId of ledgerIds) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, voucher.financialYearId!);
  }

  await assertTrialBalanceInDev(tx);

  return updated;
}

export async function cancelActiveVouchersByReferenceInTx(
  tx: Prisma.TransactionClient,
  reference: string,
  userId: number,
) {
  const trimmed = reference.trim();
  if (!trimmed) return;

  const vouchers = await tx.voucher.findMany({
    where: {
      status: VoucherStatus.ACTIVE,
      OR: [{ reference: trimmed }, { sourceRef: trimmed }],
    },
    orderBy: { id: 'asc' },
  });

  for (const voucher of vouchers) {
    await cancelVoucherInTx(tx, voucher.id, userId);
  }
}

/**
 * Cancel all ACTIVE vouchers linked to one business posting group.
 * Prefer this over reference-only cancel for retail modules.
 */
export async function cancelActiveVouchersBySourceInTx(
  tx: Prisma.TransactionClient,
  sourceType: string,
  sourceRef: string,
  userId: number,
) {
  const type = sourceType.trim();
  const ref = sourceRef.trim();
  if (!type || !ref) {
    throw new AppError(400, 'sourceType and sourceRef are required to cancel by source');
  }

  const vouchers = await tx.voucher.findMany({
    where: {
      status: VoucherStatus.ACTIVE,
      sourceType: type,
      sourceRef: ref,
    },
    orderBy: { id: 'asc' },
  });

  for (const voucher of vouchers) {
    await cancelVoucherInTx(tx, voucher.id, userId);
  }

  return vouchers.length;
}

/** @deprecated Use cancelVoucher — kept for route compatibility */
export async function deleteVoucher(voucherId: number, userId: number) {
  return cancelVoucher( voucherId, userId);
}

export async function getAccountBalancesAsOf(params: {
  date: string;
  categoryId?: number;
  side?: 'debit' | 'credit' | 'both';
}) {
  const side = params.side ?? 'both';
  const asOf = parseDateEnd(params.date);
  const financialYearId = await getActiveFinancialYearId(prisma);
  const { yearStart, yearEnd } = await loadFinancialYearBounds(prisma, financialYearId);

  const accounts = await prisma.account.findMany({
    where: {
      isActive: true,
      ...(params.categoryId != null ? { categoryId: params.categoryId } : {}),
    },
    include: { category: true, ledger: true },
    orderBy: [{ category: { name: 'asc' } }, { code: 'asc' }],
  });

  const accountIds = accounts.map((a) => a.id);
  const openingByAccount = await batchOpeningBalanceSnapshots(prisma, accountIds, financialYearId);

  const ledgerIds = accounts
    .map((a) => a.ledger?.id)
    .filter((id): id is number => id != null);

  const allEntries = ledgerIds.length
    ? await prisma.ledgerEntry.findMany({
        where: {
          ledgerId: { in: ledgerIds },
          isReversal: false,
          OR: [
            {
              voucher: {
                financialYearId,
                status: VoucherStatus.ACTIVE,
              },
            },
            {
              isOpeningBalance: true,
              createdAt: {
                gte: yearStart,
                ...(yearEnd ? { lte: yearEnd } : {}),
              },
            },
          ],
        },
        include: {
          voucher: { select: { date: true, status: true, number: true } },
        },
      })
    : [];

  const entriesByLedger = new Map<number, typeof allEntries>();
  for (const entry of allEntries) {
    const list = entriesByLedger.get(entry.ledgerId) ?? [];
    list.push(entry);
    entriesByLedger.set(entry.ledgerId, list);
  }

  type BalanceRow = {
    accountId: number;
    accountCode: string;
    accountName: string;
    categoryId: number;
    categoryName: string;
    balance: number;
    debit: number;
    credit: number;
  };

  const rows: BalanceRow[] = [];

  for (const account of accounts) {
    if (!account.ledger) continue;

    const baseOpening = openingByAccount.get(account.id) ?? 0;
    const entries = entriesByLedger.get(account.ledger.id) ?? [];
    entries.sort(compareLedgerEntries);

    let running = baseOpening;
    for (const entry of entries) {
      const at = startOfDay(entryEffectiveDate(entry));
      if (at > asOf) continue;
      const { debit, credit } = entryDebitCredit(entry.type, Number(entry.amount));
      running += debit - credit;
    }

    const { debit, credit } = trialBalanceFromSignedBalance(running);
    if (side === 'debit' && debit <= 0) continue;
    if (side === 'credit' && credit <= 0) continue;

    rows.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      categoryId: account.categoryId,
      categoryName: account.category?.name ?? '',
      balance: running,
      debit,
      credit,
    });
  }

  const groupsMap = new Map<number, { categoryId: number; categoryName: string; accounts: BalanceRow[] }>();
  for (const row of rows) {
    const existing = groupsMap.get(row.categoryId);
    if (existing) {
      existing.accounts.push(row);
    } else {
      groupsMap.set(row.categoryId, {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        accounts: [row],
      });
    }
  }

  const groups = Array.from(groupsMap.values());
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

  return {
    date: params.date,
    side,
    categoryId: params.categoryId ?? null,
    accounts: rows,
    groups,
    totalDebit,
    totalCredit,
  };
}

export async function getTrialBalance() {
  const ledgers = await prisma.ledger.findMany({
    where: {},
    include: { account: true },
    orderBy: [{ account: { type: 'asc' } }, { account: { code: 'asc' } }],
  });

  const accounts = ledgers.map((l: (typeof ledgers)[number]) => {
    const balance = Number(l.balance);
    const { debit, credit } = trialBalanceFromSignedBalance(balance);
    return {
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      accountType: l.account.type,
      balance,
      debit,
      credit,
    };
  });

  const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

  return {
    accounts,
    totalDebit,
    totalCredit,
    isBalanced: isTrialBalanceBalanced(totalDebit, totalCredit),
  };
}

export async function getLedgerEntries(
  accountId: number,
  fromDate?: string,
  toDate?: string,
) {
  const financialYearId = await getActiveFinancialYearId(prisma);
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate);
}

export async function getLedgerEntriesForYear(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
) {
  const year = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!year) throw new AppError(404, 'Financial year not found');
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate);
}

async function buildLedgerEntriesReport(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
) {
  let ledger = await prisma.ledger.findFirst({
    where: { accountId },
    include: { account: true },
  });

  if (!ledger) {
    const account = await prisma.account.findFirst({
      where: { id: accountId, isActive: true },
    });
    if (!account) throw new AppError(404, 'Ledger not found');
    await prisma.ledger.create({ data: { accountId, balance: 0 } });
    ledger = await prisma.ledger.findFirst({
      where: { accountId },
      include: { account: true },
    });
  }

  if (!ledger) throw new AppError(404, 'Ledger not found');

  const { balance: baseOpening, priorYearLabel } = await getOpeningBalanceSnapshot(
    prisma,
    accountId,
    financialYearId,
  );

  const currentYear = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true },
  });

  const yearStart = currentYear ? startOfDay(currentYear.startDate) : startOfDay(new Date());
  const yearEnd = currentYear?.endDate ? endOfDay(currentYear.endDate) : null;

  const yearEntries = await prisma.ledgerEntry.findMany({
    where: ledgerEntriesForYearWhere(ledger.id, financialYearId, yearStart, yearEnd),
    orderBy: [{ id: 'asc' }],
    include: {
      voucher: { include: { debitAccount: true, creditAccount: true } },
    },
  });

  yearEntries.sort(compareLedgerEntries);

  const from = fromDate ? parseDateStart(fromDate) : null;
  const to = toDate ? parseDateEnd(toDate) : null;

  let periodOpening = baseOpening;
  const periodEntries: typeof yearEntries = [];

  for (const e of yearEntries) {
    const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
    const at = startOfDay(entryEffectiveDate(e));

    if (from && at < from) {
      periodOpening += debit - credit;
      continue;
    }
    if (to && at > to) continue;

    periodEntries.push(e);
  }

  const purchaseRefs = periodEntries
    .map((e) => e.voucher)
    .filter((v): v is NonNullable<typeof v> => Boolean(v && isPurchaseVoucher(v) && v.reference?.trim()))
    .map((v) => v.reference!.trim());
  const saleRefs = periodEntries
    .map((e) => e.voucher)
    .filter((v): v is NonNullable<typeof v> => Boolean(v && isSaleVoucher(v) && v.reference?.trim()))
    .map((v) => v.reference!.trim());
  const [purchaseDescriptions, saleDescriptions] = await Promise.all([
    loadPurchaseDescriptionsByRef( purchaseRefs),
    loadSaleDescriptionsByRef( saleRefs),
  ]);

  type LedgerRow = {
    date: string;
    voucherNo: string;
    ref: string | null;
    type: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    isOpeningRow?: boolean;
  };

  const rows: LedgerRow[] = [];
  let running = from ? periodOpening : baseOpening;
  let totalDebit = 0;
  let totalCredit = 0;

  const openingLabel = priorYearLabel
    ? `Closing Balance of ${priorYearLabel}`
    : 'Opening Balance';

  if (priorYearLabel || from) {
    rows.push({
      date: from
        ? fromDate!
        : (currentYear?.startDate.toISOString() ?? new Date().toISOString()),
      voucherNo: '0',
      ref: null,
      type: openingLabel,
      description: openingLabel,
      debit: 0,
      credit: 0,
      balance: from ? periodOpening : baseOpening,
      isOpeningRow: true,
    });
  }

  for (const e of periodEntries) {
    const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
    running += debit - credit;
    totalDebit += debit;
    totalCredit += credit;

    const voucher = e.voucher;
    const purchaseSummary = voucher?.reference?.trim()
      ? purchaseDescriptions.get(voucher.reference.trim())
      : undefined;
    const saleSummary = voucher?.reference?.trim()
      ? saleDescriptions.get(voucher.reference.trim())
      : undefined;
    rows.push({
      date: entryEffectiveDate(e).toISOString(),
      voucherNo: e.isOpeningBalance
        ? '0'
        : voucherDisplayNo(voucher?.type ?? null, voucher?.number),
      ref: voucher?.reference ?? null,
      type: e.isOpeningBalance
        ? 'Opening Balance'
        : voucherTypeLabel(voucher ?? null, false),
      description: buildLedgerEntryDescription(e, voucher ?? null, purchaseSummary, saleSummary),
      debit,
      credit,
      balance: running,
    });
  }

  const closingBalance = from || to
    ? running
    : baseOpening + yearEntries.reduce((sum, e) => {
        const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
        return sum + debit - credit;
      }, 0);

  return {
    account: ledger.account,
    balance: closingBalance,
    rows,
    summary: {
      periodOpening: from ? periodOpening : baseOpening,
      totalDebit,
      totalCredit,
      closingBalance,
    },
  };
}

export async function approveTrialBalance(data: {
  period: string;
  approvedById: number;
  notes?: string;
}) {
  const snapshot = await getTrialBalance();
  return prisma.trialBalanceApproval.upsert({
    where: { period: data.period },
    create: {
      period: data.period,
      approvedById: data.approvedById,
      notes: data.notes,
      snapshot,
    },
    update: {
      approvedById: data.approvedById,
      notes: data.notes,
      snapshot,
    },
    include: { approvedBy: { select: { id: true, displayName: true, username: true } } },
  });
}

export async function listTrialBalanceApprovals() {
  return prisma.trialBalanceApproval.findMany({
    where: {},
    include: { approvedBy: { select: { id: true, displayName: true, username: true } } },
    orderBy: { period: 'desc' },
  });
}

export async function updateAccount(
  id: number,
  data: Partial<{ name: string; code: string; isActive: boolean }>
) {
  const account = await prisma.account.findFirst({ where: { id } });
  if (!account) throw new AppError(404, 'Account not found');
  return prisma.account.update({ where: { id }, data });
}

/** Soft-delete: hides account from lists; ledger entries are kept until vouchers are cancelled. */
export async function softDeleteAccount(id: number) {
  const account = await prisma.account.findFirst({ where: { id, isActive: true } });
  if (!account) throw new AppError(404, 'Account not found');
  if (isInventoryAccountName(account.name)) {
    throw new AppError(400, 'The Inventory account cannot be deleted');
  }
  await assertNotMaalKhataLinkedAccount(id);
  return prisma.account.update({
    where: { id },
    data: { isActive: false },
    include: { category: true, ledger: true },
  });
}
