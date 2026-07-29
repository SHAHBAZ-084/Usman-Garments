import { Router } from 'express';
import multer from 'multer';
import { ReceiptSize, ThemeMode } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, validateBody, AppError } from '../../utils/helpers';
import * as settingsService from './settings.service';
import * as identityAccess from './identity-access.service';

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
  developerCreditLine: z.string().max(200).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Primary color must be hex like #111111')
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Secondary color must be hex like #C99618')
    .optional(),
  themeMode: z
    .union([z.nativeEnum(ThemeMode), z.enum(['light', 'dark'])])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === 'dark' || v === ThemeMode.DARK) return ThemeMode.DARK;
      return ThemeMode.LIGHT;
    }),
});

const passphraseSchema = z.object({
  passphrase: z.string().min(1).max(128),
});

const changePassphraseSchema = z.object({
  currentPassphrase: z.string().min(1).max(128),
  newPassphrase: z.string().min(4).max(128),
});

settingsRouter.use(requireAuth);

settingsRouter.get(
  '/identity-access/status',
  asyncHandler(async (req, res) => {
    res.json({ active: identityAccess.isIdentityEditActive(req.session) });
  }),
);

settingsRouter.post(
  '/identity-access/verify',
  validateBody(passphraseSchema),
  asyncHandler(async (req, res) => {
    const ok = await identityAccess.verifyIdentityPassphrase(req.body.passphrase);
    if (ok) {
      identityAccess.activateIdentityEditSession(req.session);
    }
    res.json({ ok });
  }),
);

settingsRouter.post(
  '/identity-access/end',
  asyncHandler(async (req, res) => {
    identityAccess.endIdentityEditSession(req.session);
    res.json({ ok: true });
  }),
);

settingsRouter.post(
  '/identity-access/touch',
  asyncHandler(async (req, res) => {
    identityAccess.touchIdentityEditSession(req.session);
    res.json({ active: identityAccess.isIdentityEditActive(req.session) });
  }),
);

settingsRouter.post(
  '/identity-access/passphrase',
  validateBody(changePassphraseSchema),
  asyncHandler(async (req, res) => {
    if (!identityAccess.isIdentityEditActive(req.session)) {
      throw new AppError(403, 'Edit session is not active');
    }
    await identityAccess.changeIdentityPassphrase(req.body.currentPassphrase, req.body.newPassphrase);
    res.json({ ok: true });
  }),
);

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
    if (identityAccess.isIdentityEditActive(req.session)) {
      identityAccess.touchIdentityEditSession(req.session);
    }
    const settings = await settingsService.updateBusinessSettings(req.body, {
      identityEditActive: identityAccess.isIdentityEditActive(req.session),
    });
    res.json(settings);
  }),
);

settingsRouter.post(
  '/logo',
  asyncHandler(async (req, res) => {
    if (!identityAccess.isIdentityEditActive(req.session)) {
      throw new AppError(403, 'This setting cannot be changed');
    }
    identityAccess.touchIdentityEditSession(req.session);

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
