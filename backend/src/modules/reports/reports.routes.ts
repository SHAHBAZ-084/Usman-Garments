import { Router } from 'express';
import { StockMovementType } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param } from '../../utils/helpers';
import {
  getDashboardPayload,
  getFinancialSummary,
  type DateRangePreset,
} from './financial-summary.service';
import * as reports from './reports.service';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

function parsePreset(value: string | undefined): DateRangePreset {
  const valid: DateRangePreset[] = ['today', 'week', 'month', 'year', 'custom', 'lifetime'];
  if (value && valid.includes(value as DateRangePreset)) return value as DateRangePreset;
  return 'month';
}

function queryInt(value: string | undefined, fallback?: number) {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

reportsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const preset = parsePreset(typeof req.query.preset === 'string' ? req.query.preset : undefined);
    const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
    res.json(await getDashboardPayload(preset, fromDate, toDate));
  }),
);

reportsRouter.get(
  '/financial-summary',
  asyncHandler(async (req, res) => {
    const preset = parsePreset(typeof req.query.preset === 'string' ? req.query.preset : undefined);
    const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
    res.json(await getFinancialSummary(preset, fromDate, toDate));
  }),
);

reportsRouter.get(
  '/sales/daily',
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.preset === 'string' ? req.query.preset : undefined;
    const valid: DateRangePreset[] = ['today', 'week', 'month', 'year', 'custom', 'lifetime'];
    const preset = raw && valid.includes(raw as DateRangePreset) ? (raw as DateRangePreset) : 'today';
    res.json(
      await reports.reportDailySales({
        preset,
        fromDate: req.query.fromDate as string | undefined,
        toDate: req.query.toDate as string | undefined,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/range',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportSalesDateRange({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/product-profit',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportProductProfit({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/category-profit',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportCategoryProfit({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/invoice-profit',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportInvoiceProfit({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/udhaar',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportUdhaarSales({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/payment-methods',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportPaymentMethodBreakdown({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/collection-breakdown',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportSalesCollectionBreakdown({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/sales/returns-exchanges',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportReturnsExchanges({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/current',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportCurrentStock({
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/low',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportLowStock({
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/out',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportOutOfStock({
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/damaged',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportDamagedStock({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/movements',
  asyncHandler(async (req, res) => {
    const typeRaw = req.query.type as string | undefined;
    const type =
      typeRaw && Object.values(StockMovementType).includes(typeRaw as StockMovementType)
        ? (typeRaw as StockMovementType)
        : undefined;
    res.json(
      await reports.reportStockMovements({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
        type,
      }),
    );
  }),
);

reportsRouter.get(
  '/stock/valuation',
  asyncHandler(async (_req, res) => {
    res.json(await reports.reportStockValuation());
  }),
);

reportsRouter.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    const period = (req.query.period as 'today' | 'month' | 'year' | 'lifetime') ?? 'month';
    res.json(
      await reports.reportPurchases({
        period,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/suppliers/purchases',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportSupplierPurchases({
        supplierId: queryInt(req.query.supplierId as string),
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/suppliers/outstanding',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportSupplierOutstanding({
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/suppliers/payments',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportSupplierPayments({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/purchases/returns',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportPurchaseReturns({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/customers/balances',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportCustomerBalances({
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/customers/payments',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportCustomerPayments({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/customers/purchases',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportCustomerPurchases({
        customerId: queryInt(req.query.customerId as string),
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/customers/:customerId/udhaar-statement',
  asyncHandler(async (req, res) => {
    const customerId = parseInt(param(req.params.customerId), 10);
    res.json(
      await reports.reportCustomerPurchases({
        customerId,
        preset: 'lifetime',
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/expenses/daily',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportExpensesDaily({
        fromDate: String(req.query.fromDate ?? ''),
        toDate: String(req.query.toDate ?? ''),
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);

reportsRouter.get(
  '/expenses/range',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportExpensesRange({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
        search: req.query.search as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/expenses/by-category',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportExpensesByCategory({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
      }),
    );
  }),
);

reportsRouter.get(
  '/other-income',
  asyncHandler(async (req, res) => {
    res.json(
      await reports.reportOtherIncome({
        preset: parsePreset(req.query.preset as string),
        fromDate: req.query.fromDate as string,
        toDate: req.query.toDate as string,
        page: queryInt(req.query.page as string),
        pageSize: queryInt(req.query.pageSize as string),
      }),
    );
  }),
);
