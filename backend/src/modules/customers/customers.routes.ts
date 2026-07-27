import { Router } from 'express';
import { PurchasePaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody, AppError } from '../../utils/helpers';
import * as customersService from './customers.service';

export const customersRouter = Router();

customersRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const paymentSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PurchasePaymentMethod),
  date: z.string().min(1),
  note: z.string().max(500).nullable().optional(),
});

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = req.query.search ? String(req.query.search) : undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const items = await customersService.listCustomers({ search, activeOnly });
    res.json(items);
  }),
);

customersRouter.post(
  '/',
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const customer = await customersService.createCustomer(req.body);
    res.status(201).json(customer);
  }),
);

customersRouter.post(
  '/payments',
  validateBody(paymentSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, 'Not authenticated');
    const payment = await customersService.createCustomerPayment({
      ...req.body,
      createdById: userId,
    });
    res.status(201).json(payment);
  }),
);

customersRouter.get(
  '/:id/statement',
  asyncHandler(async (req, res) => {
    const statement = await customersService.getCustomerStatement(parseInt(param(req.params.id), 10));
    res.json(statement);
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = await customersService.getCustomerDetail(parseInt(param(req.params.id), 10));
    res.json(detail);
  }),
);

customersRouter.patch(
  '/:id',
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const customer = await customersService.updateCustomer(
      parseInt(param(req.params.id), 10),
      req.body,
    );
    res.json(customer);
  }),
);

customersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customersService.deactivateCustomer(parseInt(param(req.params.id), 10));
    res.json(customer);
  }),
);
