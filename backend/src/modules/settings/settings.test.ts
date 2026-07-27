import { describe, expect, it, beforeEach } from 'vitest';
import { ThemeMode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  BUSINESS_SETTINGS_ID,
  DEFAULT_BUSINESS_SETTINGS,
  ensureBusinessSettings,
  getBusinessSettings,
  updateBusinessSettings,
} from './settings.service';

describe('business settings', () => {
  beforeEach(async () => {
    await ensureBusinessSettings();
    await updateBusinessSettings({
      businessName: DEFAULT_BUSINESS_SETTINGS.businessName,
      tagline: DEFAULT_BUSINESS_SETTINGS.tagline,
      ownerName: DEFAULT_BUSINESS_SETTINGS.ownerName,
      phone: DEFAULT_BUSINESS_SETTINGS.phone,
      whatsapp: DEFAULT_BUSINESS_SETTINGS.whatsapp,
      address: DEFAULT_BUSINESS_SETTINGS.address,
      invoiceFooter: DEFAULT_BUSINESS_SETTINGS.invoiceFooter,
      returnPolicy: DEFAULT_BUSINESS_SETTINGS.returnPolicy,
      invoicePrefix: DEFAULT_BUSINESS_SETTINGS.invoicePrefix,
      currency: DEFAULT_BUSINESS_SETTINGS.currency,
      receiptSize: DEFAULT_BUSINESS_SETTINGS.receiptSize,
      a4InvoiceEnabled: DEFAULT_BUSINESS_SETTINGS.a4InvoiceEnabled,
      printerName: DEFAULT_BUSINESS_SETTINGS.printerName,
      barcodeLabelSize: DEFAULT_BUSINESS_SETTINGS.barcodeLabelSize,
      lowStockLimit: DEFAULT_BUSINESS_SETTINGS.lowStockLimit,
      backupFolderPath: DEFAULT_BUSINESS_SETTINGS.backupFolderPath,
      themeMode: DEFAULT_BUSINESS_SETTINGS.themeMode,
    });
  });

  it('returns singleton defaults and never creates a second row', async () => {
    const first = await getBusinessSettings();
    expect(first.id).toBe(BUSINESS_SETTINGS_ID);
    expect(first.businessName).toBe('Usman Mall');
    expect(first.phone).toBe('0300-6195469');
    expect(first.address).toBe('Al-Nisa Road, Chishtian');
    expect(first.invoicePrefix).toBe('UM-');
    expect(first.currency).toBe('PKR');
    expect(first.lowStockLimit).toBe(5);
    expect(first.tagline).toBe('Quality Clothes, Your Style');

    await ensureBusinessSettings();
    await ensureBusinessSettings();

    const count = await prisma.businessSettings.count();
    expect(count).toBe(1);
  });

  it('updates settings and persists values', async () => {
    const updated = await updateBusinessSettings({
      businessName: 'Usman Mall',
      ownerName: 'Owner Test',
      lowStockLimit: 8,
      themeMode: ThemeMode.DARK,
    });

    expect(updated.ownerName).toBe('Owner Test');
    expect(updated.lowStockLimit).toBe(8);
    expect(updated.themeMode).toBe('dark');

    const again = await getBusinessSettings();
    expect(again.ownerName).toBe('Owner Test');
    expect(again.lowStockLimit).toBe(8);
    expect(again.themeMode).toBe('dark');
  });

  it('persists barcode label size presets and custom WxH', async () => {
    const a4 = await updateBusinessSettings({ barcodeLabelSize: 'a4' });
    expect(a4.barcodeLabelSize).toBe('a4');
    expect((await getBusinessSettings()).barcodeLabelSize).toBe('a4');

    const thermal = await updateBusinessSettings({ barcodeLabelSize: '40x30' });
    expect(thermal.barcodeLabelSize).toBe('40x30');

    const custom = await updateBusinessSettings({ barcodeLabelSize: '60x40' });
    expect(custom.barcodeLabelSize).toBe('60x40');

    await expect(updateBusinessSettings({ barcodeLabelSize: 'huge' })).rejects.toThrow(/label size/i);
  });

  it('rejects invalid lowStockLimit', async () => {
    await expect(updateBusinessSettings({ lowStockLimit: 0 })).rejects.toThrow(
      /positive integer/i,
    );
    await expect(updateBusinessSettings({ lowStockLimit: -3 })).rejects.toThrow(
      /positive integer/i,
    );
  });

  it('rejects empty business name', async () => {
    await expect(updateBusinessSettings({ businessName: '   ' })).rejects.toThrow(
      /Business name is required/i,
    );
  });
});
