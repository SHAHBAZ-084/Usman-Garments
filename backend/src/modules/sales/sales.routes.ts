import { Router } from 'express';
import { PurchasePaymentMethod, ReturnCondition, SalePaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody, AppError } from '../../utils/helpers';
import * as returnsService from './returns.service';
import * as salesService from './sales.service';

export const salesRouter = Router();

salesRouter.use(requireAuth);

const itemSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().positive(),
  rate: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
});

const createSaleSchema = z.object({
  items: z.array(itemSchema).min(1),
  paymentMethod: z.nativeEnum(SalePaymentMethod),
  paidAmount: z.number().min(0).optional(),
  amountReceived: z.number().min(0).optional(),
  udhaarRecoveryAmount: z.number().min(0).optional(),
  paymentAccountId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  discount: z.number().min(0).optional(),
  date: z.string().min(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((body) => body.amountReceived != null || body.paidAmount != null, {
  message: 'amountReceived or paidAmount is required',
});

const returnItemSchema = z.object({
  invoiceItemId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  condition: z.nativeEnum(ReturnCondition),
});

const createReturnSchema = z.object({
  invoiceId: z.number().int().positive(),
  items: z.array(returnItemSchema).min(1),
  refundMethod: z.nativeEnum(PurchasePaymentMethod).optional(),
  paymentAccountId: z.number().int().positive().nullable().optional(),
  refundAmount: z.number().min(0).optional(),
  refundToCash: z.boolean().optional(),
  applyToUdhaar: z.boolean().optional(),
  applyToUdhaarAmount: z.number().min(0).optional(),
  note: z.string().max(500).nullable().optional(),
});

const createExchangeSchema = z.object({
  invoiceId: z.number().int().positive(),
  returnItems: z.array(returnItemSchema).min(1),
  newItems: z.array(itemSchema).min(1),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod).optional(),
  paymentAccountId: z.number().int().positive().nullable().optional(),
  paidAmount: z.number().min(0).optional(),
  refundToCash: z.boolean().optional(),
  applyToUdhaar: z.boolean().optional(),
  applyToUdhaarAmount: z.number().min(0).optional(),
  note: z.string().max(500).nullable().optional(),
});

salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined;
    const status = req.query.status === 'CANCELLED' ? 'CANCELLED' : req.query.status === 'ACTIVE' ? 'ACTIVE' : undefined;
    const result = await salesService.listInvoices({ page, pageSize, status: status as 'ACTIVE' | 'CANCELLED' | undefined });
    res.json(result);
  }),
);

salesRouter.get(
  '/invoice-lookup/:invoiceNumber',
  asyncHandler(async (req, res) => {
    const invoice = await returnsService.findInvoiceForReturn(param(req.params.invoiceNumber));
    res.json(invoice);
  }),
);

salesRouter.post(
  '/returns',
  validateBody(createReturnSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const result = await returnsService.createSaleReturn({ ...req.body, createdById: userId });
    res.status(201).json(result);
  }),
);

salesRouter.post(
  '/exchanges',
  validateBody(createExchangeSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const result = await returnsService.createExchange({ ...req.body, createdById: userId });
    res.status(201).json(result);
  }),
);

salesRouter.get(
  '/returns/:id',
  asyncHandler(async (req, res) => {
    const result = await returnsService.getSaleReturn(parseInt(param(req.params.id), 10));
    res.json(result);
  }),
);

salesRouter.get(
  '/exchanges/:id',
  asyncHandler(async (req, res) => {
    const result = await returnsService.getExchange(parseInt(param(req.params.id), 10));
    res.json(result);
  }),
);

salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const invoice = await salesService.getInvoice(parseInt(param(req.params.id), 10));
    res.json(invoice);
  }),
);

salesRouter.post(
  '/',
  validateBody(createSaleSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const invoice = await salesService.createSale({
      ...req.body,
      createdById: userId,
    });
    res.status(201).json(invoice);
  }),
);

salesRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const invoice = await salesService.cancelSale(parseInt(param(req.params.id), 10), userId);
    res.json(invoice);
  }),
);
