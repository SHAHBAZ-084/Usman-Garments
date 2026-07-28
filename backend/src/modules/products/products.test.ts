import { beforeEach, describe, expect, it } from 'vitest';
import { StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  adjustStock,
  createProduct,
  deactivateProduct,
  getProductByBarcode,
  manualStockAdjustment,
  updateProduct,
} from './products.service';

const TEST_NAME_PREFIX = 'TEST-P4-';

async function cleanupTestProducts() {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: TEST_NAME_PREFIX } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return;
  await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

describe('products inventory foundation', () => {
  beforeEach(async () => {
    await cleanupTestProducts();
  });

  it('stores purchase price as 0 when omitted, not equal to sale price', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}No Cost`,
      salePrice: 500,
    });

    expect(product.purchasePrice).toBe(0);
    expect(product.purchasePrice).not.toBe(product.salePrice);
    expect(product.costNotSet).toBe(true);

    const updated = await updateProduct(product.id, { purchasePrice: 350 });
    expect(updated.purchasePrice).toBe(350);
    expect(updated.costNotSet).toBe(false);
  });

  it('auto-generates product code and barcode when omitted', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}Auto Identity`,
      salePrice: 500,
      openingStock: 2,
    });

    expect(product.productCode).toBeTruthy();
    expect(product.barcode).toBeTruthy();
    expect(product.productCode.length).toBeGreaterThan(2);
    expect(/^\d+$/.test(product.barcode!)).toBe(true);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.sku).toBe(product.productCode);
    expect(row.barcode).toBe(product.barcode);
  });

  it('never collides when two products are created back-to-back without codes', async () => {
    const first = await createProduct({
      name: `${TEST_NAME_PREFIX}Back To Back A`,
      salePrice: 100,
    });
    const second = await createProduct({
      name: `${TEST_NAME_PREFIX}Back To Back B`,
      salePrice: 120,
    });

    expect(first.productCode).not.toBe(second.productCode);
    expect(first.barcode).not.toBe(second.barcode);
  });

  it('adjustStock never goes negative', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}Shirt`,
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

  it('rejects duplicate product code and barcode with clear messages', async () => {
    await createProduct({
      name: `${TEST_NAME_PREFIX}First`,
      sku: 'TEST-P4-DUP-CODE',
      barcode: '890123456789',
      salePrice: 20,
    });

    await expect(
      createProduct({
        name: `${TEST_NAME_PREFIX}Second`,
        sku: 'TEST-P4-DUP-CODE',
        salePrice: 20,
      }),
    ).rejects.toThrow(/Product code is already in use/i);

    await expect(
      createProduct({
        name: `${TEST_NAME_PREFIX}Third`,
        sku: 'TEST-P4-DUP-CODE-2',
        barcode: '890123456789',
        salePrice: 20,
      }),
    ).rejects.toThrow(/Barcode is already in use/i);
  });

  it('soft-deactivate does not hard-delete and hides from default list', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}Deactivate Me`,
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
      name: `${TEST_NAME_PREFIX}Movement Test`,
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
      name: `${TEST_NAME_PREFIX}Variant Product`,
      salePrice: 150,
      variants: [
        { size: 'S', currentStock: 2 },
        { size: 'M', currentStock: 3 },
      ],
    });

    const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
    const small = variants.find((v) => v.size === 'S');
    expect(small).toBeDefined();
    expect(small!.sku).toBeTruthy();
    expect(small!.barcode).toBeTruthy();

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

  it('looks up product or variant by barcode', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}Barcode Lookup`,
      salePrice: 300,
      variants: [{ size: 'L', currentStock: 1 }],
    });

    const variant = product.variants![0]!;
    const byVariant = await getProductByBarcode(variant.barcode!);
    expect(byVariant.matchType).toBe('variant');
    expect(byVariant.variant?.id).toBe(variant.id);

    // Parent product barcode is not sellable when variants exist — labels use variant barcodes.
    await expect(getProductByBarcode(product.barcode!)).rejects.toThrow(/size\/colour barcode/i);
  });

  it('sale scan matches printed variant barcode even with scanner noise', async () => {
    const product = await createProduct({
      name: `${TEST_NAME_PREFIX}Scan Identity`,
      salePrice: 450,
      openingStock: 3,
      variants: [
        { size: 'M', colour: 'Black', currentStock: 2, salePrice: 450 },
        { size: 'L', colour: 'Red', currentStock: 1, salePrice: 480 },
      ],
    });

    const medium = product.variants!.find((v) => v.size === 'M')!;
    const large = product.variants!.find((v) => v.size === 'L')!;
    expect(medium.barcode).toBeTruthy();
    expect(large.barcode).toBeTruthy();
    expect(medium.barcode).not.toBe(large.barcode);

    // Exact printed CODE128 payload
    const exact = await getProductByBarcode(medium.barcode!);
    expect(exact.matchType).toBe('variant');
    expect(exact.variant?.id).toBe(medium.id);
    expect(exact.variant?.size).toBe('M');
    expect(exact.variant?.colour).toBe('Black');

    // USB scanners often append CR/LF and may include spaces around the value
    const noisy = await getProductByBarcode(`  ${medium.barcode!}\r\n`);
    expect(noisy.variant?.id).toBe(medium.id);

    const other = await getProductByBarcode(large.barcode!);
    expect(other.variant?.id).toBe(large.id);
    expect(other.variant?.size).toBe('L');
  });

  it('returns a clear not-found error for unknown barcodes', async () => {
    await expect(getProductByBarcode('999999999999')).rejects.toThrow(/no product found/i);
    await expect(getProductByBarcode('   ')).rejects.toThrow(/required/i);
  });
});
