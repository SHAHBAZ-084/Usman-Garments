import { Router } from 'express';
import path from 'path';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../utils/helpers';
import { openLogsFolder } from '../backup/backup.service';
import { reconcileProductStockToMovements, runHealthCheck } from './health.service';

export const healthRouter = Router();

healthRouter.use(requireAuth);

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json(await runHealthCheck());
  }),
);

healthRouter.post(
  '/health/reconcile-stock',
  validateBody(z.object({ productId: z.number().int().positive() })),
  asyncHandler(async (req, res) => {
    res.json(await reconcileProductStockToMovements(req.body.productId));
  }),
);

healthRouter.get(
  '/logs-path',
  asyncHandler(async (_req, res) => {
    res.json({ path: path.resolve(openLogsFolder()) });
  }),
);
