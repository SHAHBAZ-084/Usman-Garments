import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import {
  createBackup,
  listBackups,
  restoreBackup,
  validateBackupFolder,
} from './backup.service';

export const backupRouter = Router();

backupRouter.use(requireAuth);

backupRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await listBackups();
    res.json({ items });
  }),
);

backupRouter.post(
  '/create',
  asyncHandler(async (req, res) => {
    const destinationFolder =
      typeof req.body?.destinationFolder === 'string' ? req.body.destinationFolder : undefined;
    const entry = await createBackup({ destinationFolder, label: 'Manual backup' });
    res.status(201).json(entry);
  }),
);

backupRouter.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const folderPath = String(req.body?.folderPath ?? '');
    const manifest = validateBackupFolder(folderPath);
    res.json({ ok: true, manifest });
  }),
);

backupRouter.post(
  '/restore',
  asyncHandler(async (req, res) => {
    const folderPath = String(req.body?.folderPath ?? '');
    const result = await restoreBackup(folderPath);
    res.json({ ok: true, requiresRestart: true, ...result });
  }),
);
