import {
  InvoiceStatus,
  Prisma,
  PurchaseStatus,
  SalePaymentMethod,
  StockMovementType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { multiplyMoney, roundMoney, toNumber } from '../../utils/money';
import { dateFilter, paginateParams, resolveDateRange, type DateRangePreset } from './date-range';
import {
  getFinancialSummary,
  getInvoiceWiseProfit,
  getProductWiseProfit,
  getPurchasePeriodTotals,
} from './financial-summary.service';

type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function paginated<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function getLowStockThreshold() {
  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  return settings?.lowStockLimit ?? 5;
}

// ─── Sales reports ───────────────────────────────────────────────────────────

export async function reportDailySales(params: {
  fromDate?: string;
  toDate?: string;
  preset?: DateRangePreset;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? (params.fromDate && params.toDate ? 'custom' : 'today');
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  const dateCond = dateFilter(range.from, range.to);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.ACTIVE,
      ...(dateCond ? { date: dateCond } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      subtotal: true,
      discount: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      paymentMethod: true,
      customer: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  });

  const byDay = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = inv.date.toISOString().slice(0, 10);
    const list = byDay.get(key) ?? [];
    list.push(inv);
    byDay.set(key, list);
  }

  const rows = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, invs]) => ({
      date,
      invoiceCount: invs.length,
      grossSales: roundMoney(invs.reduce((s, i) => s + toNumber(i.subtotal) + toNumber(i.discount), 0)),
      discounts: roundMoney(invs.reduce((s, i) => s + toNumber(i.discount), 0)),
      netSales: roundMoney(invs.reduce((s, i) => s + toNumber(i.totalAmount), 0)),
      cashReceived: roundMoney(invs.reduce((s, i) => s + toNumber(i.paidAmount), 0)),
    }));

  return paginated(rows, page, pageSize);
}

export async function reportSalesDateRange(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.ACTIVE,
    ...(dateCond ? { date: dateCond } : {}),
  };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { invoiceNumber: { contains: q } },
      { customer: { name: { contains: q } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        paymentMethod: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      date: r.date.toISOString(),
      customerName: r.customer?.name ?? null,
      totalAmount: toNumber(r.totalAmount),
      paidAmount: toNumber(r.paidAmount),
      remainingAmount: toNumber(r.remainingAmount),
      paymentMethod: r.paymentMethod,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: await getFinancialSummary(preset, params.fromDate, params.toDate),
  };
}

export async function reportProductProfit(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  let rows = await getProductWiseProfit(range.from, range.to);
  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase();
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => b.grossProfit - a.grossProfit);
  return { ...paginated(rows, page, pageSize), summary: await getFinancialSummary(preset, params.fromDate, params.toDate) };
}

export async function reportCategoryProfit(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  const products = await getProductWiseProfit(range.from, range.to);

  const map = new Map<string, { revenue: number; cogs: number; qty: number }>();
  for (const p of products) {
    const cat = p.categoryName ?? 'Uncategorised';
    const cur = map.get(cat) ?? { revenue: 0, cogs: 0, qty: 0 };
    cur.revenue += p.revenue;
    cur.cogs += p.costOfGoodsSold;
    cur.qty += p.quantitySold;
    map.set(cat, cur);
  }

  const rows = [...map.entries()]
    .map(([categoryName, v]) => ({
      categoryName,
      quantitySold: v.qty,
      revenue: roundMoney(v.revenue),
      costOfGoodsSold: roundMoney(v.cogs),
      grossProfit: roundMoney(v.revenue - v.cogs),
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit);

  return { ...paginated(rows, page, pageSize), summary: await getFinancialSummary(preset, params.fromDate, params.toDate) };
}

export async function reportInvoiceProfit(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  let rows = await getInvoiceWiseProfit(range.from, range.to);
  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.invoiceNumber.toLowerCase().includes(q) ||
        (r.customerName?.toLowerCase().includes(q) ?? false),
    );
  }
  return { ...paginated(rows, page, pageSize), summary: await getFinancialSummary(preset, params.fromDate, params.toDate) };
}

export async function reportUdhaarSales(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.ACTIVE,
    remainingAmount: { gt: 0 },
    ...(dateCond ? { date: dateCond } : {}),
  };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { invoiceNumber: { contains: q } },
      { customer: { name: { contains: q } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      date: r.date.toISOString(),
      customerName: r.customer?.name ?? null,
      customerPhone: r.customer?.phone ?? null,
      totalAmount: toNumber(r.totalAmount),
      paidAmount: toNumber(r.paidAmount),
      udhaarAmount: toNumber(r.remainingAmount),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportPaymentMethodBreakdown(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);

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

export async function reportSalesCollectionBreakdown(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
}) {
  const { getSalesCollectionBreakdown } = await import('./financial-summary.service');
  const preset = params.preset ?? 'today';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const breakdown = await getSalesCollectionBreakdown(range.from, range.to);
  return { range, ...breakdown };
}

export async function reportReturnsExchanges(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where = dateCond ? { date: dateCond } : {};

  const [returnTotal, returns, exchangeTotal, exchanges] = await Promise.all([
    prisma.saleReturn.count({ where }),
    prisma.saleReturn.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        totalAmount: true,
        refundAmount: true,
        refundMethod: true,
        invoice: { select: { invoiceNumber: true } },
        exchange: { select: { id: true } },
      },
    }),
    prisma.exchange.count({ where }),
    prisma.exchange.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 50,
      select: {
        id: true,
        date: true,
        returnTotal: true,
        newSaleTotal: true,
        netAmount: true,
        invoice: { select: { invoiceNumber: true } },
      },
    }),
  ]);

  return {
    returns: {
      items: returns.map((r) => ({
        id: r.id,
        date: r.date.toISOString(),
        invoiceNumber: r.invoice.invoiceNumber,
        totalAmount: toNumber(r.totalAmount),
        refundAmount: toNumber(r.refundAmount),
        refundMethod: r.refundMethod,
        isExchange: r.exchange != null,
      })),
      total: returnTotal,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(returnTotal / pageSize)),
    },
    exchanges: exchanges.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      invoiceNumber: e.invoice.invoiceNumber,
      returnTotal: toNumber(e.returnTotal),
      newSaleTotal: toNumber(e.newSaleTotal),
      netAmount: toNumber(e.netAmount),
    })),
    exchangeTotal,
  };
}

// ─── Stock reports ───────────────────────────────────────────────────────────

export async function reportCurrentStock(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);
  const where: Prisma.ProductWhereInput = { isActive: true };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q } },
      { sku: { contains: q } },
      { barcode: { contains: q } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip,
      take,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        currentStock: true,
        purchasePrice: true,
        salePrice: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryName: p.category?.name ?? null,
      currentStock: p.currentStock,
      costValue: multiplyMoney(toNumber(p.purchasePrice), p.currentStock),
      sellingValue: multiplyMoney(toNumber(p.salePrice), p.currentStock),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportLowStock(params: { page?: number; pageSize?: number; search?: string }) {
  const threshold = await getLowStockThreshold();
  const all = await reportCurrentStock({ ...params, pageSize: 500, page: 1 });
  const filtered = all.items.filter((p) => p.currentStock <= threshold);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  const result = paginated(filtered, page, pageSize);
  return {
    ...result,
    lowStockLimit: threshold,
    emptyMessage:
      filtered.length === 0
        ? `Nothing is low stock. No products are at or below your limit of ${threshold}.`
        : undefined,
  };
}

export async function reportOutOfStock(params: { page?: number; pageSize?: number; search?: string }) {
  const all = await reportCurrentStock({ ...params, pageSize: 500, page: 1 });
  const filtered = all.items.filter((p) => p.currentStock <= 0);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  return paginated(filtered, page, pageSize);
}

export async function reportDamagedStock(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.StockMovementWhereInput = {
    type: StockMovementType.DAMAGED,
    ...(dateCond ? { createdAt: dateCond } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        quantity: true,
        note: true,
        createdAt: true,
        product: { select: { name: true, sku: true } },
      },
    }),
  ]);

  return {
    items: items.map((m) => ({
      id: m.id,
      date: m.createdAt.toISOString(),
      productName: m.product.name,
      sku: m.product.sku,
      quantity: m.quantity,
      note: m.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportStockMovements(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  type?: StockMovementType;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.StockMovementWhereInput = {
    ...(dateCond ? { createdAt: dateCond } : {}),
    ...(params.type ? { type: params.type } : {}),
  };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.product = {
      OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }],
    };
  }

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        quantity: true,
        note: true,
        createdAt: true,
        product: { select: { name: true, sku: true } },
      },
    }),
  ]);

  return {
    items: items.map((m) => ({
      id: m.id,
      date: m.createdAt.toISOString(),
      type: m.type,
      productName: m.product.name,
      sku: m.product.sku,
      quantity: m.quantity,
      note: m.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportStockValuation() {
  const summary = await getFinancialSummary('lifetime');
  const stock = await reportCurrentStock({ page: 1, pageSize: 100 });
  return {
    stockCostValue: summary.stockCostValue,
    expectedSellingValue: summary.expectedSellingValue,
    potentialMarginOnUnsoldInventory: summary.potentialMarginOnUnsoldInventory,
    note: 'Potential margin on unsold inventory — not actual profit',
    topItems: stock.items.slice(0, 20),
  };
}

// ─── Purchase / Supplier reports ─────────────────────────────────────────────

export async function reportPurchases(params: {
  period?: 'today' | 'month' | 'year' | 'lifetime';
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const period = params.period ?? 'month';
  const totals = await getPurchasePeriodTotals();
  const now = new Date();
  let dateCond: Prisma.DateTimeFilter | undefined;
  if (period === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    dateCond = { gte: s, lte: now };
  } else if (period === 'month') {
    dateCond = { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: now };
  } else if (period === 'year') {
    dateCond = { gte: new Date(now.getFullYear(), 0, 1), lte: now };
  }

  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);
  const where: Prisma.PurchaseWhereInput = {
    status: { not: PurchaseStatus.CANCELLED },
    ...(dateCond ? { date: dateCond } : {}),
  };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { supplierInvoiceNumber: { contains: q } },
      { supplier: { name: { contains: q } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        paymentMethod: true,
        supplier: { select: { name: true } },
      },
    }),
  ]);

  return {
    period,
    periodTotal: totals[period],
    items: items.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      supplierName: p.supplier.name,
      totalAmount: toNumber(p.totalAmount),
      paidAmount: toNumber(p.paidAmount),
      remainingAmount: toNumber(p.remainingAmount),
      paymentMethod: p.paymentMethod,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportSupplierPurchases(params: {
  supplierId?: number;
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.PurchaseWhereInput = {
    status: { not: PurchaseStatus.CANCELLED },
    ...(dateCond ? { date: dateCond } : {}),
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        totalAmount: true,
        supplier: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      supplierId: p.supplier.id,
      supplierName: p.supplier.name,
      totalAmount: toNumber(p.totalAmount),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportSupplierOutstanding(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const { page, pageSize } = paginateParams(params.page, params.pageSize);
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    include: { account: { include: { ledger: true } } },
    orderBy: { name: 'asc' },
  });

  let rows = suppliers
    .map((s) => {
      const bal = s.account?.ledger ? toNumber(s.account.ledger.balance) : 0;
      const payable = bal < 0 ? roundMoney(-bal) : 0;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        payable,
      };
    })
    .filter((s) => s.payable > 0);

  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase();
    rows = rows.filter((s) => s.name.toLowerCase().includes(q) || s.phone.includes(q));
  }

  return paginated(rows, page, pageSize);
}

export async function reportSupplierPayments(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.SupplierPaymentWhereInput = dateCond ? { date: dateCond } : {};
  if (params.search?.trim()) {
    where.supplier = { name: { contains: params.search.trim() } };
  }

  const [total, items] = await Promise.all([
    prisma.supplierPayment.count({ where }),
    prisma.supplierPayment.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        amount: true,
        paymentMethod: true,
        note: true,
        supplier: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      supplierName: p.supplier.name,
      amount: toNumber(p.amount),
      paymentMethod: p.paymentMethod,
      note: p.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportPurchaseReturns(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where = dateCond ? { date: dateCond } : {};

  const [total, items] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        totalAmount: true,
        note: true,
        purchase: { select: { supplier: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      supplierName: r.purchase.supplier.name,
      totalAmount: toNumber(r.totalAmount),
      note: r.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ─── Customer reports ─────────────────────────────────────────────────────────

export async function reportCustomerBalances(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);
  const where: Prisma.CustomerWhereInput = { isActive: true };
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [{ name: { contains: q } }, { phone: { contains: q } }];
  }

  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      skip,
      take,
      orderBy: { currentBalance: 'desc' },
      select: { id: true, name: true, phone: true, currentBalance: true },
    }),
  ]);

  return {
    items: items.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      balance: toNumber(c.currentBalance),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportCustomerPayments(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.CustomerPaymentWhereInput = dateCond ? { date: dateCond } : {};
  if (params.search?.trim()) {
    where.customer = { name: { contains: params.search.trim() } };
  }

  const [total, items] = await Promise.all([
    prisma.customerPayment.count({ where }),
    prisma.customerPayment.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        amount: true,
        paymentMethod: true,
        note: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      customerName: p.customer.name,
      amount: toNumber(p.amount),
      paymentMethod: p.paymentMethod,
      note: p.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function reportCustomerPurchases(params: {
  customerId?: number;
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.ACTIVE,
    ...(dateCond ? { date: dateCond } : {}),
    ...(params.customerId ? { customerId: params.customerId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        customer: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    items: items.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      date: i.date.toISOString(),
      customerName: i.customer?.name ?? null,
      totalAmount: toNumber(i.totalAmount),
      paidAmount: toNumber(i.paidAmount),
      remainingAmount: toNumber(i.remainingAmount),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ─── Expense reports ──────────────────────────────────────────────────────────

export async function reportExpensesDaily(params: {
  fromDate: string;
  toDate: string;
  page?: number;
  pageSize?: number;
}) {
  const from = new Date(params.fromDate);
  const to = new Date(params.toDate);
  to.setHours(23, 59, 59, 999);
  const { page, pageSize } = paginateParams(params.page, params.pageSize);

  const expenses = await prisma.expense.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true, amount: true, category: { select: { name: true } } },
  });

  const byDay = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const key = e.date.toISOString().slice(0, 10);
    const cur = byDay.get(key) ?? { total: 0, count: 0 };
    cur.total += toNumber(e.amount);
    cur.count++;
    byDay.set(key, cur);
  }

  const rows = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, v]) => ({ date, expenseCount: v.count, totalAmount: roundMoney(v.total) }));

  return paginated(rows, page, pageSize);
}

export async function reportExpensesRange(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where: Prisma.ExpenseWhereInput = dateCond ? { date: dateCond } : {};
  if (params.search?.trim()) {
    where.OR = [
      { description: { contains: params.search.trim() } },
      { category: { name: { contains: params.search.trim() } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        paymentMethod: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      categoryName: e.category.name,
      description: e.description,
      amount: toNumber(e.amount),
      paymentMethod: e.paymentMethod,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: await getFinancialSummary(preset, params.fromDate, params.toDate),
  };
}

export async function reportExpensesByCategory(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);

  const grouped = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: dateCond ? { date: dateCond } : {},
    _sum: { amount: true },
    _count: { id: true },
  });

  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(categories.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => ({
      categoryName: nameMap.get(g.categoryId) ?? 'Unknown',
      expenseCount: g._count.id,
      totalAmount: toNumber(g._sum.amount ?? 0),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export async function reportOtherIncome(params: {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const preset = params.preset ?? 'month';
  const range = resolveDateRange(preset, params.fromDate, params.toDate);
  const dateCond = dateFilter(range.from, range.to);
  const { page, pageSize, skip, take } = paginateParams(params.page, params.pageSize);

  const where = dateCond ? { date: dateCond } : {};

  const [total, items] = await Promise.all([
    prisma.otherIncome.count({ where }),
    prisma.otherIncome.findMany({
      where,
      skip,
      take,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        paymentMethod: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: items.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      categoryName: e.category.name,
      description: e.description,
      amount: toNumber(e.amount),
      paymentMethod: e.paymentMethod,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export { getFinancialSummary, getDashboardPayload, getPurchasePeriodTotals } from './financial-summary.service';
