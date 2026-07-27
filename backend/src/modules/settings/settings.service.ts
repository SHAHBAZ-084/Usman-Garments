import fs from 'fs';
import path from 'path';
import { Prisma, ReceiptSize, ThemeMode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { isValidBarcodeLabelSize, normalizeBarcodeLabelSize } from './label-size';

export const BUSINESS_SETTINGS_ID = 1;

export const DEFAULT_BUSINESS_SETTINGS = {
  businessName: 'Usman Mall',
  tagline: 'Quality Clothes, Your Style',
  ownerName: '',
  phone: '0300-6195469',
  whatsapp: '0300-6195469',
  address: 'Al-Nisa Road, Chishtian',
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
};

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
};

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
  logoPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    themeMode: row.themeMode === ThemeMode.DARK ? 'dark' : 'light',
    logoUrl: row.logoPath ? `/uploads/${path.basename(row.logoPath)}` : null,
  };
}

/** Ensure the singleton settings row exists. Never creates a second row. */
export async function ensureBusinessSettings() {
  const existing = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
  });
  if (existing) return existing;

  const count = await prisma.businessSettings.count();
  if (count > 0) {
    throw new AppError(500, 'Business settings integrity error: unexpected extra rows');
  }

  return prisma.businessSettings.create({
    data: {
      id: BUSINESS_SETTINGS_ID,
      ...DEFAULT_BUSINESS_SETTINGS,
    },
  });
}

export async function getBusinessSettings() {
  const row = await ensureBusinessSettings();
  return serializeSettings(row);
}

export async function updateBusinessSettings(input: BusinessSettingsUpdateInput) {
  await ensureBusinessSettings();

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
  const dir = path.resolve(__dirname, '../../../prisma/data/uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  const updated = await updateBusinessSettings({ logoPath: relativePath });
  return updated;
}
