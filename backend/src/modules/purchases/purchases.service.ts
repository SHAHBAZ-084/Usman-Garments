import {
  AccountType,
  LedgerEntryType,
  Prisma,
  PurchasePaymentMethod,
  PurchaseStatus,
  StockMovementType,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  CASH_IN_HAND_ACCOUNT_NAME,
  createMultiLegVoucherInTx,
  ensureInventoryAccount,
  ensureRetailSystemAccounts,
  ensureSystemAccount,
} from '../accounting/accounting.service';
import { adjustStockInTx } from '../products/products.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

const PAYMENT_ACCOUNT_NAMES: Record<PurchasePaymentMethod, string> = {
  CASH: CASH_IN_HAND_ACCOUNT_NAME,
  CARD: 'Card Account',
  EASYPAISA: 'Easypaisa',
  JAZZCASH: 'JazzCash',
  BANK_TRANSFER: 'Bank Transfer',
};

/** Card and bank-transfer postings require an explicit Bank-category account. */
export function paymentMethodNeedsBankAccount(method: PurchasePaymentMethod | string): boolean {
  return method === PurchasePaymentMethod.CARD || method === PurchasePaymentMethod.BANK_TRANSFER;
}

function isBankCategoryName(name: string) {
  return name.trim().toLowerCase() === 'bank';
}

export async function ensurePaymentMethodAccount(
  tx: Prisma.TransactionClient,
  method: PurchasePaymentMethod,
) {
  await ensureRetailSystemAccounts(tx);
  if (method === PurchasePaymentMethod.CASH) {
    return ensureSystemAccount(tx, 'Cash', CASH_IN_HAND_ACCOUNT_NAME, AccountType.ASSET, '1');
  }
  return ensureSystemAccount(
    tx,
    'Bank',
    PAYMENT_ACCOUNT_NAMES[method],
    AccountType.ASSET,
  );
}

/**
 * Resolve the cash/bank GL account for a payment.
 * Cash always uses Cash in Hand. Card / Bank Transfer require paymentAccountId
 * pointing at an active Bank-category account. Other methods keep legacy named accounts
 * unless paymentAccountId is provided.
 */
export async function resolvePaymentAccount(
  tx: Prisma.TransactionClient,
  method: PurchasePaymentMethod,
  paymentAccountId?: number | null,
) {
  if (method === PurchasePaymentMethod.CASH) {
    return ensurePaymentMethodAccount(tx, method);
  }

  if (paymentAccountId != null) {
    const account = await tx.account.findFirst({
      where: { id: paymentAccountId, isActive: true },
      include: { category: true },
    });
    if (!account?.category) throw new AppError(400, 'Payment account not found');
    if (!isBankCategoryName(account.category.name)) {
      throw new AppError(400, 'Selected account must be a Bank account');
    }
    return account;
  }

  if (paymentMethodNeedsBankAccount(method)) {
    throw new AppError(400, 'Select a bank account for card or bank transfer');
  }

  return ensurePaymentMethodAccount(tx, method);
}

export async function listBankAccounts() {
  await ensureRetailSystemAccounts(prisma);
  const accounts = await prisma.account.findMany({
    where: {
      isActive: true,
      category: { isActive: true, name: { equals: 'Bank' } },
    },
    include: { category: true, ledger: true },
    orderBy: { name: 'asc' },
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    code: a.code,
    categoryId: a.categoryId,
    categoryName: a.category.name,
    balance: a.ledger ? Number(a.ledger.balance) : 0,
  }));
}

export type PurchaseItemInput = {
  productId: number;
  variantId?: number | null;
  quantity: number;
  purchasePrice: number;
  discount?: number;
};

export type CreatePurchaseInput = {
  supplierId: number;
  date: string;
  supplierInvoiceNumber?: string | null;
  items: PurchaseItemInput[];
  paidAmount: number;
  paymentMethod: PurchasePaymentMethod;
  paymentAccountId?: number | null;
  notes?: string | null;
  createdById: number;
};

function computeLineTotal(quantity: number, purchasePrice: number, discount: number) {
  return roundMoney(Math.max(0, quantity * purchasePrice - discount));
}

export async function createPurchase(input: CreatePurchaseInput) {
  if (!input.items?.length) throw new AppError(400, 'Add at least one product to the purchase');

  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
    include: { account: { include: { ledger: true } } },
  });
  if (!supplier || !supplier.isActive) throw new AppError(400, 'Supplier not found or inactive');
  if (!supplier.accountId) throw new AppError(400, 'Supplier has no ledger account');

  const normalizedItems = input.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError(400, 'Each item quantity must be a positive whole number');
    }
    if (!(item.purchasePrice >= 0)) {
      throw new AppError(400, 'Purchase price must be zero or greater');
    }
    const discount = Math.max(0, item.discount ?? 0);
    return {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      purchasePrice: roundMoney(item.purchasePrice),
      discount: roundMoney(discount),
      lineTotal: computeLineTotal(item.quantity, item.purchasePrice, discount),
    };
  });

  const totalAmount = roundMoney(normalizedItems.reduce((sum, i) => sum + i.lineTotal, 0));
  if (!(totalAmount > 0)) throw new AppError(400, 'Purchase total must be greater than zero');

  const paidAmount = roundMoney(Math.max(0, input.paidAmount ?? 0));
  if (paidAmount > totalAmount + 0.001) {
    throw new AppError(400, 'Paid amount cannot exceed purchase total');
  }
  const remainingAmount = roundMoney(totalAmount - paidAmount);

  const purchaseId = await prisma.$transaction(async (tx) => {
    // Validate products/variants exist before mutating stock
    for (const item of normalizedItems) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { variants: { select: { id: true } } },
      });
      if (!product || !product.isActive) {
        throw new AppError(400, `Product #${item.productId} not found or inactive`);
      }
      if (product.variants.length > 0) {
        if (item.variantId == null) {
          throw new AppError(400, `${product.name} has variants — select size/colour`);
        }
        const variant = product.variants.find((v) => v.id === item.variantId);
        if (!variant) throw new AppError(400, `Variant not found for ${product.name}`);
      } else if (item.variantId != null) {
        throw new AppError(400, `${product.name} has no variants`);
      }
    }

    const purchase = await tx.purchase.create({
      data: {
        supplierId: supplier.id,
        date: new Date(input.date),
        supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
        totalAmount,
        paidAmount,
        remainingAmount,
        paymentMethod: input.paymentMethod,
        notes: input.notes?.trim() || null,
        createdById: input.createdById,
        status: PurchaseStatus.ACTIVE,
        items: {
          create: normalizedItems.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            purchasePrice: i.purchasePrice,
            discount: i.discount,
            lineTotal: i.lineTotal,
          })),
        },
      },
    });

    const sourceRef = String(purchase.id);

    for (const item of normalizedItems) {
      const target =
        item.variantId != null
          ? { productId: item.productId, variantId: item.variantId }
          : { productId: item.productId };

      await adjustStockInTx(tx, target, item.quantity, StockMovementType.PURCHASE, {
        note: `Purchase #${purchase.id}`,
        sourceType: 'PURCHASE',
        sourceRef,
      });

      // Latest-cost: update purchase price on the stocked unit
      if (item.variantId != null) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { purchasePrice: item.purchasePrice },
        });
      }
      await tx.product.update({
        where: { id: item.productId },
        data: {
          purchasePrice: item.purchasePrice,
          supplier: { connect: { id: supplier.id } },
        },
      });
    }

    const inventory = await ensureInventoryAccount(tx);
    const paymentAccount =
      paidAmount > 0
        ? await resolvePaymentAccount(tx, input.paymentMethod, input.paymentAccountId)
        : null;

    const legs: { accountId: number; type: LedgerEntryType; amount: number }[] = [
      { accountId: inventory.id, type: LedgerEntryType.DEBIT, amount: totalAmount },
    ];
    if (paidAmount > 0 && paymentAccount) {
      legs.push({
        accountId: paymentAccount.id,
        type: LedgerEntryType.CREDIT,
        amount: paidAmount,
      });
    }
    if (remainingAmount > 0) {
      legs.push({
        accountId: supplier.accountId!,
        type: LedgerEntryType.CREDIT,
        amount: remainingAmount,
      });
    }

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.PURCHASE,
      amount: totalAmount,
      date: input.date,
      description: `Purchase from ${supplier.name}${input.supplierInvoiceNumber ? ` (${input.supplierInvoiceNumber})` : ''}`,
      sourceType: 'PURCHASE',
      sourceRef,
      createdById: input.createdById,
      legs,
    });

    return purchase.id;
  });

  return getPurchase(purchaseId);
}

export async function getPurchase(id: number) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, size: true, colour: true, sku: true } },
        },
      },
    },
  });
  if (!purchase) throw new AppError(404, 'Purchase not found');

  return {
    id: purchase.id,
    supplierId: purchase.supplierId,
    supplier: purchase.supplier,
    date: purchase.date,
    supplierInvoiceNumber: purchase.supplierInvoiceNumber,
    totalAmount: Number(purchase.totalAmount),
    paidAmount: Number(purchase.paidAmount),
    remainingAmount: Number(purchase.remainingAmount),
    paymentMethod: purchase.paymentMethod,
    notes: purchase.notes,
    status: purchase.status,
    createdAt: purchase.createdAt,
    items: purchase.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      purchasePrice: Number(i.purchasePrice),
      discount: Number(i.discount),
      lineTotal: Number(i.lineTotal),
      product: {
        id: i.product.id,
        name: i.product.name,
        productCode: i.product.sku,
      },
      variant: i.variant
        ? {
            id: i.variant.id,
            size: i.variant.size,
            colour: i.variant.colour,
            productCode: i.variant.sku,
          }
        : null,
    })),
    confirmation: {
      stockUpdated: true,
      totalAmount: Number(purchase.totalAmount),
      paidAmount: Number(purchase.paidAmount),
      addedToSupplierBalance: Number(purchase.remainingAmount),
      message:
        Number(purchase.remainingAmount) > 0
          ? `Stock updated. Rs ${Number(purchase.remainingAmount).toLocaleString('en-PK')} added to supplier balance.`
          : 'Stock updated. Purchase fully paid — nothing added to supplier balance.',
    },
  };
}

export async function listPurchases(params: { supplierId?: number; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.PurchaseWhereInput = {};
  if (params.supplierId != null) where.supplierId = params.supplierId;

  const [total, rows] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map((p) => ({
      ...p,
      totalAmount: Number(p.totalAmount),
      paidAmount: Number(p.paidAmount),
      remainingAmount: Number(p.remainingAmount),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type CreateSupplierPaymentInput = {
  supplierId: number;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  paymentAccountId?: number | null;
  date: string;
  note?: string | null;
  createdById: number;
};

export async function createSupplierPayment(input: CreateSupplierPaymentInput) {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Payment amount must be greater than zero');

  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
    include: { account: { include: { ledger: true } } },
  });
  if (!supplier || !supplier.isActive) throw new AppError(400, 'Supplier not found or inactive');
  if (!supplier.accountId) throw new AppError(400, 'Supplier has no ledger account');

  const payable = roundMoney(Math.max(0, -Number(supplier.account?.ledger?.balance ?? 0)));
  if (amount > payable + 0.01) {
    throw new AppError(400, `Payment exceeds supplier balance owed (Rs ${payable})`);
  }

  const paymentId = await prisma.$transaction(async (tx) => {
    const payment = await tx.supplierPayment.create({
      data: {
        supplierId: supplier.id,
        amount,
        paymentMethod: input.paymentMethod,
        date: new Date(input.date),
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    const paymentAccount = await resolvePaymentAccount(tx, input.paymentMethod, input.paymentAccountId);

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.SUPPLIER_PAYMENT,
      amount,
      date: input.date,
      description: `Payment to ${supplier.name}${input.note ? ` — ${input.note}` : ''}`,
      sourceType: 'SUPPLIER_PAYMENT',
      sourceRef: String(payment.id),
      createdById: input.createdById,
      legs: [
        { accountId: supplier.accountId!, type: LedgerEntryType.DEBIT, amount },
        { accountId: paymentAccount.id, type: LedgerEntryType.CREDIT, amount },
      ],
    });

    let unallocated = amount;
    const openPurchases = await tx.purchase.findMany({
      where: {
        supplierId: supplier.id,
        status: PurchaseStatus.ACTIVE,
        remainingAmount: { gt: 0 },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, remainingAmount: true },
    });
    for (const purchase of openPurchases) {
      if (unallocated <= 0.001) break;
      const owed = Number(purchase.remainingAmount);
      const apply = roundMoney(Math.min(unallocated, owed));
      if (apply <= 0) continue;
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { remainingAmount: { decrement: apply } },
      });
      unallocated = roundMoney(unallocated - apply);
    }

    return payment.id;
  });

  const payment = await prisma.supplierPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { supplier: { select: { id: true, name: true } } },
  });

  const refreshed = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplier.id },
    include: { account: { include: { ledger: true } } },
  });
  const newPayable = roundMoney(Math.max(0, -Number(refreshed.account?.ledger?.balance ?? 0)));

  return {
    id: payment.id,
    supplierId: payment.supplierId,
    supplier: payment.supplier,
    amount: Number(payment.amount),
    paymentMethod: payment.paymentMethod,
    date: payment.date,
    note: payment.note,
    createdAt: payment.createdAt,
    confirmation: {
      message: `Payment recorded. Supplier balance now Rs ${newPayable.toLocaleString('en-PK')}.`,
      remainingPayable: newPayable,
    },
  };
}

export type PurchaseReturnItemInput = {
  purchaseItemId: number;
  quantity: number;
};

export type CreatePurchaseReturnInput = {
  purchaseId: number;
  items: PurchaseReturnItemInput[];
  note?: string | null;
  createdById: number;
  /** If true, reduce cash/bank instead of supplier payable (for fully paid purchases). Default: reduce supplier first. */
  refundToCash?: boolean;
};

export async function createPurchaseReturn(input: CreatePurchaseReturnInput) {
  if (!input.items?.length) throw new AppError(400, 'Select items to return');

  const purchase = await prisma.purchase.findUnique({
    where: { id: input.purchaseId },
    include: {
      supplier: true,
      items: true,
    },
  });
  if (!purchase) throw new AppError(404, 'Purchase not found');
  if (purchase.status === PurchaseStatus.CANCELLED) {
    throw new AppError(400, 'Cannot return a cancelled purchase');
  }
  if (!purchase.supplier.accountId) throw new AppError(400, 'Supplier has no ledger account');

  const priorReturns = await prisma.purchaseReturnItem.findMany({
    where: { purchaseReturn: { purchaseId: purchase.id } },
  });
  const returnedQtyByItem = new Map<number, number>();
  for (const r of priorReturns) {
    returnedQtyByItem.set(r.purchaseItemId, (returnedQtyByItem.get(r.purchaseItemId) ?? 0) + r.quantity);
  }

  const returnLines: {
    purchaseItemId: number;
    productId: number;
    variantId: number | null;
    quantity: number;
    purchasePrice: number;
    lineTotal: number;
  }[] = [];

  for (const req of input.items) {
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      throw new AppError(400, 'Return quantity must be a positive whole number');
    }
    const item = purchase.items.find((i) => i.id === req.purchaseItemId);
    if (!item) throw new AppError(400, `Purchase item #${req.purchaseItemId} not found`);
    const already = returnedQtyByItem.get(item.id) ?? 0;
    const available = item.quantity - already;
    if (req.quantity > available) {
      throw new AppError(400, `Cannot return more than ${available} for this line`);
    }
    const unit = Number(item.purchasePrice);
    returnLines.push({
      purchaseItemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      quantity: req.quantity,
      purchasePrice: unit,
      lineTotal: roundMoney(req.quantity * unit),
    });
  }

  const totalAmount = roundMoney(returnLines.reduce((s, l) => s + l.lineTotal, 0));
  if (!(totalAmount > 0)) throw new AppError(400, 'Return total must be greater than zero');

  const returnId = await prisma.$transaction(async (tx) => {
    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        purchaseId: purchase.id,
        totalAmount,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        items: {
          create: returnLines.map((l) => ({
            purchaseItemId: l.purchaseItemId,
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
            purchasePrice: l.purchasePrice,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });

    const sourceRef = String(purchaseReturn.id);

    for (const line of returnLines) {
      const target =
        line.variantId != null
          ? { productId: line.productId, variantId: line.variantId }
          : { productId: line.productId };

      await adjustStockInTx(tx, target, line.quantity, StockMovementType.PURCHASE_RETURN, {
        note: `Purchase return #${purchaseReturn.id}`,
        sourceType: 'PURCHASE_RETURN',
        sourceRef,
      });
    }

    const inventory = await ensureInventoryAccount(tx);
    const useCash =
      input.refundToCash === true || Number(purchase.remainingAmount) <= 0.001;

    let offsetAccountId = purchase.supplier.accountId!;
    if (useCash) {
      const paymentAccount = await ensurePaymentMethodAccount(tx, purchase.paymentMethod);
      offsetAccountId = paymentAccount.id;
    }

    // Purchase return: Dr Supplier (or Cash) / Cr Inventory
    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.PURCHASE_RETURN,
      amount: totalAmount,
      date: new Date(),
      description: `Purchase return for purchase #${purchase.id}`,
      sourceType: 'PURCHASE_RETURN',
      sourceRef,
      createdById: input.createdById,
      legs: [
        { accountId: offsetAccountId, type: LedgerEntryType.DEBIT, amount: totalAmount },
        { accountId: inventory.id, type: LedgerEntryType.CREDIT, amount: totalAmount },
      ],
    });

    const allReturned = await tx.purchaseReturnItem.findMany({
      where: { purchaseReturn: { purchaseId: purchase.id } },
    });
    const returnedMap = new Map<number, number>();
    for (const r of allReturned) {
      returnedMap.set(r.purchaseItemId, (returnedMap.get(r.purchaseItemId) ?? 0) + r.quantity);
    }
    const fullyReturned = purchase.items.every(
      (i) => (returnedMap.get(i.id) ?? 0) >= i.quantity,
    );
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        status: fullyReturned ? PurchaseStatus.RETURNED : PurchaseStatus.PARTIALLY_RETURNED,
      },
    });

    return purchaseReturn.id;
  });

  const result = await prisma.purchaseReturn.findUniqueOrThrow({
    where: { id: returnId },
    include: { items: true },
  });

  return {
    id: result.id,
    purchaseId: result.purchaseId,
    totalAmount: Number(result.totalAmount),
    note: result.note,
    createdAt: result.createdAt,
    items: result.items.map((i) => ({
      ...i,
      purchasePrice: Number(i.purchasePrice),
      lineTotal: Number(i.lineTotal),
    })),
    confirmation: {
      message: `Return recorded. Stock reduced by returned quantities. Rs ${Number(result.totalAmount).toLocaleString('en-PK')} reversed.`,
    },
  };
}
