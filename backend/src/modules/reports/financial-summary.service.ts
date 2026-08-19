/**
 * FINANCIAL SUMMARY SERVICE
 * =========================
 * Single source of truth for all shop dashboard cards and profit-related reports.
 *
 * Every KPI that involves sales, cost, profit, cash, or inventory valuation MUST be
 * computed here — dashboard and report endpoints call these functions; they never
 * duplicate the formulas elsewhere.
 *
 * Key rules enforced:
 * - CANCELLED invoices/purchases are excluded from all totals.
 * - COGS uses historical costAtSale / costAtReturn snapshots — never current purchasePrice.
 * - Udhaar is counted as sale/profit when the invoice completes (remainingAmount at sale);
 *   later customer payment collection counts only as cash received, not new sales.
 * - Stock valuation (cost × stock, sale price × stock) is informational only — never
 *   included in Net Profit.
 * - Supplier payments are never counted as purchases.
 */

import { InvoiceStatus, Prisma, PurchaseStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { multiplyMoney, roundMoney, sumMoney, toNumber } from '../../utils/money';
import {
  dateFilter,
  localDateKey,
  resolveDateRange,
  resolvePreviousDateRange,
  type DateRangePreset,
  type ResolvedDateRange,
} from './date-range';

export type FinancialSummary = {
  range: ResolvedDateRange;
  grossSales: number;
  discounts: number;
  saleReturns: number;
  netSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  otherIncome: number;
  netProfit: number;
  cashReceived: number;
  udhaarSales: number;
  customerOutstanding: number;
  supplierOutstanding: number;
  stockCostValue: number;
  expectedSellingValue: number;
  potentialMarginOnUnsoldInventory: number;
  invoiceCount: number;
};

export type PurchasePeriodTotals = {
  today: number;
  month: number;
  year: number;
  lifetime: number;
};

export type MetricComparison = {
  current: number;
  previous: number;
  changePercent: number | null;
};

export type DashboardComparisons = {
  netSales: MetricComparison;
  netProfit: MetricComparison;
  grossSales: MetricComparison;
  cashReceived: MetricComparison;
  expenses: MetricComparison;
  invoiceCount: MetricComparison;
};

export type PaymentMethodBreakdownRow = {
  paymentMethod: string;
  invoiceCount: number;
  totalAmount: number;
  paidAmount: number;
};

export type SalesCollectionAccountRow = {
  accountName: string;
  amount: number;
};

export type SalesCollectionBreakdown = {
  totalCollected: number;
  cash: number;
  ePayment: number;
  udhaar: number;
  byMethod: PaymentMethodBreakdownRow[];
  byAccount: SalesCollectionAccountRow[];
};

export type DashboardPayload = FinancialSummary & {
  comparisons: DashboardComparisons | null;
  paymentMethodBreakdown: PaymentMethodBreakdownRow[];
  salesCollectionBreakdown: SalesCollectionBreakdown;
  purchases: PurchasePeriodTotals;
  lowStockCount: number;
  outOfStockCount: number;
  recentSales: {
    id: number;
    invoiceNumber: string;
    date: string;
    customerName: string | null;
    totalAmount: number;
    paymentMethod: string;
  }[];
  recentExpenses: {
    id: number;
    date: string;
    categoryName: string;
    description: string;
    amount: number;
  }[];
  lowStockProducts: {
    id: number;
    name: string;
    sku: string;
    currentStock: number;
    lowStockLimit: number;
    variantLabel: string | null;
  }[];
  topSellingProducts: {
    productId: number;
    name: string;
    sku: string;
    quantitySold: number;
    revenue: number;
  }[];
  salesChart: { date: string; netSales: number; invoiceCount: number }[];
};

type LineAgg = { gross: number; lineDiscounts: number; cogs: number };

async function aggregateInvoiceLines(from: Date | null, to: Date | null): Promise<LineAgg> {
  const dateCond = dateFilter(from, to);
  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        status: InvoiceStatus.ACTIVE,
        ...(dateCond ? { date: dateCond } : {}),
      },
    },
    select: { quantity: true, rate: true, discount: true, costAtSale: true },
  });

  let gross = 0;
  let lineDiscounts = 0;
  let cogs = 0;
  for (const row of items) {
    const qty = row.quantity;
    const rate = toNumber(row.rate);
    gross += multiplyMoney(rate, qty);
    lineDiscounts += toNumber(row.discount);
    cogs += multiplyMoney(toNumber(row.costAtSale), qty);
  }
  return { gross, lineDiscounts, cogs: roundMoney(cogs) };
}

async function aggregateExchangeLines(from: Date | null, to: Date | null): Promise<LineAgg> {
  const dateCond = dateFilter(from, to);
  const items = await prisma.exchangeItem.findMany({
    where: {
      exchange: dateCond ? { date: dateCond } : {},
    },
    select: { quantity: true, rate: true, discount: true, costAtSale: true },
  });

  let gross = 0;
  let lineDiscounts = 0;
  let cogs = 0;
  for (const row of items) {
    const qty = row.quantity;
    const rate = toNumber(row.rate);
    gross += multiplyMoney(rate, qty);
    lineDiscounts += toNumber(row.discount);
    cogs += multiplyMoney(toNumber(row.costAtSale), qty);
  }
  return { gross, lineDiscounts, cogs: roundMoney(cogs) };
}

async function aggregateInvoiceDiscounts(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);
  const agg = await prisma.invoice.aggregate({
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
    _sum: { discount: true },
  });
  return toNumber(agg._sum.discount ?? 0);
}

async function aggregateSaleReturns(from: Date | null, to: Date | null): Promise<{ value: number; cogsReversal: number }> {
  const dateCond = dateFilter(from, to);
  const [returnAgg, returnItems] = await Promise.all([
    prisma.saleReturn.aggregate({
      where: dateCond ? { date: dateCond } : {},
      _sum: { totalAmount: true },
    }),
    prisma.saleReturnItem.findMany({
      where: {
        saleReturn: dateCond ? { date: dateCond } : {},
      },
      select: { costAtReturn: true },
    }),
  ]);
  const cogsReversal = sumMoney(returnItems.map((r) => toNumber(r.costAtReturn)));
  return {
    value: toNumber(returnAgg._sum.totalAmount ?? 0),
    cogsReversal,
  };
}

async function aggregateExpenses(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);
  const agg = await prisma.expense.aggregate({
    where: dateCond ? { date: dateCond } : {},
    _sum: { amount: true },
  });
  return toNumber(agg._sum.amount ?? 0);
}

async function aggregateOtherIncome(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);
  const agg = await prisma.otherIncome.aggregate({
    where: dateCond ? { date: dateCond } : {},
    _sum: { amount: true },
  });
  return toNumber(agg._sum.amount ?? 0);
}

async function aggregateCashReceived(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);

  const [invoicePaid, customerPayments, exchangePaid] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        status: InvoiceStatus.ACTIVE,
        ...(dateCond ? { date: dateCond } : {}),
      },
      _sum: { paidAmount: true },
    }),
    prisma.customerPayment.aggregate({
      where: dateCond ? { date: dateCond } : {},
      _sum: { amount: true },
    }),
    prisma.exchange.aggregate({
      where: dateCond ? { date: dateCond } : {},
      _sum: { paidAmount: true },
    }),
  ]);

  return sumMoney([
    toNumber(invoicePaid._sum.paidAmount ?? 0),
    toNumber(customerPayments._sum.amount ?? 0),
    toNumber(exchangePaid._sum.paidAmount ?? 0),
  ]);
}

async function aggregateUdhaarSales(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);
  const agg = await prisma.invoice.aggregate({
    where: {
      status: InvoiceStatus.ACTIVE,
      remainingAmount: { gt: 0 },
      ...(dateCond ? { date: dateCond } : {}),
    },
    _sum: { remainingAmount: true },
  });
  return toNumber(agg._sum.remainingAmount ?? 0);
}

async function getCustomerOutstanding(): Promise<number> {
  const agg = await prisma.customer.aggregate({
    where: { isActive: true },
    _sum: { currentBalance: true },
  });
  return toNumber(agg._sum.currentBalance ?? 0);
}

async function getSupplierOutstanding(): Promise<number> {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true, accountId: { not: null } },
    select: { account: { select: { ledger: { select: { balance: true } } } } },
  });
  let total = 0;
  for (const s of suppliers) {
    const bal = s.account?.ledger ? toNumber(s.account.ledger.balance) : 0;
    if (bal < 0) total += roundMoney(-bal);
  }
  return roundMoney(total);
}

async function getStockValuation(): Promise<{ costValue: number; sellingValue: number }> {
  const products = await prisma.product.findMany({
    select: { currentStock: true, purchasePrice: true, salePrice: true },
  });
  let costValue = 0;
  let sellingValue = 0;
  for (const p of products) {
    costValue += multiplyMoney(toNumber(p.purchasePrice), p.currentStock);
    sellingValue += multiplyMoney(toNumber(p.salePrice), p.currentStock);
  }
  return { costValue: roundMoney(costValue), sellingValue: roundMoney(sellingValue) };
}

async function countInvoices(from: Date | null, to: Date | null): Promise<number> {
  const dateCond = dateFilter(from, to);
  return prisma.invoice.count({
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
  });
}

export function computeChangePercent(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return roundMoney(((current - previous) / Math.abs(previous)) * 100);
}

function buildComparison(current: number, previous: number): MetricComparison {
  return {
    current,
    previous,
    changePercent: computeChangePercent(current, previous),
  };
}

function buildDashboardComparisons(
  current: FinancialSummary,
  previous: FinancialSummary | null,
): DashboardComparisons | null {
  if (!previous) return null;
  return {
    netSales: buildComparison(current.netSales, previous.netSales),
    netProfit: buildComparison(current.netProfit, previous.netProfit),
    grossSales: buildComparison(current.grossSales, previous.grossSales),
    cashReceived: buildComparison(current.cashReceived, previous.cashReceived),
    expenses: buildComparison(current.expenses, previous.expenses),
    invoiceCount: buildComparison(current.invoiceCount, previous.invoiceCount),
  };
}

async function getPaymentMethodBreakdown(from: Date | null, to: Date | null): Promise<PaymentMethodBreakdownRow[]> {
  const dateCond = dateFilter(from, to);
  const grouped = await prisma.invoice.groupBy({
    by: ['paymentMethod'],
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
    _sum: { totalAmount: true, paidAmount: true },
    _count: { id: true },
  });

  return grouped.map((g) => ({
    paymentMethod: g.paymentMethod,
    invoiceCount: g._count.id,
    totalAmount: toNumber(g._sum.totalAmount ?? 0),
    paidAmount: toNumber(g._sum.paidAmount ?? 0),
  }));
}

/** How sales money was collected — cash vs e-payment; landed lines always sum to collected. */
export async function getSalesCollectionBreakdown(
  from: Date | null,
  to: Date | null,
): Promise<SalesCollectionBreakdown> {
  const dateCond = dateFilter(from, to);
  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
    select: {
      id: true,
      paymentMethod: true,
      paidAmount: true,
      remainingAmount: true,
    },
  });

  let cash = 0;
  let ePayment = 0;
  let udhaar = 0;
  const invoiceIds: string[] = [];

  for (const inv of invoices) {
    const paid = toNumber(inv.paidAmount);
    const rem = toNumber(inv.remainingAmount);
    udhaar += rem;
    const method = inv.paymentMethod.toUpperCase();
    if (method === 'CASH') cash += paid;
    else if (method !== 'UDHAAR' && paid > 0) {
      ePayment += paid;
      invoiceIds.push(String(inv.id));
    }
  }

  cash = roundMoney(cash);
  ePayment = roundMoney(ePayment);
  udhaar = roundMoney(udhaar);

  // Attribute e-payment to the Bank wallet used on each SALE voucher (same invoices only).
  const ePayMap = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const vouchers = await prisma.voucher.findMany({
      where: {
        type: 'SALE',
        status: 'ACTIVE',
        sourceType: 'SALE',
        sourceRef: { in: invoiceIds },
      },
      select: {
        sourceRef: true,
        ledgerEntries: {
          where: { isReversal: false, type: 'DEBIT' },
          select: {
            amount: true,
            ledger: {
              select: {
                account: {
                  select: {
                    name: true,
                    category: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const voucher of vouchers) {
      for (const entry of voucher.ledgerEntries) {
        const account = entry.ledger.account;
        const cat = account.category?.name?.trim().toLowerCase() ?? '';
        if (cat !== 'bank') continue;
        const name = account.name;
        ePayMap.set(name, roundMoney((ePayMap.get(name) ?? 0) + toNumber(entry.amount)));
      }
    }
  }

  let ePayRows = [...ePayMap.entries()]
    .map(([accountName, amount]) => ({ accountName, amount }))
    .sort((a, b) => b.amount - a.amount);
  const ePaySum = roundMoney(ePayRows.reduce((s, r) => s + r.amount, 0));

  // Keep landed total identical to collected: scale or fall back to a single E-payment line.
  if (ePayment > 0 && ePaySum > 0 && Math.abs(ePaySum - ePayment) > 0.02) {
    const factor = ePayment / ePaySum;
    ePayRows = ePayRows.map((r) => ({
      accountName: r.accountName,
      amount: roundMoney(r.amount * factor),
    }));
    const adjusted = roundMoney(ePayRows.reduce((s, r) => s + r.amount, 0));
    const drift = roundMoney(ePayment - adjusted);
    if (Math.abs(drift) >= 0.01 && ePayRows[0]) {
      ePayRows[0] = { ...ePayRows[0], amount: roundMoney(ePayRows[0].amount + drift) };
    }
  } else if (ePayment > 0 && ePayRows.length === 0) {
    ePayRows = [{ accountName: 'E-payment', amount: ePayment }];
  }

  const byAccount: SalesCollectionAccountRow[] = [];
  if (cash > 0) byAccount.push({ accountName: 'Cash', amount: cash });
  byAccount.push(...ePayRows);

  const byMethod = await getPaymentMethodBreakdown(from, to);
  const totalCollected = roundMoney(cash + ePayment);

  return {
    totalCollected,
    cash,
    ePayment,
    udhaar,
    byMethod,
    byAccount,
  };
}

/** Core profit/sales summary for any date range. */
export async function getFinancialSummary(
  preset: DateRangePreset,
  fromDate?: string,
  toDate?: string,
): Promise<FinancialSummary> {
  const range = resolveDateRange(preset, fromDate, toDate);
  const { from, to } = range;

  const [invoiceLines, exchangeLines, invoiceDiscounts, returns, expenses, otherIncome, cashReceived, udhaarSales, customerOutstanding, supplierOutstanding, stockVal, invoiceCount] =
    await Promise.all([
      aggregateInvoiceLines(from, to),
      aggregateExchangeLines(from, to),
      aggregateInvoiceDiscounts(from, to),
      aggregateSaleReturns(from, to),
      aggregateExpenses(from, to),
      aggregateOtherIncome(from, to),
      aggregateCashReceived(from, to),
      aggregateUdhaarSales(from, to),
      getCustomerOutstanding(),
      getSupplierOutstanding(),
      getStockValuation(),
      countInvoices(from, to),
    ]);

  const grossSales = roundMoney(invoiceLines.gross + exchangeLines.gross);
  const discounts = roundMoney(invoiceLines.lineDiscounts + exchangeLines.lineDiscounts + invoiceDiscounts);
  const saleReturns = returns.value;
  const netSales = roundMoney(grossSales - discounts - saleReturns);
  const costOfGoodsSold = roundMoney(invoiceLines.cogs + exchangeLines.cogs - returns.cogsReversal);
  const grossProfit = roundMoney(netSales - costOfGoodsSold);
  const netProfit = roundMoney(grossProfit - expenses + otherIncome);

  return {
    range,
    grossSales,
    discounts,
    saleReturns,
    netSales,
    costOfGoodsSold,
    grossProfit,
    expenses,
    otherIncome,
    netProfit,
    cashReceived,
    udhaarSales,
    customerOutstanding,
    supplierOutstanding,
    stockCostValue: stockVal.costValue,
    expectedSellingValue: stockVal.sellingValue,
    potentialMarginOnUnsoldInventory: roundMoney(stockVal.sellingValue - stockVal.costValue),
    invoiceCount,
  };
}

/** Purchase totals by period — never mixed into sales figures. */
export async function getPurchasePeriodTotals(now: Date = new Date()): Promise<PurchasePeriodTotals> {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const yearStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);

  const activeWhere: Prisma.PurchaseWhereInput = {
    status: { not: PurchaseStatus.CANCELLED },
  };

  const [todayAgg, monthAgg, yearAgg, lifetimeAgg] = await Promise.all([
    prisma.purchase.aggregate({
      where: { ...activeWhere, date: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.purchase.aggregate({
      where: { ...activeWhere, date: { gte: monthStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.purchase.aggregate({
      where: { ...activeWhere, date: { gte: yearStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.purchase.aggregate({
      where: activeWhere,
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    today: toNumber(todayAgg._sum.totalAmount ?? 0),
    month: toNumber(monthAgg._sum.totalAmount ?? 0),
    year: toNumber(yearAgg._sum.totalAmount ?? 0),
    lifetime: toNumber(lifetimeAgg._sum.totalAmount ?? 0),
  };
}

async function getLowStockThreshold(): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: 1 },
    select: { lowStockLimit: true },
  });
  return settings?.lowStockLimit ?? 5;
}

async function getStockCounts(): Promise<{ lowStockCount: number; outOfStockCount: number }> {
  const threshold = await getLowStockThreshold();
  const products = await prisma.product.findMany({
    select: {
      currentStock: true,
      lowStockLimit: true,
      variants: { select: { currentStock: true } },
    },
  });
  let lowStockCount = 0;
  let outOfStockCount = 0;
  for (const p of products) {
    const limit = p.lowStockLimit ?? threshold;
    if (p.variants.length > 0) {
      if (p.variants.some((v) => v.currentStock <= 0)) outOfStockCount++;
      // Low-stock alerts include out-of-stock (≤ limit, including 0).
      if (p.variants.some((v) => v.currentStock <= limit)) lowStockCount++;
    } else {
      if (p.currentStock <= 0) outOfStockCount++;
      if (p.currentStock <= limit) lowStockCount++;
    }
  }
  return { lowStockCount, outOfStockCount };
}

async function getRecentSales(limit = 8) {
  const rows = await prisma.invoice.findMany({
    where: { status: InvoiceStatus.ACTIVE },
    orderBy: { date: 'desc' },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      totalAmount: true,
      paymentMethod: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    date: r.date.toISOString(),
    customerName: r.customer?.name ?? null,
    totalAmount: toNumber(r.totalAmount),
    paymentMethod: r.paymentMethod,
  }));
}

async function getRecentExpenses(limit = 8) {
  const rows = await prisma.expense.findMany({
    orderBy: { date: 'desc' },
    take: limit,
    select: {
      id: true,
      date: true,
      description: true,
      amount: true,
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    categoryName: r.category.name,
    description: r.description,
    amount: toNumber(r.amount),
  }));
}

async function getLowStockProducts(limit = 15) {
  const threshold = await getLowStockThreshold();
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      currentStock: true,
      lowStockLimit: true,
      variants: { select: { size: true, colour: true, currentStock: true } },
    },
    orderBy: { currentStock: 'asc' },
    take: 200,
  });

  type LowRow = {
    id: number;
    name: string;
    sku: string;
    currentStock: number;
    lowStockLimit: number;
    variantLabel: string | null;
  };
  const rows: LowRow[] = [];

  for (const p of products) {
    const lowStockLimit = p.lowStockLimit ?? threshold;
    if (p.variants.length > 0) {
      for (const v of p.variants) {
        if (v.currentStock > lowStockLimit) continue;
        const variantLabel = [v.size, v.colour].filter(Boolean).join('/') || null;
        rows.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          currentStock: v.currentStock,
          lowStockLimit,
          variantLabel,
        });
      }
    } else if (p.currentStock <= lowStockLimit) {
      rows.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        currentStock: p.currentStock,
        lowStockLimit,
        variantLabel: null,
      });
    }
  }

  return rows.sort((a, b) => a.currentStock - b.currentStock).slice(0, limit);
}

async function getTopSellingProducts(from: Date | null, to: Date | null, limit = 5) {
  const dateCond = dateFilter(from, to);
  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        status: InvoiceStatus.ACTIVE,
        ...(dateCond ? { date: dateCond } : {}),
      },
    },
    select: {
      productId: true,
      quantity: true,
      total: true,
      product: { select: { name: true, sku: true } },
    },
  });

  const map = new Map<number, { name: string; sku: string; qty: number; revenue: number }>();
  for (const row of items) {
    const cur = map.get(row.productId) ?? {
      name: row.product.name,
      sku: row.product.sku,
      qty: 0,
      revenue: 0,
    };
    cur.qty += row.quantity;
    cur.revenue += toNumber(row.total);
    map.set(row.productId, cur);
  }

  return [...map.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, limit)
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      sku: v.sku,
      quantitySold: v.qty,
      revenue: roundMoney(v.revenue),
    }));
}

async function getSalesChart(from: Date | null, to: Date | null) {
  const dateCond = dateFilter(from, to);
  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
    select: { date: true, totalAmount: true },
    orderBy: { date: 'asc' },
  });

  const byDay = new Map<string, { netSales: number; invoiceCount: number }>();
  for (const inv of invoices) {
    const key = localDateKey(inv.date);
    const cur = byDay.get(key) ?? { netSales: 0, invoiceCount: 0 };
    cur.netSales += toNumber(inv.totalAmount);
    cur.invoiceCount++;
    byDay.set(key, cur);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      netSales: roundMoney(v.netSales),
      invoiceCount: v.invoiceCount,
    }));
}

/** Full dashboard payload — all cards, lists, and chart data. */
export async function getDashboardPayload(
  preset: DateRangePreset,
  fromDate?: string,
  toDate?: string,
): Promise<DashboardPayload> {
  const range = resolveDateRange(preset, fromDate, toDate);
  const prevRange = resolvePreviousDateRange(range);
  const prevFrom = prevRange?.from ? localDateKey(prevRange.from) : undefined;
  const prevTo = prevRange?.to ? localDateKey(prevRange.to) : undefined;

  const [summary, prevSummary, purchases, stockCounts, recentSales, recentExpenses, lowStockProducts, topSellingProducts, salesChart, paymentMethodBreakdown, salesCollectionBreakdown] =
    await Promise.all([
      getFinancialSummary(preset, fromDate, toDate),
      prevRange ? getFinancialSummary('custom', prevFrom, prevTo) : Promise.resolve(null),
      getPurchasePeriodTotals(),
      getStockCounts(),
      getRecentSales(),
      getRecentExpenses(),
      getLowStockProducts(),
      getTopSellingProducts(range.from, range.to),
      getSalesChart(range.from, range.to),
      getPaymentMethodBreakdown(range.from, range.to),
      getSalesCollectionBreakdown(range.from, range.to),
    ]);

  const comparisons = buildDashboardComparisons(summary, prevSummary);

  return {
    ...summary,
    comparisons,
    paymentMethodBreakdown,
    salesCollectionBreakdown,
    purchases,
    ...stockCounts,
    recentSales,
    recentExpenses,
    lowStockProducts,
    topSellingProducts,
    salesChart,
  };
}

/** Product-wise profit for a date range — uses historical costAtSale. */
export async function getProductWiseProfit(from: Date | null, to: Date | null) {
  const dateCond = dateFilter(from, to);
  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: { status: InvoiceStatus.ACTIVE, ...(dateCond ? { date: dateCond } : {}) },
    },
    select: {
      productId: true,
      quantity: true,
      total: true,
      costAtSale: true,
      product: { select: { name: true, sku: true, category: { select: { name: true } } } },
    },
  });

  const map = new Map<
    number,
    { name: string; sku: string; category: string | null; revenue: number; cogs: number; qty: number }
  >();
  for (const row of items) {
    const cur = map.get(row.productId) ?? {
      name: row.product.name,
      sku: row.product.sku,
      category: row.product.category?.name ?? null,
      revenue: 0,
      cogs: 0,
      qty: 0,
    };
    cur.qty += row.quantity;
    cur.revenue += toNumber(row.total);
    cur.cogs += multiplyMoney(toNumber(row.costAtSale), row.quantity);
    map.set(row.productId, cur);
  }

  // Subtract returns
  const returnItems = await prisma.saleReturnItem.findMany({
    where: { saleReturn: dateCond ? { date: dateCond } : {} },
    select: {
      productId: true,
      quantity: true,
      lineTotal: true,
      costAtReturn: true,
      invoiceItem: { select: { product: { select: { name: true, sku: true, category: { select: { name: true } } } } } },
    },
  });
  for (const row of returnItems) {
    const pid = row.productId;
    const cur = map.get(pid) ?? {
      name: row.invoiceItem.product.name,
      sku: row.invoiceItem.product.sku,
      category: row.invoiceItem.product.category?.name ?? null,
      revenue: 0,
      cogs: 0,
      qty: 0,
    };
    cur.qty -= row.quantity;
    cur.revenue -= toNumber(row.lineTotal);
    cur.cogs -= toNumber(row.costAtReturn);
    map.set(pid, cur);
  }

  return [...map.entries()].map(([productId, v]) => ({
    productId,
    name: v.name,
    sku: v.sku,
    categoryName: v.category,
    quantitySold: v.qty,
    revenue: roundMoney(v.revenue),
    costOfGoodsSold: roundMoney(v.cogs),
    grossProfit: roundMoney(v.revenue - v.cogs),
  }));
}

/** Invoice-wise profit — historical cost per invoice line. */
export async function getInvoiceWiseProfit(from: Date | null, to: Date | null) {
  const dateCond = dateFilter(from, to);
  const invoices = await prisma.invoice.findMany({
    where: { status: InvoiceStatus.ACTIVE, ...(dateCond ? { date: dateCond } : {}) },
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      totalAmount: true,
      customer: { select: { name: true } },
      items: { select: { total: true, costAtSale: true, quantity: true } },
    },
    orderBy: { date: 'desc' },
  });

  return invoices.map((inv) => {
    const revenue = toNumber(inv.totalAmount);
    const cogs = sumMoney(inv.items.map((i) => multiplyMoney(toNumber(i.costAtSale), i.quantity)));
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date.toISOString(),
      customerName: inv.customer?.name ?? null,
      netSales: revenue,
      costOfGoodsSold: cogs,
      grossProfit: roundMoney(revenue - cogs),
    };
  });
}

export { resolveDateRange, resolvePreviousDateRange, type DateRangePreset, type ResolvedDateRange };
