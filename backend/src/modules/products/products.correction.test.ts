import { beforeEach, describe, expect, it } from 'vitest';
import { PurchasePaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { bootstrapChartOfAccounts } from '../accounting/accounting.service';
import { createPurchase } from '../purchases/purchases.service';
import { createSupplier } from '../suppliers/suppliers.service';
import {
  commitImport,
  previewImportRows,
  type ImportRowInput,
} from './products.import';
import {
  createProduct,
  createProductCategory,
  ensureDefaultProductCategories,
  getProduct,
  listProductCategories,
} from './products.service';

const PREFIX = 'TEST-CORR-';

async function cleanup() {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  if (ids.length) {
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.purchaseItem.deleteMany({ where: { productId: { in: ids } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.productCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

describe('product creation correction', () => {
  let runId: string;

  beforeEach(async () => {
    runId = `${Date.now()}`;
    await cleanup();
    await ensureDefaultProductCategories();
  });

  it('seeds categories and quick-add generates a unique code prefix', async () => {
    const cats = await listProductCategories();
    expect(cats.some((c) => c.name === 'Men Shirts' && c.code === 'MSH')).toBe(true);

    const created = await createProductCategory(`${PREFIX}Custom Jackets ${runId}`);
    expect(created.code.length).toBeGreaterThanOrEqual(2);
    expect(created.code.length).toBeLessThanOrEqual(4);

    const product = await createProduct({
      name: `${PREFIX}Jacket ${runId}`,
      categoryId: created.id,
      salePrice: 2000,
      openingStock: 1,
    });
    expect(product.productCode.startsWith(`${created.code}-`)).toBe(true);
  });

  it('blocks variant allocation exceeding declared total stock', async () => {
    await expect(
      createProduct({
        name: `${PREFIX}Overalloc ${runId}`,
        salePrice: 500,
        openingStock: 5,
        variants: [
          { size: 'S', currentStock: 3 },
          { size: 'M', currentStock: 4 },
        ],
      }),
    ).rejects.toThrow(/exceeds total stock/i);
  });

  it('allows under-allocation and sums variant stocks onto product', async () => {
    const product = await createProduct({
      name: `${PREFIX}Underalloc ${runId}`,
      salePrice: 500,
      openingStock: 5,
      variants: [
        { size: 'S', currentStock: 2 },
        { size: 'M', currentStock: 1 },
      ],
    });
    expect(product.currentStock).toBe(3);
    expect(product.variants).toHaveLength(2);
  });

  it('inherits low-stock from BusinessSettings when not set on product', async () => {
    const settings = await prisma.businessSettings.findFirst();
    const product = await createProduct({
      name: `${PREFIX}LowStock ${runId}`,
      salePrice: 100,
      openingStock: 0,
    });
    expect(product.lowStockLimit).toBeNull();
    expect(product.effectiveLowStockLimit).toBe(settings!.lowStockLimit);
  });

  it('purchase against a variant increases variant stock and product total', async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('need user');
    const date = await voucherDateInActiveYear();

    const supplier = await createSupplier({
      name: `${PREFIX}Sup ${runId}`,
      openingBalance: 0,
    });
    const product = await createProduct({
      name: `${PREFIX}VarBuy ${runId}`,
      salePrice: 800,
      openingStock: 2,
      variants: [
        { size: 'M', currentStock: 1 },
        { size: 'L', currentStock: 1 },
      ],
    });
    const medium = product.variants!.find((v) => v.size === 'M')!;
    const beforeVariant = medium.currentStock;
    const beforeTotal = product.currentStock;

    await createPurchase({
      supplierId: supplier.id,
      date,
      items: [
        {
          productId: product.id,
          variantId: medium.id,
          quantity: 4,
          purchasePrice: 300,
        },
      ],
      paidAmount: 1200,
      paymentMethod: PurchasePaymentMethod.CASH,
      createdById: user.id,
    });

    const refreshed = await getProduct(product.id);
    const refreshedM = refreshed.variants!.find((v) => v.id === medium.id)!;
    expect(refreshedM.currentStock).toBe(beforeVariant + 4);
    expect(refreshed.currentStock).toBe(beforeTotal + 4);
    expect(Number(refreshed.purchasePrice)).toBe(300);
  });

  it('bulk import preview reports bad rows and commit creates only valid groups', async () => {
    const rows: ImportRowInput[] = [
      {
        rowNumber: 2,
        productName: `${PREFIX}Import Shirt ${runId}`,
        category: 'Men Shirts',
        totalStock: '3',
        salePrice: '1200',
        purchasePrice: '700',
        size: 'M',
        colour: 'White',
      },
      {
        rowNumber: 3,
        productName: `${PREFIX}Import Shirt ${runId}`,
        category: 'Men Shirts',
        totalStock: '2',
        salePrice: '1200',
        purchasePrice: '700',
        size: 'L',
        colour: 'White',
      },
      {
        rowNumber: 4,
        productName: `${PREFIX}Import Cap ${runId}`,
        category: `${PREFIX}Hats ${runId}`,
        totalStock: '10',
        salePrice: '350',
        purchasePrice: '',
        size: '',
        colour: '',
      },
      {
        rowNumber: 5,
        productName: '',
        category: 'Men Shirts',
        totalStock: '1',
        salePrice: '100',
        purchasePrice: '',
        size: '',
        colour: '',
      },
      {
        rowNumber: 6,
        productName: `${PREFIX}Bad Price ${runId}`,
        category: 'Men Shirts',
        totalStock: '1',
        salePrice: 'abc',
        purchasePrice: '',
        size: '',
        colour: '',
      },
    ];

    const preview = previewImportRows(rows);
    expect(preview.errorCount).toBe(2);
    expect(preview.productsToCreate).toBe(2);
    expect(preview.errors.some((e) => e.rowNumber === 5)).toBe(true);
    expect(preview.errors.some((e) => e.rowNumber === 6)).toBe(true);

    const shirt = preview.products.find((p) => p.name.includes('Import Shirt'))!;
    expect(shirt.variants).toHaveLength(2);
    expect(shirt.totalStock).toBe(5); // sum of variant rows, not a separate total

    const result = await commitImport(preview.commitPayload);
    expect(result.createdCount).toBe(2);

    const createdShirt = result.products.find((p) => p.name.includes('Import Shirt'))!;
    expect(createdShirt.variants).toHaveLength(2);
    expect(createdShirt.currentStock).toBe(5);
    expect(createdShirt.productCode).toMatch(/^MSH-/);

    const cats = await listProductCategories();
    expect(cats.some((c) => c.name === `${PREFIX}Hats ${runId}`)).toBe(true);
  });
});
