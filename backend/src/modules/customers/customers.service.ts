import { AccountType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { createAccount, ensureCustomersCategory } from '../accounting/accounting.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function serializeCustomer(
  row: {
    id: number;
    name: string;
    phone: string;
    currentBalance: Prisma.Decimal;
    isActive: boolean;
    accountId: number | null;
    createdAt: Date;
    updatedAt: Date;
    account?: { id: number; name: string; ledger?: { balance: Prisma.Decimal } | null } | null;
  },
) {
  const ledgerBalance = row.account?.ledger ? Number(row.account.ledger.balance) : 0;
  const receivable = roundMoney(Math.max(0, ledgerBalance));
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    currentBalance: Number(row.currentBalance),
    receivable,
    isActive: row.isActive,
    accountId: row.accountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCustomers(params: { activeOnly?: boolean; search?: string } = {}) {
  const where: Prisma.CustomerWhereInput = {};
  if (params.activeOnly !== false) where.isActive = true;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [{ name: { contains: q } }, { phone: { contains: q } }];
  }
  const rows = await prisma.customer.findMany({
    where,
    include: { account: { include: { ledger: true } } },
    orderBy: { name: 'asc' },
    take: 50,
  });
  return rows.map(serializeCustomer);
}

export async function getCustomer(id: number) {
  const row = await prisma.customer.findUnique({
    where: { id },
    include: { account: { include: { ledger: true } } },
  });
  if (!row) throw new AppError(404, 'Customer not found');
  return serializeCustomer(row);
}

export type CreateCustomerInput = {
  name: string;
  phone?: string;
};

export async function createCustomer(input: CreateCustomerInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Customer name is required');

  const category = await ensureCustomersCategory();
  const account = await createAccount({
    categoryId: category.id,
    name,
    type: AccountType.ASSET,
    openingBalance: 0,
    openingBalanceSide: 'DR',
  });

  try {
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: input.phone?.trim() || '',
        accountId: account.id,
      },
      include: { account: { include: { ledger: true } } },
    });
    return serializeCustomer(customer);
  } catch (err) {
    await prisma.account.update({ where: { id: account.id }, data: { isActive: false } }).catch(() => undefined);
    throw err;
  }
}
