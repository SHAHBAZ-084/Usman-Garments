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
  createAccount,
  createMultiLegVoucherInTx,
  ensureCustomersCategory,
} from '../accounting/accounting.service';
import { ensurePaymentMethodAccount } from '../purchases/purchases.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function serializeCustomer(
  row: {
    id: number;
    name: string;
    phone: string;
    address: string | null;
    notes: string | null;
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
    address: row.address,
    notes: row.notes,
    currentBalance: Number(row.currentBalance),
    receivable,
    isActive: row.isActive,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
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

export async function getCustomerDetail(id: number) {
  const customer = await getCustomer(id);
  const [invoices, payments, saleReturns] = await Promise.all([
    prisma.invoice.findMany({
      where: { customerId: id },
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
    prisma.customerPayment.findMany({
      where: { customerId: id },
      orderBy: { date: 'desc' },
      take: 50,
    }),
    prisma.saleReturn.findMany({
      where: { invoice: { customerId: id } },
      orderBy: { date: 'desc' },
      take: 50,
      select: { id: true, date: true, totalAmount: true, note: true, invoice: { select: { invoiceNumber: true } } },
    }),
  ]);

  return {
    customer,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      totalAmount: Number(inv.totalAmount),
      paidAmount: Number(inv.paidAmount),
      remainingAmount: Number(inv.remainingAmount),
      paymentMethod: inv.paymentMethod,
      status: inv.status,
      items: inv.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        quantity: i.quantity,
        total: Number(i.total),
        product: i.product,
        variant: i.variant,
      })),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      date: p.date,
      note: p.note,
      createdAt: p.createdAt,
    })),
    returns: saleReturns.map((r) => ({
      id: r.id,
      date: r.date,
      amount: Number(r.totalAmount),
      note: r.note,
      invoiceNumber: r.invoice.invoiceNumber,
    })),
  };
}

export type CustomerStatementLine = {
  date: Date;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  kind: 'INVOICE' | 'PAYMENT';
  refId: number;
};

export async function getCustomerStatement(id: number): Promise<{
  customer: ReturnType<typeof serializeCustomer>;
  lines: CustomerStatementLine[];
  closingBalance: number;
}> {
  const customer = await getCustomer(id);

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { customerId: id, status: 'ACTIVE' },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        remainingAmount: true,
      },
    }),
    prisma.customerPayment.findMany({
      where: { customerId: id },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, date: true, amount: true, note: true },
    }),
  ]);

  type RawLine = {
    date: Date;
    description: string;
    debit: number;
    credit: number;
    kind: 'INVOICE' | 'PAYMENT';
    refId: number;
  };

  const raw: RawLine[] = [];

  for (const inv of invoices) {
    const remaining = Number(inv.remainingAmount);
    if (remaining > 0) {
      raw.push({
        date: inv.date,
        description: `Invoice ${inv.invoiceNumber}`,
        debit: remaining,
        credit: 0,
        kind: 'INVOICE',
        refId: inv.id,
      });
    }
  }

  for (const p of payments) {
    raw.push({
      date: p.date,
      description: p.note?.trim() ? `Payment — ${p.note.trim()}` : 'Payment received',
      debit: 0,
      credit: Number(p.amount),
      kind: 'PAYMENT',
      refId: p.id,
    });
  }

  raw.sort((a, b) => a.date.getTime() - b.date.getTime() || a.refId - b.refId);

  let balance = 0;
  const lines: CustomerStatementLine[] = raw.map((line) => {
    balance = roundMoney(balance + line.debit - line.credit);
    return { ...line, balance };
  });

  return { customer, lines, closingBalance: balance };
}

export type CreateCustomerInput = {
  name: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
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
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
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

export type UpdateCustomerInput = {
  name?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export async function updateCustomer(id: number, input: UpdateCustomerInput) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Customer not found');

  const data: Prisma.CustomerUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AppError(400, 'Customer name is required');
    data.name = name;
    if (existing.accountId) {
      await prisma.account.update({ where: { id: existing.accountId }, data: { name } });
    }
  }
  if (input.phone !== undefined) data.phone = input.phone.trim();
  if (input.address !== undefined) data.address = input.address?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.customer.update({
    where: { id },
    data,
    include: { account: { include: { ledger: true } } },
  });
  return serializeCustomer(updated);
}

export async function deactivateCustomer(id: number) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Customer not found');

  const updated = await prisma.customer.update({
    where: { id },
    data: { isActive: false },
    include: { account: { include: { ledger: true } } },
  });
  return serializeCustomer(updated);
}

export type CreateCustomerPaymentInput = {
  customerId: number;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  date: string;
  note?: string | null;
  createdById: number;
};

export async function createCustomerPayment(input: CreateCustomerPaymentInput) {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Payment amount must be greater than zero');

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    include: { account: { include: { ledger: true } } },
  });
  if (!customer || !customer.isActive) throw new AppError(400, 'Customer not found or inactive');
  if (!customer.accountId) throw new AppError(400, 'Customer has no ledger account');

  const receivable = roundMoney(Math.max(0, Number(customer.account?.ledger?.balance ?? 0)));
  if (amount > receivable + 0.01) {
    throw new AppError(400, `Payment exceeds customer balance owed (Rs ${receivable})`);
  }

  const paymentId = await prisma.$transaction(async (tx) => {
    const payment = await tx.customerPayment.create({
      data: {
        customerId: customer.id,
        amount,
        paymentMethod: input.paymentMethod,
        date: new Date(input.date),
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    const paymentAccount = await ensurePaymentMethodAccount(tx, input.paymentMethod);

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.CUSTOMER_PAYMENT,
      amount,
      date: input.date,
      description: `Payment from ${customer.name}${input.note ? ` — ${input.note}` : ''}`,
      sourceType: 'CUSTOMER_PAYMENT',
      sourceRef: String(payment.id),
      createdById: input.createdById,
      legs: [
        { accountId: paymentAccount.id, type: LedgerEntryType.DEBIT, amount },
        { accountId: customer.accountId!, type: LedgerEntryType.CREDIT, amount },
      ],
    });

    let unallocated = amount;
    const openInvoices = await tx.invoice.findMany({
      where: {
        customerId: customer.id,
        status: 'ACTIVE',
        remainingAmount: { gt: 0 },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, remainingAmount: true },
    });
    for (const inv of openInvoices) {
      if (unallocated <= 0.001) break;
      const owed = Number(inv.remainingAmount);
      const apply = roundMoney(Math.min(unallocated, owed));
      if (apply <= 0) continue;
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          remainingAmount: { decrement: apply },
        },
      });
      unallocated = roundMoney(unallocated - apply);
    }

    await tx.customer.update({
      where: { id: customer.id },
      data: { currentBalance: { decrement: amount } },
    });

    return payment.id;
  });

  const payment = await prisma.customerPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { customer: { select: { id: true, name: true } } },
  });

  const refreshed = await prisma.customer.findUniqueOrThrow({
    where: { id: customer.id },
    include: { account: { include: { ledger: true } } },
  });
  const newReceivable = roundMoney(Math.max(0, Number(refreshed.account?.ledger?.balance ?? 0)));

  return {
    id: payment.id,
    customerId: payment.customerId,
    customer: payment.customer,
    amount: Number(payment.amount),
    paymentMethod: payment.paymentMethod,
    date: payment.date,
    note: payment.note,
    createdAt: payment.createdAt,
    confirmation: {
      message: `Payment recorded. Customer balance now Rs ${newReceivable.toLocaleString('en-PK')}.`,
      remainingReceivable: newReceivable,
    },
  };
}
