import { Router } from 'express';
import path from 'path';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import { openLogsFolder } from '../backup/backup.service';
import { runHealthCheck } from './health.service';

export const healthRouter = Router();

healthRouter.use(requireAuth);

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json(await runHealthCheck());
  }),
);

healthRouter.get(
  '/logs-path',
  asyncHandler(async (_req, res) => {
    res.json({ path: path.resolve(openLogsFolder()) });
  }),
);
