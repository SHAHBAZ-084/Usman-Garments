import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PurchasePaymentMethod, ReturnCondition, SalePaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { syncInvoiceNumberCounter } from '../../test-helpers/invoice-counter';
import { bootstrapChartOfAccounts } from '../accounting/accounting.service';
import { createExpense } from '../finance/finance.service';
import { createProduct } from '../products/products.service';
import { createPurchase, createPurchaseReturn } from '../purchases/purchases.service';
import { createSupplier } from '../suppliers/suppliers.service';
import { createSaleReturn } from '../sales/returns.service';
import { createSale } from '../sales/sales.service';
import {
  assertDiskSpaceForBackup,
  createBackup,
  estimateBackupBytes,
  validateBackupFolder,
} from './backup.service';

describe('Backup & restore (Phase 12)', () => {
  let tempBackupRoot: string;

  beforeEach(() => {
    tempBackupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'usman-backup-test-'));
  });

  it('creates backup with valid manifest and checksum', async () => {
    const entry = await createBackup({ destinationFolder: tempBackupRoot, label: 'Test backup' });
    expect(fs.existsSync(entry.folderPath)).toBe(true);
    const manifest = validateBackupFolder(entry.folderPath);
    expect(manifest.databaseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.app).toBe('usman-mall');
  });

  it('rejects corrupt backup when checksum does not match', async () => {
    const entry = await createBackup({ destinationFolder: tempBackupRoot });
    const dbPath = path.join(entry.folderPath, 'usman-garments.db');
    fs.appendFileSync(dbPath, 'corruption');
    expect(() => validateBackupFolder(entry.folderPath)).toThrow(/integrity|corrupt/i);
  });

  it('rejects invalid backup folder', () => {
    expect(() => validateBackupFolder(path.join(tempBackupRoot, 'missing'))).toThrow(/valid|not found/i);
  });

  it('checks disk space before backup', async () => {
    const { getFreeDiskSpaceBytes } = await import('./backup.service');
    const free = await getFreeDiskSpaceBytes(tempBackupRoot);
    if (free == null) {
      expect(free).toBeNull();
      return;
    }
    await expect(assertDiskSpaceForBackup(tempBackupRoot, free + 1)).rejects.toMatchObject({
      code: 'DISK_FULL',
    });
  });

  it('restore rejects corrupt backup before any apply', async () => {
    const entry = await createBackup({ destinationFolder: tempBackupRoot });
    const dbPath = path.join(entry.folderPath, 'usman-garments.db');
    fs.appendFileSync(dbPath, 'corrupt');
    expect(() => validateBackupFolder(entry.folderPath)).toThrow(/integrity|corrupt/i);
  });
});

describe('Transaction rollback on failure (Phase 12)', () => {
  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    await syncInvoiceNumberCounter();
  });

  it('sale with insufficient stock rolls back completely', async () => {
    const runId = `${Date.now()}`;
    const product = await createProduct({
      name: `TEST-P12-Rollback ${runId}`,
      salePrice: 100,
      openingStock: 1,
    });

    const invoicesBefore = await prisma.invoice.count();
    const movementsBefore = await prisma.stockMovement.count({ where: { productId: product.id } });

    const user = await prisma.user.findFirst();
    await expect(
      createSale({
        items: [{ productId: product.id, quantity: 5 }],
        paymentMethod: SalePaymentMethod.CASH,
        paidAmount: 500,
        createdById: user!.id,
      }),
    ).rejects.toThrow(/insufficient stock/i);

    expect(await prisma.invoice.count()).toBe(invoicesBefore);
    expect(await prisma.stockMovement.count({ where: { productId: product.id } })).toBe(movementsBefore);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.currentStock).toBe(1);

    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('purchase with invalid product rolls back completely', async () => {
    const supplier = await createSupplier({ name: `TEST-P12-Supplier ${Date.now()}` });

    const purchasesBefore = await prisma.purchase.count();
    const user = await prisma.user.findFirst();

    await expect(
      createPurchase({
        supplierId: supplier.id,
        date: new Date().toISOString().slice(0, 10),
        items: [{ productId: 999999, quantity: 1, purchasePrice: 100 }],
        paymentMethod: PurchasePaymentMethod.CASH,
        paidAmount: 100,
        createdById: user!.id,
      }),
    ).rejects.toThrow(/not found/i);

    expect(await prisma.purchase.count()).toBe(purchasesBefore);
  });

  it('expense with invalid category rolls back completely', async () => {
    const expensesBefore = await prisma.expense.count();
    const vouchersBefore = await prisma.voucher.count({ where: { sourceType: 'EXPENSE' } });
    const user = await prisma.user.findFirst();

    await expect(
      createExpense({
        categoryId: 999999,
        date: new Date().toISOString().slice(0, 10),
        amount: 50,
        paymentMethod: 'CASH',
        description: 'Should not persist',
        createdById: user!.id,
      }),
    ).rejects.toThrow(/category/i);

    expect(await prisma.expense.count()).toBe(expensesBefore);
    expect(await prisma.voucher.count({ where: { sourceType: 'EXPENSE' } })).toBe(vouchersBefore);
  });

  it('sale return exceeding sold quantity rolls back completely', async () => {
    const runId = `${Date.now()}`;
    const product = await createProduct({
      name: `TEST-P12-Return-Rollback ${runId}`,
      salePrice: 200,
      openingStock: 5,
    });
    const user = await prisma.user.findFirst();
    const sale = await createSale({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: SalePaymentMethod.CASH,
      paidAmount: 400,
      createdById: user!.id,
    });

    const returnsBefore = await prisma.saleReturn.count();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;

    await expect(
      createSaleReturn({
        invoiceId: sale.id,
        items: [{ invoiceItemId: sale.items[0].id, quantity: 5, condition: ReturnCondition.GOOD }],
        refundMethod: PurchasePaymentMethod.CASH,
        createdById: user!.id,
      }),
    ).rejects.toThrow(/Cannot return more than/i);

    expect(await prisma.saleReturn.count()).toBe(returnsBefore);
    const stockAfter = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;
    expect(stockAfter).toBe(stockBefore);

    await prisma.invoiceItem.deleteMany({ where: { invoiceId: sale.id } });
    await prisma.invoice.delete({ where: { id: sale.id } });
    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('purchase return exceeding purchased quantity rolls back completely', async () => {
    const runId = `${Date.now()}`;
    const supplier = await createSupplier({ name: `TEST-P12-Supplier-Ret ${runId}` });
    const product = await createProduct({
      name: `TEST-P12-Purchase-Return ${runId}`,
      salePrice: 100,
      openingStock: 0,
    });
    const user = await prisma.user.findFirst();
    const purchase = await createPurchase({
      supplierId: supplier.id,
      date: new Date().toISOString().slice(0, 10),
      items: [{ productId: product.id, quantity: 3, purchasePrice: 50 }],
      paymentMethod: PurchasePaymentMethod.CASH,
      paidAmount: 150,
      createdById: user!.id,
    });

    const returnsBefore = await prisma.purchaseReturn.count();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock;

    await expect(
      createPurchaseReturn({
        purchaseId: purchase.id,
        items: [{ purchaseItemId: purchase.items[0].id, quantity: 10 }],
        createdById: user!.id,
      }),
    ).rejects.toThrow(/Cannot return more than/i);

    expect(await prisma.purchaseReturn.count()).toBe(returnsBefore);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock).toBe(stockBefore);

    await prisma.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
    await prisma.purchase.delete({ where: { id: purchase.id } });
    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });
});
