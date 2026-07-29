import fs from 'fs';
import path from 'path';
import { Prisma, ReceiptSize, ThemeMode } from '@prisma/client';
import { getUploadsDir as resolveUploadsDir } from '../../config/paths';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { isValidBarcodeLabelSize, normalizeBarcodeLabelSize } from './label-size';
import { assertIdentityFieldsEditable, ensureDeveloperPassphraseHash } from './identity-access.service';

export { PROTECTED_BUSINESS_IDENTITY_FIELDS } from './protected-fields';

export const BUSINESS_SETTINGS_ID = 1;

export const DEFAULT_BUSINESS_SETTINGS = {
  businessName: 'Usman Mall',
  tagline: 'Quality Clothes, Your Style',
  ownerName: '',
  phone: 'M Arslan 03024979697',
  whatsapp: 'M Usman 03006195469',
  address: 'Bano Bazar Al Nissa Road Near Taleem Un Nisa Madrasa Chishtian',
  invoiceFooter: 'Thank you for shopping at Usman Mall',
  returnPolicy:
    'Returns accepted within 7 days with original receipt. Items must be unused and in original condition.',
  invoicePrefix: 'UM-',
  currency: 'PKR',
  receiptSize: ReceiptSize.THERMAL_80,
  a4InvoiceEnabled: true,
  printerName: null as string | null,
  barcodeLabelSize: '50x30',
  lowStockLimit: 5,
  backupFolderPath: '',
  themeMode: ThemeMode.LIGHT,
  logoPath: null as string | null,
  primaryColor: '#111111',
  secondaryColor: '#C99618',
  developerCreditLine: 'AS Solutions | Ali & Shahbaz | 0322-0726006',
};

const LEGACY_ADDRESS = 'Al-Nisa Road, Chishtian';
const LEGACY_PHONE = '0300-6195469';
const LEGACY_CREDIT = 'AS Solutions — Ali & Shahbaz — 0322-0726006';

export type BusinessSettingsUpdateInput = {
  businessName?: string;
  tagline?: string;
  ownerName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  invoiceFooter?: string;
  returnPolicy?: string;
  invoicePrefix?: string;
  currency?: string;
  receiptSize?: ReceiptSize;
  a4InvoiceEnabled?: boolean;
  printerName?: string | null;
  barcodeLabelSize?: string;
  lowStockLimit?: number;
  backupFolderPath?: string;
  themeMode?: ThemeMode;
  logoPath?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  developerCreditLine?: string;
};

function normalizeHexColor(raw: string, field: string): string {
  const value = raw.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new AppError(400, `${field} must be a hex color like #111111`);
  }
  return value.toUpperCase();
}

function serializeSettings(row: {
  id: number;
  businessName: string;
  tagline: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  address: string;
  invoiceFooter: string;
  returnPolicy: string;
  invoicePrefix: string;
  currency: string;
  receiptSize: ReceiptSize;
  a4InvoiceEnabled: boolean;
  printerName: string | null;
  barcodeLabelSize: string;
  lowStockLimit: number;
  backupFolderPath: string;
  themeMode: ThemeMode;
  primaryColor: string;
  secondaryColor: string;
  logoPath: string | null;
  isIdentityLocked: boolean;
  developerPassphraseHash: string;
  developerCreditLine: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const {
    developerPassphraseHash: _hash,
    isIdentityLocked: _locked,
    ...safe
  } = row;
  return {
    ...safe,
    themeMode: row.themeMode === ThemeMode.DARK ? 'dark' : 'light',
    logoUrl: row.logoPath ? `/uploads/${path.basename(row.logoPath)}` : null,
  };
}

/** Ensure the singleton settings row exists. Never creates a second row. */
export async function ensureBusinessSettings() {
  const existing = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
  });
  if (existing) {
    const patch: Prisma.BusinessSettingsUpdateInput = {};
    if (existing.address.trim() === LEGACY_ADDRESS) {
      patch.address = DEFAULT_BUSINESS_SETTINGS.address;
    }
    if (existing.phone.trim() === LEGACY_PHONE) {
      patch.phone = DEFAULT_BUSINESS_SETTINGS.phone;
      patch.whatsapp = DEFAULT_BUSINESS_SETTINGS.whatsapp;
    }
    if (existing.developerCreditLine.trim() === LEGACY_CREDIT || /[\u2014\u2013]/.test(existing.developerCreditLine)) {
      patch.developerCreditLine = DEFAULT_BUSINESS_SETTINGS.developerCreditLine;
    }
    if (Object.keys(patch).length > 0) {
      const updated = await prisma.businessSettings.update({
        where: { id: BUSINESS_SETTINGS_ID },
        data: patch,
      });
      await ensureDeveloperPassphraseHash();
      return updated;
    }
    await ensureDeveloperPassphraseHash();
    return existing;
  }

  const count = await prisma.businessSettings.count();
  if (count > 0) {
    throw new AppError(500, 'Business settings integrity error: unexpected extra rows');
  }

  const row = await prisma.businessSettings.create({
    data: {
      id: BUSINESS_SETTINGS_ID,
      ...DEFAULT_BUSINESS_SETTINGS,
    },
  });
  await ensureDeveloperPassphraseHash();
  return row;
}

export async function getBusinessSettings() {
  const row = await ensureBusinessSettings();
  return serializeSettings(row);
}

export async function updateBusinessSettings(
  input: BusinessSettingsUpdateInput,
  options?: { identityEditActive?: boolean },
) {
  await ensureBusinessSettings();
  assertIdentityFieldsEditable(input, Boolean(options?.identityEditActive));

  const data: Prisma.BusinessSettingsUpdateInput = {};

  if (input.businessName !== undefined) data.businessName = input.businessName.trim();
  if (input.tagline !== undefined) data.tagline = input.tagline.trim();
  if (input.ownerName !== undefined) data.ownerName = input.ownerName.trim();
  if (input.phone !== undefined) data.phone = input.phone.trim();
  if (input.whatsapp !== undefined) data.whatsapp = input.whatsapp.trim();
  if (input.address !== undefined) data.address = input.address.trim();
  if (input.invoiceFooter !== undefined) data.invoiceFooter = input.invoiceFooter.trim();
  if (input.returnPolicy !== undefined) data.returnPolicy = input.returnPolicy.trim();
  if (input.invoicePrefix !== undefined) data.invoicePrefix = input.invoicePrefix.trim();
  if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase();
  if (input.receiptSize !== undefined) data.receiptSize = input.receiptSize;
  if (input.a4InvoiceEnabled !== undefined) data.a4InvoiceEnabled = input.a4InvoiceEnabled;
  if (input.printerName !== undefined) {
    data.printerName = input.printerName?.trim() ? input.printerName.trim() : null;
  }
  if (input.barcodeLabelSize !== undefined) {
    const normalized = normalizeBarcodeLabelSize(input.barcodeLabelSize);
    if (!isValidBarcodeLabelSize(normalized)) {
      throw new AppError(
        400,
        'Barcode label size must be a preset (40x30, 50x25, 50x30, a4) or custom WxH in mm',
      );
    }
    data.barcodeLabelSize = normalized;
  }
  if (input.lowStockLimit !== undefined) data.lowStockLimit = input.lowStockLimit;
  if (input.backupFolderPath !== undefined) data.backupFolderPath = input.backupFolderPath.trim();
  if (input.themeMode !== undefined) data.themeMode = input.themeMode;
  if (input.logoPath !== undefined) data.logoPath = input.logoPath;
  if (input.primaryColor !== undefined) {
    data.primaryColor = normalizeHexColor(input.primaryColor, 'Primary color');
  }
  if (input.secondaryColor !== undefined) {
    data.secondaryColor = normalizeHexColor(input.secondaryColor, 'Secondary color');
  }
  if (input.developerCreditLine !== undefined) {
    data.developerCreditLine = input.developerCreditLine.trim();
  }

  if (data.businessName === '') {
    throw new AppError(400, 'Business name is required');
  }
  if (typeof data.lowStockLimit === 'number' && (!Number.isInteger(data.lowStockLimit) || data.lowStockLimit < 1)) {
    throw new AppError(400, 'Low stock limit must be a positive integer');
  }

  const row = await prisma.businessSettings.update({
    where: { id: BUSINESS_SETTINGS_ID },
    data,
  });
  return serializeSettings(row);
}

export function getUploadsDir() {
  return resolveUploadsDir();
}

export async function saveBusinessLogo(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}) {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) {
    throw new AppError(400, 'Logo must be a PNG, JPEG, WEBP, or GIF image');
  }
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new AppError(400, 'Logo must be 2 MB or smaller');
  }

  const ext =
    file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
        ? '.webp'
        : file.mimetype === 'image/gif'
          ? '.gif'
          : '.jpg';

  const uploadsDir = getUploadsDir();
  const filename = `logo-${Date.now()}${ext}`;
  const absolutePath = path.join(uploadsDir, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  // Store relative path under prisma/data/uploads for portability
  const relativePath = path.join('uploads', filename);
  const updated = await updateBusinessSettings(
    { logoPath: relativePath },
    { identityEditActive: true },
  );
  return updated;
}
