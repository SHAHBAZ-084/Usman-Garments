import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import * as customersService from '../customers/customers.service';

export const customersRouter = Router();

customersRouter.use(requireAuth);

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
  validateBody(
    z.object({
      name: z.string().min(1).max(120),
      phone: z.string().max(40).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const customer = await customersService.createCustomer(req.body);
    res.status(201).json(customer);
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customersService.getCustomer(parseInt(param(req.params.id), 10));
    res.json(customer);
  }),
);
