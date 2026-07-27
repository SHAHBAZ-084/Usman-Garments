import { AccountType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createAccount,
  ensureSuppliersCategory,
} from '../accounting/accounting.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function serializeSupplier(
  row: {
    id: number;
    name: string;
    phone: string;
    address: string | null;
    openingBalance: Prisma.Decimal;
    notes: string | null;
    isActive: boolean;
    accountId: number | null;
    createdAt: Date;
    updatedAt: Date;
    account?: { id: number; name: string; ledger?: { balance: Prisma.Decimal } | null } | null;
  },
) {
  const ledgerBalance = row.account?.ledger ? Number(row.account.ledger.balance) : 0;
  // Credit balance (negative) = amount owed to supplier
  const payable = roundMoney(Math.max(0, -ledgerBalance));
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    openingBalance: Number(row.openingBalance),
    notes: row.notes,
    isActive: row.isActive,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
    payable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSuppliers(params: { activeOnly?: boolean; search?: string } = {}) {
  const where: Prisma.SupplierWhereInput = {};
  if (params.activeOnly !== false) where.isActive = true;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [{ name: { contains: q } }, { phone: { contains: q } }];
  }

  const rows = await prisma.supplier.findMany({
    where,
    include: { account: { include: { ledger: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(serializeSupplier);
}

export async function getSupplier(id: number) {
  const row = await prisma.supplier.findUnique({
    where: { id },
    include: { account: { include: { ledger: true } } },
  });
  if (!row) throw new AppError(404, 'Supplier not found');
  return serializeSupplier(row);
}

export async function getSupplierDetail(id: number) {
  const supplier = await getSupplier(id);
  const [purchases, payments] = await Promise.all([
    prisma.purchase.findMany({
      where: { supplierId: id },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, size: true, colour: true } },
          },
        },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { supplierId: id },
      orderBy: { date: 'desc' },
      take: 50,
    }),
  ]);

  return {
    supplier,
    purchases: purchases.map((p) => ({
      ...p,
      totalAmount: Number(p.totalAmount),
      paidAmount: Number(p.paidAmount),
      remainingAmount: Number(p.remainingAmount),
      items: p.items.map((i) => ({
        ...i,
        purchasePrice: Number(i.purchasePrice),
        discount: Number(i.discount),
        lineTotal: Number(i.lineTotal),
      })),
    })),
    payments: payments.map((p) => ({
      ...p,
      amount: Number(p.amount),
    })),
  };
}

export type CreateSupplierInput = {
  name: string;
  phone?: string;
  address?: string | null;
  openingBalance?: number;
  notes?: string | null;
};

export async function createSupplier(input: CreateSupplierInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Supplier name is required');

  const openingBalance = Math.abs(Number(input.openingBalance ?? 0));
  if (Number.isNaN(openingBalance) || openingBalance < 0) {
    throw new AppError(400, 'Opening balance must be zero or greater');
  }

  const category = await ensureSuppliersCategory();

  // Reuse existing account-opening-balance pattern (LIABILITY → CR side by default).
  const account = await createAccount({
    categoryId: category.id,
    name,
    type: AccountType.LIABILITY,
    openingBalance: openingBalance > 0 ? openingBalance : 0,
    openingBalanceSide: 'CR',
  });

  try {
    const supplier = await prisma.supplier.create({
      data: {
        name,
        phone: input.phone?.trim() || '',
        address: input.address?.trim() || null,
        openingBalance,
        notes: input.notes?.trim() || null,
        accountId: account.id,
      },
      include: { account: { include: { ledger: true } } },
    });
    return serializeSupplier(supplier);
  } catch (err) {
    // Soft-clean orphan account if supplier row failed (rare)
    await prisma.account.update({ where: { id: account.id }, data: { isActive: false } }).catch(() => undefined);
    throw err;
  }
}

export type UpdateSupplierInput = {
  name?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export async function updateSupplier(id: number, input: UpdateSupplierInput) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Supplier not found');

  const data: Prisma.SupplierUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AppError(400, 'Supplier name is required');
    data.name = name;
    if (existing.accountId) {
      await prisma.account.update({ where: { id: existing.accountId }, data: { name } });
    }
  }
  if (input.phone !== undefined) data.phone = input.phone.trim();
  if (input.address !== undefined) data.address = input.address?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.supplier.update({
    where: { id },
    data,
    include: { account: { include: { ledger: true } } },
  });
  return serializeSupplier(updated);
}

export async function deactivateSupplier(id: number) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Supplier not found');

  const purchaseCount = await prisma.purchase.count({ where: { supplierId: id } });
  // Soft-deactivate only — never hard-delete once referenced (or even if not; keep consistent).
  void purchaseCount;

  const updated = await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
    include: { account: { include: { ledger: true } } },
  });
  return serializeSupplier(updated);
}
