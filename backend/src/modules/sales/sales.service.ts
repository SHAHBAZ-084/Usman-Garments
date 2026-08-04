import {
  AccountType,
  InvoiceStatus,
  LedgerEntryType,
  Prisma,
  PurchasePaymentMethod,
  SalePaymentMethod,
  StockMovementType,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  cancelActiveVouchersBySourceInTx,
  CASH_IN_HAND_ACCOUNT_NAME,
  createMultiLegVoucherInTx,
  ensureRetailSystemAccounts,
  ensureSystemAccount,
} from '../accounting/accounting.service';
import { adjustStockInTx } from '../products/products.service';
import { resolvePaymentAccount } from '../purchases/purchases.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

const RATE_MAX_MULTIPLIER = 5;

export type SaleItemInput = {
  productId: number;
  variantId?: number | null;
  quantity: number;
  rate?: number;
  discount?: number;
};

export type CreateSaleInput = {
  items: SaleItemInput[];
  paymentMethod: SalePaymentMethod;
  /** Amount applied to the bill (capped at total). Optional when amountReceived is sent. */
  paidAmount?: number;
  /** Cash/card tendered by customer (may exceed bill total for change / udhaar recovery). */
  amountReceived?: number;
  /**
   * When customer pays more than the bill, apply this much of the surplus to prior udhaar.
   * Remainder of surplus is change given back.
   */
  udhaarRecoveryAmount?: number;
  paymentAccountId?: number | null;
  customerId?: number | null;
  discount?: number;
  date?: string;
  notes?: string | null;
  createdById: number;
};

type ResolvedLine = {
  productId: number;
  variantId: number | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  rate: number;
  discount: number;
  lineTotal: number;
  costAtSale: number;
  availableStock: number;
};

function computeLineTotal(quantity: number, rate: number, discount: number) {
  return roundMoney(Math.max(0, quantity * rate - discount));
}

async function allocateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
  const seq = settings.nextInvoiceNumber;
  await tx.businessSettings.update({
    where: { id: 1 },
    data: { nextInvoiceNumber: seq + 1 },
  });
  const prefix = settings.invoicePrefix.trim() || 'UM-';
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

async function resolveSaleLines(tx: Prisma.TransactionClient, items: SaleItemInput[]): Promise<ResolvedLine[]> {
  if (!items?.length) throw new AppError(400, 'Add at least one item to the sale');

  const resolved: ResolvedLine[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError(400, 'Each item quantity must be a positive whole number');
    }

    const product = await tx.product.findUnique({
      where: { id: item.productId },
      include: {
        variants: true,
      },
    });
    if (!product || !product.isActive) {
      throw new AppError(400, `Product #${item.productId} not found or inactive`);
    }

    const hasVariants = product.variants.length > 0;
    if (hasVariants && item.variantId == null) {
      throw new AppError(400, `${product.name} has variants — select size/colour`);
    }
    if (!hasVariants && item.variantId != null) {
      throw new AppError(400, `${product.name} has no variants`);
    }

    let catalogRate = Number(product.salePrice);
    let costAtSale = Number(product.purchasePrice);
    let availableStock = product.currentStock;
    let variantLabel: string | null = null;

    if (item.variantId != null) {
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant) throw new AppError(400, `Variant not found for ${product.name}`);
      catalogRate = Number(variant.salePrice ?? product.salePrice);
      costAtSale = Number(variant.purchasePrice ?? product.purchasePrice);
      availableStock = variant.currentStock;
      variantLabel = [variant.size, variant.colour].filter(Boolean).join(' / ') || null;
    }

    let rate = catalogRate;
    if (item.rate != null && !Number.isNaN(item.rate)) {
      if (item.rate < 0) throw new AppError(400, `Rate for ${product.name} cannot be negative`);
      if (catalogRate > 0 && item.rate > catalogRate * RATE_MAX_MULTIPLIER) {
        throw new AppError(400, `Rate for ${product.name} exceeds allowed limit`);
      }
      rate = roundMoney(item.rate);
    }

    const discount = roundMoney(Math.max(0, item.discount ?? 0));
    resolved.push({
      productId: product.id,
      variantId: item.variantId ?? null,
      productName: product.name,
      variantLabel,
      quantity: item.quantity,
      rate,
      discount,
      lineTotal: computeLineTotal(item.quantity, rate, discount),
      costAtSale: roundMoney(Math.max(0, costAtSale)),
      availableStock,
    });
  }

  // Aggregate duplicate lines and validate stock before any mutation
  const stockNeed = new Map<string, { name: string; need: number; have: number }>();
  for (const line of resolved) {
    const key = `${line.productId}:${line.variantId ?? 'p'}`;
    const entry = stockNeed.get(key) ?? { name: line.productName, need: 0, have: line.availableStock };
    entry.need += line.quantity;
    stockNeed.set(key, entry);
  }
  for (const entry of stockNeed.values()) {
    if (entry.need > entry.have) {
      throw new AppError(
        400,
        `Insufficient stock for ${entry.name}: need ${entry.need}, have ${entry.have}`,
      );
    }
  }

  return resolved;
}

async function resolveSalePaymentAccount(
  tx: Prisma.TransactionClient,
  method: Exclude<SalePaymentMethod, 'UDHAAR'>,
  paymentAccountId?: number | null,
) {
  if (method === SalePaymentMethod.CASH) {
    await ensureRetailSystemAccounts(tx);
    return ensureSystemAccount(tx, 'Cash', CASH_IN_HAND_ACCOUNT_NAME, AccountType.ASSET, '1');
  }
  const purchaseMethodMap: Record<
    Exclude<SalePaymentMethod, 'CASH' | 'UDHAAR'>,
    PurchasePaymentMethod
  > = {
    CARD: PurchasePaymentMethod.CARD,
    EASYPAISA: PurchasePaymentMethod.EASYPAISA,
    JAZZCASH: PurchasePaymentMethod.JAZZCASH,
    BANK_TRANSFER: PurchasePaymentMethod.BANK_TRANSFER,
  };
  return resolvePaymentAccount(tx, purchaseMethodMap[method], paymentAccountId);
}

export async function createSale(input: CreateSaleInput) {
  const lines = await resolveSaleLines(prisma, input.items);

  const subtotal = roundMoney(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const invoiceDiscount = roundMoney(Math.max(0, input.discount ?? 0));
  if (invoiceDiscount > subtotal + 0.001) {
    throw new AppError(400, 'Discount cannot exceed subtotal');
  }
  const totalAmount = roundMoney(subtotal - invoiceDiscount);
  if (!(totalAmount >= 0)) throw new AppError(400, 'Sale total must be zero or greater');
  if (totalAmount === 0 && lines.length > 0) {
    throw new AppError(400, 'Sale total must be greater than zero');
  }

  const amountReceived = roundMoney(
    Math.max(0, input.amountReceived ?? input.paidAmount ?? 0),
  );
  // Ledger / udhaar use only what settles the bill; surplus is change given back.
  const paidAmount = roundMoney(Math.min(amountReceived, totalAmount));
  const remainingAmount = roundMoney(totalAmount - paidAmount);

  if (remainingAmount > 0 && !input.customerId) {
    throw new AppError(400, 'Select a customer when there is an amount remaining (udhaar)');
  }

  let customer: { id: number; name: string; accountId: number | null; isActive: boolean } | null = null;
  if (input.customerId) {
    customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, name: true, accountId: true, isActive: true },
    });
    if (!customer || !customer.isActive) throw new AppError(400, 'Customer not found or inactive');
    if (!customer.accountId) throw new AppError(400, 'Customer has no ledger account');
  }

  const saleDate = input.date ? new Date(input.date) : new Date();
  const totalCost = roundMoney(lines.reduce((sum, l) => sum + l.costAtSale * l.quantity, 0));

  const invoiceId = await prisma.$transaction(async (tx) => {
    // Re-validate stock inside transaction
    await resolveSaleLines(tx, input.items);

    const invoiceNumber = await allocateInvoiceNumber(tx);

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: customer?.id ?? null,
        date: saleDate,
        subtotal,
        discount: invoiceDiscount,
        totalAmount,
        amountReceived,
        paidAmount,
        remainingAmount,
        paymentMethod: input.paymentMethod,
        status: InvoiceStatus.ACTIVE,
        notes: input.notes?.trim() || null,
        createdById: input.createdById,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
            rate: l.rate,
            discount: l.discount,
            total: l.lineTotal,
            costAtSale: l.costAtSale,
          })),
        },
      },
    });

    const sourceRef = String(invoice.id);

    for (const line of lines) {
      const target =
        line.variantId != null
          ? { productId: line.productId, variantId: line.variantId }
          : { productId: line.productId };

      await adjustStockInTx(tx, target, line.quantity, StockMovementType.SALE, {
        note: `Sale ${invoiceNumber}`,
        sourceType: 'SALE',
        sourceRef,
      });
    }

    const { saleRevenue, inventory, cogs } = await ensureRetailSystemAccounts(tx);

    const legs: { accountId: number; type: LedgerEntryType; amount: number }[] = [];

    if (paidAmount > 0) {
      const payMethod: Exclude<SalePaymentMethod, 'UDHAAR'> =
        input.paymentMethod === SalePaymentMethod.UDHAAR
          ? SalePaymentMethod.CASH
          : input.paymentMethod;
      const paymentAccount = await resolveSalePaymentAccount(tx, payMethod, input.paymentAccountId);
      legs.push({ accountId: paymentAccount.id, type: LedgerEntryType.DEBIT, amount: paidAmount });
    }

    if (remainingAmount > 0 && customer?.accountId) {
      legs.push({
        accountId: customer.accountId,
        type: LedgerEntryType.DEBIT,
        amount: remainingAmount,
      });
      await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: { increment: remainingAmount } },
      });
    }

    legs.push({ accountId: saleRevenue.id, type: LedgerEntryType.CREDIT, amount: totalAmount });

    if (totalCost > 0) {
      legs.push({ accountId: cogs.id, type: LedgerEntryType.DEBIT, amount: totalCost });
      legs.push({ accountId: inventory.id, type: LedgerEntryType.CREDIT, amount: totalCost });
    }

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.SALE,
      amount: totalAmount,
      date: saleDate,
      description: `Sale ${invoiceNumber}${customer ? ` — ${customer.name}` : ' — Walk-in'}`,
      sourceType: 'SALE',
      sourceRef,
      createdById: input.createdById,
      legs,
    });

    return invoice.id;
  });

  const surplus = roundMoney(Math.max(0, amountReceived - totalAmount));
  let udhaarRecoveryApplied = 0;
  const priorBalance = customer
    ? Number(
        (
          await prisma.customer.findUnique({
            where: { id: customer.id },
            select: { currentBalance: true },
          })
        )?.currentBalance ?? 0,
      ) - remainingAmount // strip this sale's new udhaar from balance
    : 0;
  const recoverablePrior = roundMoney(Math.max(0, priorBalance));
  const requestedRecovery = roundMoney(Math.max(0, input.udhaarRecoveryAmount ?? 0));
  udhaarRecoveryApplied = roundMoney(
    Math.min(surplus, recoverablePrior, requestedRecovery > 0 ? requestedRecovery : 0),
  );

  // If frontend sent recovery intent via amount only (requested equals surplus when they want full surplus to recovery)
  if (requestedRecovery <= 0 && surplus > 0 && recoverablePrior > 0 && input.udhaarRecoveryAmount === undefined) {
    // no auto-apply without explicit amount
    udhaarRecoveryApplied = 0;
  }

  if (udhaarRecoveryApplied > 0 && customer) {
    const { createCustomerPayment } = await import('../customers/customers.service');
    const payMethod: PurchasePaymentMethod =
      input.paymentMethod === SalePaymentMethod.UDHAAR
        ? PurchasePaymentMethod.CASH
        : (input.paymentMethod as PurchasePaymentMethod);
    await createCustomerPayment({
      customerId: customer.id,
      amount: udhaarRecoveryApplied,
      paymentMethod: payMethod,
      paymentAccountId: input.paymentAccountId,
      date: saleDate.toISOString().slice(0, 10),
      note: `Udhaar recovery with sale`,
      createdById: input.createdById,
    });
  }

  const invoice = await getInvoice(invoiceId);
  return {
    ...invoice,
    udhaarRecoveryApplied,
    changeAmount: roundMoney(surplus - udhaarRecoveryApplied),
  };
}

function serializeInvoice(row: {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  date: Date;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  amountReceived?: Prisma.Decimal | null;
  paidAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  paymentMethod: SalePaymentMethod;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: Date;
  customer?: { id: number; name: string; phone: string } | null;
  items: Array<{
    id: number;
    productId: number;
    variantId: number | null;
    quantity: number;
    rate: Prisma.Decimal;
    discount: Prisma.Decimal;
    total: Prisma.Decimal;
    costAtSale: Prisma.Decimal;
    product: { id: number; name: string; sku: string };
    variant: { id: number; size: string | null; colour: string | null; sku: string } | null;
  }>;
}) {
  const totalAmount = Number(row.totalAmount);
  const paidAmount = Number(row.paidAmount);
  const amountReceived =
    row.amountReceived != null ? Number(row.amountReceived) : paidAmount;
  const changeAmount = Math.max(0, roundMoney(amountReceived - totalAmount));
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    customer: row.customer,
    date: row.date,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    totalAmount,
    amountReceived,
    paidAmount,
    remainingAmount: Number(row.remainingAmount),
    changeAmount,
    paymentMethod: row.paymentMethod,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    items: row.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      rate: Number(i.rate),
      discount: Number(i.discount),
      total: Number(i.total),
      costAtSale: Number(i.costAtSale),
      product: { id: i.product.id, name: i.product.name, productCode: i.product.sku },
      variant: i.variant
        ? {
            id: i.variant.id,
            size: i.variant.size,
            colour: i.variant.colour,
            productCode: i.variant.sku,
          }
        : null,
    })),
  };
}

export async function getInvoice(id: number) {
  const row = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, size: true, colour: true, sku: true } },
        },
      },
    },
  });
  if (!row) throw new AppError(404, 'Invoice not found');
  return serializeInvoice(row);
}

export async function listInvoices(params: { page?: number; pageSize?: number; status?: InvoiceStatus } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.InvoiceWhereInput = {};
  if (params.status) where.status = params.status;

  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, size: true, colour: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map(serializeInvoice),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function cancelSale(id: number, userId: number) {
  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
      customer: { select: { id: true, accountId: true } },
    },
  });
  if (!existing) throw new AppError(404, 'Invoice not found');
  if (existing.status === InvoiceStatus.CANCELLED) {
    throw new AppError(400, 'Invoice is already cancelled');
  }

  await prisma.$transaction(async (tx) => {
    const sourceRef = String(existing.id);

    for (const item of existing.items) {
      const target =
        item.variantId != null
          ? { productId: item.productId, variantId: item.variantId }
          : { productId: item.productId };

      await adjustStockInTx(tx, target, item.quantity, StockMovementType.CANCELLATION, {
        note: `Cancel sale ${existing.invoiceNumber}`,
        sourceType: 'SALE_CANCEL',
        sourceRef,
      });
    }

    await cancelActiveVouchersBySourceInTx(tx, 'SALE', sourceRef, userId);

    if (Number(existing.remainingAmount) > 0 && existing.customerId) {
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { currentBalance: { decrement: Number(existing.remainingAmount) } },
      });
    }

    await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  });

  return getInvoice(id);
}

export async function deleteSale(id: number, userId: number) {
  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
      customer: { select: { id: true, accountId: true } },
      saleReturns: { select: { id: true } },
      exchanges: { select: { id: true } },
    },
  });
  if (!existing) throw new AppError(404, 'Invoice not found');

  if (existing.saleReturns.length > 0 || existing.exchanges.length > 0) {
    throw new AppError(
      400,
      'Cannot delete a sale that has associated return or exchange records.',
    );
  }

  await prisma.$transaction(async (tx) => {
    const sourceRef = String(existing.id);

    if (existing.status !== InvoiceStatus.CANCELLED) {
      for (const item of existing.items) {
        const target =
          item.variantId != null
            ? { productId: item.productId, variantId: item.variantId }
            : { productId: item.productId };

        await adjustStockInTx(tx, target, item.quantity, StockMovementType.CANCELLATION, {
          note: `Delete sale ${existing.invoiceNumber}`,
          sourceType: 'SALE_DELETE',
          sourceRef,
        });
      }

      await cancelActiveVouchersBySourceInTx(tx, 'SALE', sourceRef, userId);

      if (Number(existing.remainingAmount) > 0 && existing.customerId) {
        await tx.customer.update({
          where: { id: existing.customerId },
          data: { currentBalance: { decrement: Number(existing.remainingAmount) } },
        });
      }
    }

    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
  });

  return { ok: true, deletedInvoiceNumber: existing.invoiceNumber };
}

/** @internal exported for tests */
export { resolveSaleLines, allocateInvoiceNumber };

