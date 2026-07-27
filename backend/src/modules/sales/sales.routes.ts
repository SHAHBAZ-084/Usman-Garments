import { Router } from 'express';
import { SalePaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody, AppError } from '../../utils/helpers';
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
  paidAmount: z.number().min(0),
  customerId: z.number().int().positive().nullable().optional(),
  discount: z.number().min(0).optional(),
  date: z.string().min(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
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
