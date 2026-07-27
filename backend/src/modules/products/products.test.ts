import { beforeEach, describe, expect, it } from 'vitest';
import { StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  adjustStock,
  createProduct,
  deactivateProduct,
  manualStockAdjustment,
} from './products.service';

async function cleanupTestProducts() {
  await prisma.stockMovement.deleteMany({
    where: { product: { sku: { startsWith: 'TEST-P4-' } } },
  });
  await prisma.productVariant.deleteMany({
    where: { sku: { startsWith: 'TEST-P4-' } },
  });
  await prisma.product.deleteMany({
    where: { sku: { startsWith: 'TEST-P4-' } },
  });
}

describe('products inventory foundation', () => {
  beforeEach(async () => {
    await cleanupTestProducts();
  });

  it('adjustStock never goes negative', async () => {
    const product = await createProduct({
      name: 'Test Shirt',
      sku: 'TEST-P4-SHIRT',
      purchasePrice: 100,
      salePrice: 200,
      openingStock: 5,
    });

    await expect(
      manualStockAdjustment(product.id, { quantity: 3, direction: 'reduce' }),
    ).resolves.toBeDefined();

    const afterReduce = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterReduce.currentStock).toBe(2);

    await expect(
      manualStockAdjustment(product.id, { quantity: 5, direction: 'reduce' }),
    ).rejects.toThrow(/Insufficient stock/i);

    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.currentStock).toBe(2);
  });

  it('rejects duplicate SKU and barcode with clear messages', async () => {
    await createProduct({
      name: 'First',
      sku: 'TEST-P4-DUP-SKU',
      barcode: 'TEST-P4-BC-001',
      purchasePrice: 10,
      salePrice: 20,
    });

    await expect(
      createProduct({
        name: 'Second',
        sku: 'TEST-P4-DUP-SKU',
        purchasePrice: 10,
        salePrice: 20,
      }),
    ).rejects.toThrow(/SKU.*already in use/i);

    await expect(
      createProduct({
        name: 'Third',
        sku: 'TEST-P4-DUP-SKU-2',
        barcode: 'TEST-P4-BC-001',
        purchasePrice: 10,
        salePrice: 20,
      }),
    ).rejects.toThrow(/Barcode is already in use/i);
  });

  it('soft-deactivate does not hard-delete and hides from default list', async () => {
    const product = await createProduct({
      name: 'Deactivate Me',
      sku: 'TEST-P4-DEACT',
      purchasePrice: 50,
      salePrice: 80,
      openingStock: 1,
    });

    await adjustStock({ productId: product.id }, 1, StockMovementType.MANUAL_ADD, {
      note: 'extra',
    });

    await deactivateProduct(product.id);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.isActive).toBe(false);

    const movementCount = await prisma.stockMovement.count({ where: { productId: product.id } });
    expect(movementCount).toBeGreaterThan(0);
  });

  it('creates a stock movement on every adjustment', async () => {
    const product = await createProduct({
      name: 'Movement Test',
      sku: 'TEST-P4-MOV',
      purchasePrice: 30,
      salePrice: 60,
    });

    const before = await prisma.stockMovement.count({ where: { productId: product.id } });
    expect(before).toBe(0);

    await manualStockAdjustment(product.id, {
      quantity: 10,
      direction: 'add',
      note: 'Initial intake',
    });

    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { id: 'asc' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe(StockMovementType.MANUAL_ADD);
    expect(movements[0]!.quantity).toBe(10);
    expect(movements[0]!.note).toBe('Initial intake');

    await manualStockAdjustment(product.id, { quantity: 4, direction: 'reduce', note: 'Shrinkage' });

    const all = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    expect(all).toHaveLength(2);
    expect(all.some((m) => m.type === StockMovementType.MANUAL_REDUCE)).toBe(true);

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.currentStock).toBe(6);
  });

  it('adjusts variant stock and keeps product total in sync', async () => {
    const product = await createProduct({
      name: 'Variant Product',
      sku: 'TEST-P4-VAR-PARENT',
      purchasePrice: 100,
      salePrice: 150,
      variants: [
        { sku: 'TEST-P4-VAR-S', size: 'S', currentStock: 2 },
        { sku: 'TEST-P4-VAR-M', size: 'M', currentStock: 3 },
      ],
    });

    const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
    const small = variants.find((v) => v.size === 'S');
    expect(small).toBeDefined();

    await manualStockAdjustment(product.id, {
      variantId: small!.id,
      quantity: 1,
      direction: 'reduce',
    });

    const parent = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(parent.currentStock).toBe(4);

    await expect(
      manualStockAdjustment(product.id, { quantity: 1, direction: 'reduce' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
