import { Router } from 'express';
import { PurchasePaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, validateBody, AppError } from '../../utils/helpers';
import * as financeService from './finance.service';

export const financeRouter = Router();

financeRouter.use(requireAuth);

const categorySchema = z.object({
  name: z.string().min(1).max(120),
});

const expenseSchema = z.object({
  categoryId: z.number().int().positive(),
  date: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod),
  description: z.string().min(1).max(500),
  paidTo: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const otherIncomeSchema = z.object({
  categoryId: z.number().int().positive(),
  date: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod),
  description: z.string().min(1).max(500),
  note: z.string().max(500).nullable().optional(),
});

financeRouter.get(
  '/expense-categories',
  asyncHandler(async (_req, res) => {
    res.json(await financeService.listExpenseCategories());
  }),
);

financeRouter.post(
  '/expense-categories',
  validateBody(categorySchema),
  asyncHandler(async (req, res) => {
    const category = await financeService.createExpenseCategory(req.body.name);
    res.status(201).json(category);
  }),
);

financeRouter.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    const fromDate = req.query.fromDate ? String(req.query.fromDate) : undefined;
    const toDate = req.query.toDate ? String(req.query.toDate) : undefined;
    res.json(await financeService.listExpenses({ fromDate, toDate }));
  }),
);

financeRouter.post(
  '/expenses',
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const expense = await financeService.createExpense({ ...req.body, createdById: userId });
    res.status(201).json(expense);
  }),
);

financeRouter.get(
  '/other-income-categories',
  asyncHandler(async (_req, res) => {
    res.json(await financeService.listOtherIncomeCategories());
  }),
);

financeRouter.post(
  '/other-income-categories',
  validateBody(categorySchema),
  asyncHandler(async (req, res) => {
    const category = await financeService.createOtherIncomeCategory(req.body.name);
    res.status(201).json(category);
  }),
);

financeRouter.get(
  '/other-income',
  asyncHandler(async (req, res) => {
    const fromDate = req.query.fromDate ? String(req.query.fromDate) : undefined;
    const toDate = req.query.toDate ? String(req.query.toDate) : undefined;
    res.json(await financeService.listOtherIncomes({ fromDate, toDate }));
  }),
);

financeRouter.post(
  '/other-income',
  validateBody(otherIncomeSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const income = await financeService.createOtherIncome({ ...req.body, createdById: userId });
    res.status(201).json(income);
  }),
);
