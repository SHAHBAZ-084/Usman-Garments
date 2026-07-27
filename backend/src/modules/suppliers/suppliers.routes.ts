import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import * as suppliersService from './suppliers.service';

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).nullable().optional(),
  openingBalance: z.number().min(0).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

suppliersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly !== 'false';
    const search = req.query.search ? String(req.query.search) : undefined;
    const suppliers = await suppliersService.listSuppliers({ activeOnly, search });
    res.json(suppliers);
  }),
);

suppliersRouter.post(
  '/',
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const supplier = await suppliersService.createSupplier(req.body);
    res.status(201).json(supplier);
  }),
);

suppliersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = await suppliersService.getSupplierDetail(parseInt(param(req.params.id), 10));
    res.json(detail);
  }),
);

suppliersRouter.patch(
  '/:id',
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const supplier = await suppliersService.updateSupplier(
      parseInt(param(req.params.id), 10),
      req.body,
    );
    res.json(supplier);
  }),
);

suppliersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const supplier = await suppliersService.deactivateSupplier(parseInt(param(req.params.id), 10));
    res.json(supplier);
  }),
);
