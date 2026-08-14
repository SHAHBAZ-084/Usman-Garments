import {
  InvoiceStatus,
  LedgerEntryType,
  Prisma,
  PurchasePaymentMethod,
  ReturnCondition,
  StockMovementType,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createMultiLegVoucherInTx,
  ensureRetailSystemAccounts,
  SALES_RETURN_ACCOUNT_NAME,
} from '../accounting/accounting.service';
import { adjustStockInTx, recordDamagedReturnInTx } from '../products/products.service';
import { resolvePaymentAccount } from '../purchases/purchases.service';
import { resolveSaleLines, type SaleItemInput } from './sales.service';

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

type ReturnLineInput = {
  invoiceItemId: number;
  quantity: number;
  condition: ReturnCondition;
};

type ResolvedReturnLine = {
  invoiceItemId: number;
  productId: number;
  variantId: number | null;
  productName: string;
  quantity: number;
  rate: number;
  lineTotal: number;
  costAtReturn: number;
  condition: ReturnCondition;
};

async function loadReturnableInvoice(invoiceId: number) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, accountId: true, currentBalance: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, size: true, colour: true } },
        },
      },
    },
  });
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status !== InvoiceStatus.ACTIVE) {
    throw new AppError(400, 'Cannot return items on a cancelled invoice');
  }
  return invoice;
}

async function returnedQtyByInvoiceItem(invoiceId: number) {
  const prior = await prisma.saleReturnItem.findMany({
    where: { saleReturn: { invoiceId } },
    select: { invoiceItemId: true, quantity: true },
  });
  const map = new Map<number, number>();
  for (const row of prior) {
    map.set(row.invoiceItemId, (map.get(row.invoiceItemId) ?? 0) + row.quantity);
  }
  return map;
}

/** Line total after allocating a proportional share of invoice-level discount. */
function returnLineMoney(
  item: { total: unknown; quantity: number },
  returnQty: number,
  invoice: { subtotal: unknown; discount: unknown },
) {
  const grossUnit = Number(item.total) / item.quantity;
  const gross = grossUnit * returnQty;
  const subtotal = Number(invoice.subtotal) || 0;
  const discount = Math.max(0, Number(invoice.discount) || 0);
  if (subtotal <= 0 || discount <= 0) return roundMoney(gross);
  const discountShare = (gross / subtotal) * discount;
  return roundMoney(Math.max(0, gross - discountShare));
}

async function resolveReturnLines(
  invoice: Awaited<ReturnType<typeof loadReturnableInvoice>>,
  items: ReturnLineInput[],
): Promise<ResolvedReturnLine[]> {
  if (!items?.length) throw new AppError(400, 'Select at least one item to return');

  const returnedMap = await returnedQtyByInvoiceItem(invoice.id);
  const resolved: ResolvedReturnLine[] = [];

  for (const req of items) {
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      throw new AppError(400, 'Return quantity must be a positive whole number');
    }
    const item = invoice.items.find((i) => i.id === req.invoiceItemId);
    if (!item) throw new AppError(400, `Invoice line #${req.invoiceItemId} not found`);

    const already = returnedMap.get(item.id) ?? 0;
    const available = item.quantity - already;
    if (req.quantity > available) {
      throw new AppError(
        400,
        `Cannot return more than ${available} for ${item.product.name} (sold ${item.quantity}, already returned ${already})`,
      );
    }

    const unitCost = Number(item.costAtSale);
    resolved.push({
      invoiceItemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.product.name,
      quantity: req.quantity,
      rate: roundMoney(Number(item.rate)),
      lineTotal: returnLineMoney(item, req.quantity, invoice),
      costAtReturn: roundMoney(unitCost * req.quantity),
      condition: req.condition,
    });
  }

  return resolved;
}

function restocksInventory(condition: ReturnCondition) {
  return condition === ReturnCondition.GOOD || condition === ReturnCondition.OTHER;
}

type RefundSplitOptions = {
  /** When true, do not apply any amount against customer udhaar. */
  refundToCash?: boolean;
  /** When true (and not refundToCash), apply against udhaar. */
  applyToUdhaar?: boolean;
  /** How much of the refund to clear from customer owe (optional; defaults to max possible). */
  applyToUdhaarAmount?: number;
};

function computeRefundSplit(
  invoice: Awaited<ReturnType<typeof loadReturnableInvoice>>,
  refundTotal: number,
  options?: RefundSplitOptions | boolean,
) {
  const opts: RefundSplitOptions =
    typeof options === 'boolean' ? { refundToCash: options } : options ?? {};

  const applyUdhaar =
    opts.refundToCash !== true &&
    opts.applyToUdhaar !== false &&
    Boolean(invoice.customerId && invoice.customer?.accountId);

  if (!applyUdhaar || refundTotal <= 0) {
    return { customerCredit: 0, cashCredit: roundMoney(refundTotal) };
  }

  const balanceRaw = Number(invoice.customer!.currentBalance);
  const remaining = Number(invoice.remainingAmount) || 0;
  const owed = Math.max(0, Number.isFinite(balanceRaw) ? balanceRaw : remaining);
  const requested =
    opts.applyToUdhaarAmount != null
      ? Math.max(0, opts.applyToUdhaarAmount)
      : Math.min(refundTotal, owed);
  const customerCredit = roundMoney(Math.min(refundTotal, owed, requested));
  const cashCredit = roundMoney(refundTotal - customerCredit);
  return { customerCredit, cashCredit };
}

async function applyRefundLegs(
  tx: Prisma.TransactionClient,
  invoice: Awaited<ReturnType<typeof loadReturnableInvoice>>,
  customerCredit: number,
  cashCredit: number,
  refundMethod: PurchasePaymentMethod,
  paymentAccountId?: number | null,
) {
  const legs: { accountId: number; type: LedgerEntryType; amount: number }[] = [];

  if (customerCredit > 0.001) {
    legs.push({
      accountId: invoice.customer!.accountId!,
      type: LedgerEntryType.CREDIT,
      amount: customerCredit,
    });
    await tx.customer.update({
      where: { id: invoice.customerId! },
      data: { currentBalance: { decrement: customerCredit } },
    });
  }

  if (cashCredit > 0.001) {
    const paymentAccount = await resolvePaymentAccount(tx, refundMethod, paymentAccountId);
    legs.push({
      accountId: paymentAccount.id,
      type: LedgerEntryType.CREDIT,
      amount: cashCredit,
    });
  }

  return legs;
}

async function buildRefundLegs(
  tx: Prisma.TransactionClient,
  params: {
    invoice: Awaited<ReturnType<typeof loadReturnableInvoice>>;
    refundTotal: number;
    refundMethod: PurchasePaymentMethod;
    paymentAccountId?: number | null;
    refundToCash?: boolean;
    applyToUdhaar?: boolean;
    applyToUdhaarAmount?: number;
  },
) {
  const { customerCredit, cashCredit } = computeRefundSplit(params.invoice, params.refundTotal, {
    refundToCash: params.refundToCash,
    applyToUdhaar: params.applyToUdhaar,
    applyToUdhaarAmount: params.applyToUdhaarAmount,
  });
  const legs = await applyRefundLegs(
    tx,
    params.invoice,
    customerCredit,
    cashCredit,
    params.refundMethod,
    params.paymentAccountId,
  );
  return { legs, customerCredit, cashCredit };
}

async function adjustInvoiceAfterReturn(
  tx: Prisma.TransactionClient,
  invoice: { id: number; totalAmount: unknown; paidAmount: unknown; remainingAmount: unknown },
  returnTotal: number,
  customerCredit: number,
  cashCredit: number,
) {
  const oldTotal = Number(invoice.totalAmount);
  const oldPaid = Number(invoice.paidAmount);
  const oldRemaining = Number(invoice.remainingAmount);

  const newTotal = roundMoney(Math.max(0, oldTotal - returnTotal));
  const newPaid = roundMoney(Math.max(0, oldPaid - cashCredit));
  const newRemaining = roundMoney(Math.max(0, oldRemaining - customerCredit));

  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      totalAmount: newTotal,
      paidAmount: newPaid,
      remainingAmount: newRemaining,
    },
  });
}

async function adjustInvoiceAfterExchange(
  tx: Prisma.TransactionClient,
  invoice: { id: number; totalAmount: unknown; paidAmount: unknown; remainingAmount: unknown },
  returnTotal: number,
  newSaleTotal: number,
  customerCredit: number,
  exchangePaidAmount: number,
) {
  const oldTotal = Number(invoice.totalAmount);
  const oldPaid = Number(invoice.paidAmount);
  const oldRemaining = Number(invoice.remainingAmount);

  const newTotal = roundMoney(Math.max(0, oldTotal - returnTotal + newSaleTotal));
  let newPaid: number;
  let newRemaining: number;

  if (oldRemaining > 0.001) {
    newRemaining = roundMoney(
      Math.max(0, oldRemaining - customerCredit + Math.max(0, newSaleTotal - exchangePaidAmount)),
    );
    newPaid = roundMoney(Math.max(0, newTotal - newRemaining));
  } else {
    newPaid = roundMoney(Math.max(0, oldPaid + exchangePaidAmount));
    newRemaining = roundMoney(Math.max(0, newTotal - newPaid));
  }

  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      totalAmount: newTotal,
      paidAmount: newPaid,
      remainingAmount: newRemaining,
    },
  });
}

function buildReturnAccountingLegs(
  accounts: Awaited<ReturnType<typeof ensureRetailSystemAccounts>>,
  lines: ResolvedReturnLine[],
  refundLegs: { accountId: number; type: LedgerEntryType; amount: number }[],
  refundAmount?: number,
) {
  const calculatedTotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const returnTotal =
    refundAmount != null ? roundMoney(Math.min(calculatedTotal, Math.max(0, refundAmount))) : calculatedTotal;
  const returnCost = roundMoney(lines.reduce((s, l) => s + l.costAtReturn, 0));

  const restockCost = roundMoney(
    lines.filter((l) => restocksInventory(l.condition)).reduce((s, l) => s + l.costAtReturn, 0),
  );
  const damagedCost = roundMoney(returnCost - restockCost);

  const legs: { accountId: number; type: LedgerEntryType; amount: number }[] = [];

  legs.push({
    accountId: accounts.salesReturn.id,
    type: LedgerEntryType.DEBIT,
    amount: returnTotal,
  });
  legs.push(...refundLegs);

  if (restockCost > 0) {
    legs.push({ accountId: accounts.inventory.id, type: LedgerEntryType.DEBIT, amount: restockCost });
    legs.push({ accountId: accounts.cogs.id, type: LedgerEntryType.CREDIT, amount: restockCost });
  }
  if (damagedCost > 0) {
    legs.push({ accountId: accounts.damagedLoss.id, type: LedgerEntryType.DEBIT, amount: damagedCost });
    legs.push({ accountId: accounts.cogs.id, type: LedgerEntryType.CREDIT, amount: damagedCost });
  }

  return { returnTotal, returnCost, legs };
}

async function applyReturnStock(
  tx: Prisma.TransactionClient,
  lines: ResolvedReturnLine[],
  sourceRef: string,
  notePrefix: string,
) {
  for (const line of lines) {
    const target =
      line.variantId != null
        ? { productId: line.productId, variantId: line.variantId }
        : { productId: line.productId };

    if (restocksInventory(line.condition)) {
      await adjustStockInTx(tx, target, line.quantity, StockMovementType.SALE_RETURN, {
        note: `${notePrefix} — ${line.productName}`,
        sourceType: 'SALE_RETURN',
        sourceRef,
      });
    } else {
      await recordDamagedReturnInTx(tx, target, line.quantity, {
        note: `${notePrefix} (damaged) — ${line.productName}`,
        sourceType: 'SALE_RETURN',
        sourceRef,
      });
    }
  }
}

export async function findInvoiceForReturn(invoiceNumber: string) {
  // Printed invoice barcode encodes invoiceNumber (CODE128). Scanners may append CR/LF.
  const trimmed = invoiceNumber.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, '').trim();
  if (!trimmed) throw new AppError(400, 'Invoice number is required');

  const include = {
    customer: { select: { id: true, name: true, phone: true, currentBalance: true } },
    items: {
      include: {
        product: { select: { id: true, name: true, sku: true } },
        variant: { select: { id: true, size: true, colour: true, sku: true } },
      },
    },
  } as const;

  let invoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: trimmed, status: InvoiceStatus.ACTIVE },
    include,
  });

  if (!invoice) {
    const upper = trimmed.toUpperCase();
    if (upper !== trimmed) {
      invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber: upper, status: InvoiceStatus.ACTIVE },
        include,
      });
    }
  }

  if (!invoice) {
    // Case-insensitive match against active invoices (small retail volume).
    const candidates = await prisma.invoice.findMany({
      where: { status: InvoiceStatus.ACTIVE },
      include,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    invoice =
      candidates.find((row) => row.invoiceNumber.toUpperCase() === trimmed.toUpperCase()) ?? null;
  }

  if (!invoice) throw new AppError(404, 'Invoice not found');

  const returnedMap = await returnedQtyByInvoiceItem(invoice.id);

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    remainingAmount: Number(invoice.remainingAmount),
    paymentMethod: invoice.paymentMethod,
    customer: invoice.customer
      ? {
          id: invoice.customer.id,
          name: invoice.customer.name,
          phone: invoice.customer.phone,
        }
      : null,
    customerBalance: invoice.customer ? Number(invoice.customer.currentBalance) : 0,
    items: invoice.items.map((item) => {
      const returnedQty = returnedMap.get(item.id) ?? 0;
      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        returnedQty,
        returnableQty: item.quantity - returnedQty,
        rate: Number(item.rate),
        discount: Number(item.discount),
        total: Number(item.total),
        product: { id: item.product.id, name: item.product.name, productCode: item.product.sku },
        variant: item.variant
          ? {
              id: item.variant.id,
              size: item.variant.size,
              colour: item.variant.colour,
              productCode: item.variant.sku,
            }
          : null,
      };
    }),
  };
}

export type CreateSaleReturnInput = {
  invoiceId: number;
  items: ReturnLineInput[];
  refundMethod?: PurchasePaymentMethod;
  paymentAccountId?: number | null;
  /** Actual money refunded (≤ calculated return after discounts). */
  refundAmount?: number;
  refundToCash?: boolean;
  applyToUdhaar?: boolean;
  applyToUdhaarAmount?: number;
  note?: string | null;
  createdById: number;
};

export async function createSaleReturn(input: CreateSaleReturnInput) {
  const invoice = await loadReturnableInvoice(input.invoiceId);
  const lines = await resolveReturnLines(invoice, input.items);
  const refundMethod = input.refundMethod ?? PurchasePaymentMethod.CASH;
  const calculatedTotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (!(calculatedTotal > 0)) throw new AppError(400, 'Return total must be greater than zero');

  let refundAmount = calculatedTotal;
  if (input.refundAmount != null) {
    refundAmount = roundMoney(input.refundAmount);
    if (refundAmount < 0) throw new AppError(400, 'Refund amount cannot be negative');
    if (refundAmount > calculatedTotal + 0.01) {
      throw new AppError(400, `Refund cannot exceed calculated return Rs ${calculatedTotal}`);
    }
  }

  const returnId = await prisma.$transaction(async (tx) => {
    const revalidated = await resolveReturnLines(
      await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: {
          customer: { select: { id: true, name: true, accountId: true, currentBalance: true } },
          items: {
            include: {
              product: { select: { id: true, name: true } },
              variant: { select: { id: true, size: true, colour: true } },
            },
          },
        },
      }),
      input.items,
    );

    const totalAmount = roundMoney(revalidated.reduce((s, l) => s + l.lineTotal, 0));
    if (!(totalAmount > 0)) throw new AppError(400, 'Return total must be greater than zero');
    const refundFinal = roundMoney(Math.min(totalAmount, Math.max(0, refundAmount)));

    const saleReturn = await tx.saleReturn.create({
      data: {
        invoiceId: invoice.id,
        totalAmount,
        refundAmount: refundFinal,
        refundMethod,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        items: {
          create: revalidated.map((l) => ({
            invoiceItemId: l.invoiceItemId,
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
            rate: l.rate,
            lineTotal: l.lineTotal,
            costAtReturn: l.costAtReturn,
            condition: l.condition,
          })),
        },
      },
    });

    const sourceRef = String(saleReturn.id);
    await applyReturnStock(tx, revalidated, sourceRef, `Return ${invoice.invoiceNumber}`);

    const accounts = await ensureRetailSystemAccounts(tx);
    const refundResult = await buildRefundLegs(tx, {
      invoice,
      refundTotal: refundFinal,
      refundMethod,
      paymentAccountId: input.paymentAccountId,
      refundToCash: input.refundToCash,
      applyToUdhaar: input.applyToUdhaar,
      applyToUdhaarAmount: input.applyToUdhaarAmount,
    });
    const { legs } = buildReturnAccountingLegs(accounts, revalidated, refundResult.legs, refundFinal);

    await adjustInvoiceAfterReturn(
      tx,
      invoice,
      refundFinal,
      refundResult.customerCredit,
      refundResult.cashCredit,
    );

    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.SALE_RETURN,
      amount: refundFinal,
      date: new Date(),
      description: `Sale return ${invoice.invoiceNumber} — ${SALES_RETURN_ACCOUNT_NAME}`,
      sourceType: 'SALE_RETURN',
      sourceRef,
      createdById: input.createdById,
      legs,
    });

    return saleReturn.id;
  });

  return getSaleReturn(returnId);
}

export async function getSaleReturn(id: number) {
  const row = await prisma.saleReturn.findUnique({
    where: { id },
    include: {
      invoice: { select: { id: true, invoiceNumber: true, customerId: true } },
      items: {
        include: {
          invoiceItem: {
            select: {
              product: { select: { id: true, name: true, sku: true } },
              variant: { select: { id: true, size: true, colour: true, sku: true } },
            },
          },
        },
      },
      exchange: { select: { id: true } },
    },
  });
  if (!row) throw new AppError(404, 'Sale return not found');

  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    date: row.date,
    totalAmount: Number(row.totalAmount),
    refundAmount: Number(row.refundAmount),
    refundMethod: row.refundMethod,
    note: row.note,
    createdAt: row.createdAt,
    exchangeId: row.exchange?.id ?? null,
    items: row.items.map((i) => ({
      id: i.id,
      invoiceItemId: i.invoiceItemId,
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      rate: Number(i.rate),
      lineTotal: Number(i.lineTotal),
      costAtReturn: Number(i.costAtReturn),
      condition: i.condition,
      product: {
        id: i.invoiceItem.product.id,
        name: i.invoiceItem.product.name,
        productCode: i.invoiceItem.product.sku,
      },
      variant: i.invoiceItem.variant
        ? {
            id: i.invoiceItem.variant.id,
            size: i.invoiceItem.variant.size,
            colour: i.invoiceItem.variant.colour,
            productCode: i.invoiceItem.variant.sku,
          }
        : null,
    })),
  };
}

export type CreateExchangeInput = {
  invoiceId: number;
  returnItems: ReturnLineInput[];
  newItems: SaleItemInput[];
  paymentMethod?: PurchasePaymentMethod;
  paymentAccountId?: number | null;
  paidAmount?: number;
  refundToCash?: boolean;
  applyToUdhaar?: boolean;
  applyToUdhaarAmount?: number;
  note?: string | null;
  createdById: number;
};

export async function createExchange(input: CreateExchangeInput) {
  if (!input.newItems?.length) throw new AppError(400, 'Add at least one new item for the exchange');

  const invoice = await loadReturnableInvoice(input.invoiceId);
  const returnLines = await resolveReturnLines(invoice, input.returnItems);
  const newLines = await resolveSaleLines(prisma, input.newItems);

  const returnTotal = roundMoney(returnLines.reduce((s, l) => s + l.lineTotal, 0));
  const newSaleTotal = roundMoney(newLines.reduce((s, l) => s + l.lineTotal, 0));
  const netAmount = roundMoney(newSaleTotal - returnTotal);
  const paymentMethod = input.paymentMethod ?? PurchasePaymentMethod.CASH;

  if (netAmount > 0.001) {
    const paid = roundMoney(input.paidAmount ?? 0);
    if (paid + 0.01 < netAmount) {
      throw new AppError(400, `Customer must pay Rs ${netAmount} for this exchange`);
    }
  }

  const exchangeId = await prisma.$transaction(async (tx) => {
    const revalidatedReturn = await resolveReturnLines(
      await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: {
          customer: { select: { id: true, name: true, accountId: true, currentBalance: true } },
          items: {
            include: {
              product: { select: { id: true, name: true } },
              variant: { select: { id: true, size: true, colour: true } },
            },
          },
        },
      }),
      input.returnItems,
    );
    await resolveSaleLines(tx, input.newItems);

    const returnTotalTx = roundMoney(revalidatedReturn.reduce((s, l) => s + l.lineTotal, 0));
    const newLinesTx = await resolveSaleLines(tx, input.newItems);
    const newSaleTotalTx = roundMoney(newLinesTx.reduce((s, l) => s + l.lineTotal, 0));
    const netAmountTx = roundMoney(newSaleTotalTx - returnTotalTx);

    const saleReturn = await tx.saleReturn.create({
      data: {
        invoiceId: invoice.id,
        totalAmount: returnTotalTx,
        refundAmount: returnTotalTx,
        refundMethod: paymentMethod,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        items: {
          create: revalidatedReturn.map((l) => ({
            invoiceItemId: l.invoiceItemId,
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
            rate: l.rate,
            lineTotal: l.lineTotal,
            costAtReturn: l.costAtReturn,
            condition: l.condition,
          })),
        },
      },
    });

    const returnSourceRef = String(saleReturn.id);
    await applyReturnStock(tx, revalidatedReturn, returnSourceRef, `Exchange return ${invoice.invoiceNumber}`);

    const paidAmount = netAmountTx > 0 ? roundMoney(Math.min(netAmountTx, input.paidAmount ?? netAmountTx)) : 0;
    const refundedAmount = netAmountTx < 0 ? roundMoney(-netAmountTx) : 0;

    const exchange = await tx.exchange.create({
      data: {
        invoiceId: invoice.id,
        saleReturnId: saleReturn.id,
        returnTotal: returnTotalTx,
        newSaleTotal: newSaleTotalTx,
        netAmount: netAmountTx,
        paidAmount,
        refundedAmount,
        paymentMethod,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    const exchangeSourceRef = String(exchange.id);

    for (const line of newLinesTx) {
      const target =
        line.variantId != null
          ? { productId: line.productId, variantId: line.variantId }
          : { productId: line.productId };
      await adjustStockInTx(tx, target, line.quantity, StockMovementType.SALE, {
        note: `Exchange new sale — ${invoice.invoiceNumber}`,
        sourceType: 'EXCHANGE',
        sourceRef: exchangeSourceRef,
      });
    }

    await tx.exchangeItem.createMany({
      data: newLinesTx.map((l) => ({
        exchangeId: exchange.id,
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        rate: l.rate,
        discount: l.discount,
        lineTotal: l.lineTotal,
        costAtSale: l.costAtSale,
      })),
    });

    const accounts = await ensureRetailSystemAccounts(tx);
    const returnCost = roundMoney(revalidatedReturn.reduce((s, l) => s + l.costAtReturn, 0));
    const restockCost = roundMoney(
      revalidatedReturn
        .filter((l) => restocksInventory(l.condition))
        .reduce((s, l) => s + l.costAtReturn, 0),
    );
    const newCost = roundMoney(newLinesTx.reduce((s, l) => s + l.costAtSale * l.quantity, 0));

    const legs: { accountId: number; type: LedgerEntryType; amount: number }[] = [];

    if (returnTotalTx > 0) {
      legs.push({
        accountId: accounts.salesReturn.id,
        type: LedgerEntryType.DEBIT,
        amount: returnTotalTx,
      });
    }
    if (newSaleTotalTx > 0) {
      legs.push({
        accountId: accounts.saleRevenue.id,
        type: LedgerEntryType.CREDIT,
        amount: newSaleTotalTx,
      });
    }
    if (restockCost > 0) {
      legs.push({ accountId: accounts.inventory.id, type: LedgerEntryType.DEBIT, amount: restockCost });
      legs.push({ accountId: accounts.cogs.id, type: LedgerEntryType.CREDIT, amount: restockCost });
    }
    const damagedCost = roundMoney(returnCost - restockCost);
    if (damagedCost > 0) {
      legs.push({ accountId: accounts.damagedLoss.id, type: LedgerEntryType.DEBIT, amount: damagedCost });
      legs.push({ accountId: accounts.cogs.id, type: LedgerEntryType.CREDIT, amount: damagedCost });
    }
    if (newCost > 0) {
      legs.push({ accountId: accounts.cogs.id, type: LedgerEntryType.DEBIT, amount: newCost });
      legs.push({ accountId: accounts.inventory.id, type: LedgerEntryType.CREDIT, amount: newCost });
    }

    // Settle only the *net* cash/AR difference. Do not also post a full-return
    // refund or charge new items as udhaar — that double-counts and unbalances.
    let exchangeCustomerCredit = 0;
    if (netAmountTx > 0.001) {
      if (paidAmount > 0.001) {
        const paymentAccount = await resolvePaymentAccount(tx, paymentMethod, input.paymentAccountId);
        legs.push({
          accountId: paymentAccount.id,
          type: LedgerEntryType.DEBIT,
          amount: paidAmount,
        });
      }
      const stillOwed = roundMoney(netAmountTx - paidAmount);
      if (stillOwed > 0.001) {
        if (!invoice.customerId || !invoice.customer?.accountId) {
          throw new AppError(400, 'Customer is required when exchange balance is unpaid');
        }
        legs.push({
          accountId: invoice.customer.accountId,
          type: LedgerEntryType.DEBIT,
          amount: stillOwed,
        });
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentBalance: { increment: stillOwed } },
        });
      }
    } else if (netAmountTx < -0.001) {
      const netRefund = computeRefundSplit(invoice, -netAmountTx, {
        refundToCash: input.refundToCash,
        applyToUdhaar: input.applyToUdhaar,
        applyToUdhaarAmount: input.applyToUdhaarAmount,
      });
      exchangeCustomerCredit = netRefund.customerCredit;
      const netRefundLegs = await applyRefundLegs(
        tx,
        invoice,
        netRefund.customerCredit,
        netRefund.cashCredit,
        paymentMethod,
        input.paymentAccountId,
      );
      legs.push(...netRefundLegs);
    }

    await adjustInvoiceAfterExchange(
      tx,
      invoice,
      returnTotalTx,
      newSaleTotalTx,
      exchangeCustomerCredit,
      paidAmount,
    );

    const voucherAmount = roundMoney(Math.max(returnTotalTx, newSaleTotalTx, Math.abs(netAmountTx)));
    await createMultiLegVoucherInTx(tx, {
      type: VoucherType.EXCHANGE,
      amount: voucherAmount,
      date: new Date(),
      description: `Exchange on ${invoice.invoiceNumber}`,
      sourceType: 'EXCHANGE',
      sourceRef: exchangeSourceRef,
      createdById: input.createdById,
      legs,
    });

    return exchange.id;
  });

  return getExchange(exchangeId);
}

export async function getExchange(id: number) {
  const row = await prisma.exchange.findUnique({
    where: { id },
    include: {
      invoice: { select: { id: true, invoiceNumber: true } },
      saleReturn: {
        include: {
          items: {
            include: {
              invoiceItem: {
                select: {
                  product: { select: { id: true, name: true, sku: true } },
                  variant: { select: { id: true, size: true, colour: true, sku: true } },
                },
              },
            },
          },
        },
      },
      newItems: true,
    },
  });
  if (!row) throw new AppError(404, 'Exchange not found');

  const newProductIds = [...new Set(row.newItems.map((i) => i.productId))];
  const newVariantIds = [
    ...new Set(row.newItems.map((i) => i.variantId).filter((vid): vid is number => vid != null)),
  ];
  const [newProducts, newVariants] = await Promise.all([
    newProductIds.length
      ? prisma.product.findMany({
          where: { id: { in: newProductIds } },
          select: { id: true, name: true, sku: true },
        })
      : Promise.resolve([]),
    newVariantIds.length
      ? prisma.productVariant.findMany({
          where: { id: { in: newVariantIds } },
          select: { id: true, size: true, colour: true, sku: true },
        })
      : Promise.resolve([]),
  ]);
  const productById = new Map(newProducts.map((p) => [p.id, p]));
  const variantById = new Map(newVariants.map((v) => [v.id, v]));

  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    saleReturnId: row.saleReturnId,
    date: row.date,
    returnTotal: Number(row.returnTotal),
    newSaleTotal: Number(row.newSaleTotal),
    netAmount: Number(row.netAmount),
    paidAmount: Number(row.paidAmount),
    refundedAmount: Number(row.refundedAmount),
    paymentMethod: row.paymentMethod,
    note: row.note,
    createdAt: row.createdAt,
    returnItems: row.saleReturn.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      quantity: i.quantity,
      lineTotal: Number(i.lineTotal),
      condition: i.condition,
      product: {
        id: i.invoiceItem.product.id,
        name: i.invoiceItem.product.name,
        productCode: i.invoiceItem.product.sku,
      },
      variant: i.invoiceItem.variant
        ? {
            id: i.invoiceItem.variant.id,
            size: i.invoiceItem.variant.size,
            colour: i.invoiceItem.variant.colour,
            productCode: i.invoiceItem.variant.sku,
          }
        : null,
    })),
    newItems: row.newItems.map((i) => {
      const product = productById.get(i.productId);
      const variant = i.variantId != null ? variantById.get(i.variantId) ?? null : null;
      return {
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        rate: Number(i.rate),
        lineTotal: Number(i.lineTotal),
        product: product
          ? { id: product.id, name: product.name, productCode: product.sku }
          : { id: i.productId, name: `Product #${i.productId}`, productCode: '' },
        variant: variant
          ? {
              id: variant.id,
              size: variant.size,
              colour: variant.colour,
              productCode: variant.sku,
            }
          : null,
      };
    }),
  };
}

/** @internal exported for tests */
export { resolveReturnLines, restocksInventory };
