import { Router } from 'express';
import { PurchasePaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody, AppError } from '../../utils/helpers';
import * as purchasesService from './purchases.service';

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);

const itemSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().positive(),
  purchasePrice: z.number().min(0),
  discount: z.number().min(0).optional(),
});

const createPurchaseSchema = z.object({
  supplierId: z.number().int().positive(),
  date: z.string().min(1),
  supplierInvoiceNumber: z.string().max(80).nullable().optional(),
  items: z.array(itemSchema).min(1),
  paidAmount: z.number().min(0),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod),
  paymentAccountId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const paymentSchema = z.object({
  supplierId: z.number().int().positive(),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod),
  paymentAccountId: z.number().int().positive().nullable().optional(),
  date: z.string().min(1),
  note: z.string().max(500).nullable().optional(),
});

const returnSchema = z.object({
  purchaseId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  note: z.string().max(500).nullable().optional(),
  refundToCash: z.boolean().optional(),
});

purchasesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const supplierId = req.query.supplierId
      ? parseInt(String(req.query.supplierId), 10)
      : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined;
    const result = await purchasesService.listPurchases({ supplierId, page, pageSize });
    res.json(result);
  }),
);

purchasesRouter.post(
  '/',
  validateBody(createPurchaseSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const purchase = await purchasesService.createPurchase({
      ...req.body,
      createdById: userId,
    });
    res.status(201).json(purchase);
  }),
);

purchasesRouter.post(
  '/payments',
  validateBody(paymentSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const payment = await purchasesService.createSupplierPayment({
      ...req.body,
      createdById: userId,
    });
    res.status(201).json(payment);
  }),
);

purchasesRouter.post(
  '/returns',
  validateBody(returnSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const result = await purchasesService.createPurchaseReturn({
      ...req.body,
      createdById: userId,
    });
    res.status(201).json(result);
  }),
);

purchasesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const purchase = await purchasesService.getPurchase(parseInt(param(req.params.id), 10));
    res.json(purchase);
  }),
);
