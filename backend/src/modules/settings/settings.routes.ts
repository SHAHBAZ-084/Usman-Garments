import { Router } from 'express';
import multer from 'multer';
import { ReceiptSize, ThemeMode } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, validateBody, AppError } from '../../utils/helpers';
import * as settingsService from './settings.service';

export const settingsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const phoneRegex = /^[0-9+\-\s()]{7,20}$/;

const updateSchema = z.object({
  businessName: z.string().min(1).max(120).optional(),
  tagline: z.string().max(200).optional(),
  ownerName: z.string().max(120).optional(),
  phone: z
    .string()
    .max(20)
    .refine((v) => v.trim() === '' || phoneRegex.test(v.trim()), {
      message: 'Invalid phone number',
    })
    .optional(),
  whatsapp: z
    .string()
    .max(20)
    .refine((v) => v.trim() === '' || phoneRegex.test(v.trim()), {
      message: 'Invalid WhatsApp number',
    })
    .optional(),
  address: z.string().max(500).optional(),
  invoiceFooter: z.string().max(1000).optional(),
  returnPolicy: z.string().max(2000).optional(),
  invoicePrefix: z.string().min(1).max(20).optional(),
  currency: z.string().min(1).max(10).optional(),
  receiptSize: z.nativeEnum(ReceiptSize).optional(),
  a4InvoiceEnabled: z.boolean().optional(),
  printerName: z.string().max(200).nullable().optional(),
  barcodeLabelSize: z.string().min(1).max(40).optional(),
  lowStockLimit: z.number().int().positive().optional(),
  backupFolderPath: z.string().max(500).optional(),
  themeMode: z
    .union([z.nativeEnum(ThemeMode), z.enum(['light', 'dark'])])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === 'dark' || v === ThemeMode.DARK) return ThemeMode.DARK;
      return ThemeMode.LIGHT;
    }),
});

settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await settingsService.getBusinessSettings();
    res.json(settings);
  }),
);

settingsRouter.patch(
  '/',
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const settings = await settingsService.updateBusinessSettings(req.body);
    res.json(settings);
  }),
);

settingsRouter.post(
  '/logo',
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve, reject) => {
      upload.single('logo')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.file) {
      throw new AppError(400, 'Logo file is required');
    }

    const settings = await settingsService.saveBusinessLogo({
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
    });
    res.json(settings);
  }),
);
