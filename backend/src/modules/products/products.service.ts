import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { ensureBusinessSettings } from '../settings/settings.service';
import { generateUniqueBarcode, generateUniqueCategoryCode, generateUniqueProductCode } from './product-identity';

export const DEFAULT_PRODUCT_CATEGORIES: { name: string; code: string }[] = [
  { name: 'Men Shirts', code: 'MSH' },
  { name: 'Men Pants', code: 'MPN' },
  { name: 'Women Kurta', code: 'WKU' },
  { name: 'Kids Wear', code: 'KDW' },
  { name: 'Accessories', code: 'ACC' },
  { name: 'Footwear', code: 'FTW' },
];

/** Idempotent seed of starting garment categories. */
export async function ensureDefaultProductCategories() {
  for (const row of DEFAULT_PRODUCT_CATEGORIES) {
    const byName = await prisma.productCategory.findUnique({ where: { name: row.name } });
    if (byName) {
      if (!byName.code) {
        // legacy safety — code is required in schema after migration
      }
      continue;
    }
    const codeTaken = await prisma.productCategory.findUnique({ where: { code: row.code } });
    await prisma.productCategory.create({
      data: {
        name: row.name,
        code: codeTaken ? `${row.code}X` : row.code,
      },
    });
  }
}

const STOCK_IN_TYPES: StockMovementType[] = [
  StockMovementType.OPENING,
  StockMovementType.PURCHASE,
  StockMovementType.SALE_RETURN,
  StockMovementType.MANUAL_ADD,
  StockMovementType.CORRECTION,
];

const STOCK_OUT_TYPES: StockMovementType[] = [
  StockMovementType.SALE,
  StockMovementType.PURCHASE_RETURN,
  StockMovementType.MANUAL_REDUCE,
  StockMovementType.DAMAGED,
  StockMovementType.CANCELLATION,
];

export function isStockInType(type: StockMovementType): boolean {
  return STOCK_IN_TYPES.includes(type);
}

export function isStockOutType(type: StockMovementType): boolean {
  return STOCK_OUT_TYPES.includes(type);
}

export function stockDeltaForType(type: StockMovementType, quantity: number): number {
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    throw new AppError(400, 'Quantity must be a positive integer');
  }
  if (isStockInType(type)) return quantity;
  if (isStockOutType(type)) return -quantity;
  if (type === StockMovementType.EXCHANGE) {
    throw new AppError(400, 'EXCHANGE stock movements are not supported in manual adjustment');
  }
  throw new AppError(400, `Unsupported stock movement type: ${type}`);
}

function mapUniqueConstraint(err: unknown, field: string, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError(409, message);
  }
  throw err;
}

async function syncProductStockFromVariants(tx: Prisma.TransactionClient, productId: number) {
  const agg = await tx.productVariant.aggregate({
    where: { productId },
    _sum: { currentStock: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { currentStock: agg._sum.currentStock ?? 0 },
  });
}

export type AdjustStockTarget =
  | { productId: number; variantId?: undefined }
  | { productId: number; variantId: number };

export type AdjustStockOptions = {
  note?: string;
  sourceType?: string;
  sourceRef?: string;
};

/** Single choke point for all stock changes. Must run inside caller's transaction. */
export async function adjustStockInTx(
  tx: Prisma.TransactionClient,
  target: AdjustStockTarget,
  quantity: number,
  type: StockMovementType,
  options: AdjustStockOptions = {},
) {
  const delta = stockDeltaForType(type, quantity);

  const product = await tx.product.findUnique({
    where: { id: target.productId },
    include: { variants: { select: { id: true } } },
  });
  if (!product) throw new AppError(404, 'Product not found');
  if (!product.isActive) throw new AppError(400, 'Cannot adjust stock for an inactive product');

  const hasVariants = product.variants.length > 0;

  if (hasVariants && target.variantId == null) {
    throw new AppError(400, 'Select a variant — this product has size/colour variants');
  }
  if (!hasVariants && target.variantId != null) {
    throw new AppError(400, 'This product has no variants — adjust stock on the product directly');
  }

  let newStock: number;

  if (target.variantId != null) {
    const variant = await tx.productVariant.findFirst({
      where: { id: target.variantId, productId: target.productId },
    });
    if (!variant) throw new AppError(404, 'Variant not found for this product');

    newStock = variant.currentStock + delta;
    if (newStock < 0) {
      throw new AppError(400, `Insufficient stock: current ${variant.currentStock}, requested reduction ${quantity}`);
    }

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { currentStock: newStock },
    });
    await syncProductStockFromVariants(tx, target.productId);
  } else {
    newStock = product.currentStock + delta;
    if (newStock < 0) {
      throw new AppError(400, `Insufficient stock: current ${product.currentStock}, requested reduction ${quantity}`);
    }
    await tx.product.update({
      where: { id: target.productId },
      data: { currentStock: newStock },
    });
  }

  const movement = await tx.stockMovement.create({
    data: {
      productId: target.productId,
      variantId: target.variantId ?? null,
      type,
      quantity,
      note: options.note?.trim() || null,
      sourceType: options.sourceType?.trim() || null,
      sourceRef: options.sourceRef?.trim() || null,
    },
  });

  return { movement, newStock };
}

export async function adjustStock(
  target: AdjustStockTarget,
  quantity: number,
  type: StockMovementType,
  options: AdjustStockOptions = {},
) {
  return prisma.$transaction((tx) => adjustStockInTx(tx, target, quantity, type, options));
}

export type ProductListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  categoryId?: number;
  activeOnly?: boolean;
};

function serializeProduct(row: {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: number | null;
  brand: string | null;
  purchasePrice: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  currentStock: number;
  lowStockLimit: number | null;
  supplierId: number | null;
  imagePath: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: { id: number; name: string; code?: string } | null;
  variants?: Array<{
    id: number;
    size: string | null;
    colour: string | null;
    sku: string;
    barcode: string | null;
    purchasePrice: Prisma.Decimal | null;
    salePrice: Prisma.Decimal | null;
    currentStock: number;
  }>;
}, defaultLowStockLimit: number) {
  const effectiveLow = row.lowStockLimit ?? defaultLowStockLimit;
  const { sku, variants, ...rest } = row;
  return {
    ...rest,
    productCode: sku,
    purchasePrice: Number(row.purchasePrice),
    salePrice: Number(row.salePrice),
    costNotSet: Number(row.purchasePrice) === 0,
    effectiveLowStockLimit: effectiveLow,
    isLowStock: row.currentStock <= effectiveLow,
    category: row.category
      ? { id: row.category.id, name: row.category.name, code: row.category.code ?? '' }
      : null,
    variants: variants?.map((v) => {
      const { sku: variantSku, ...variantRest } = v;
      return {
        ...variantRest,
        productCode: variantSku,
        purchasePrice: v.purchasePrice != null ? Number(v.purchasePrice) : null,
        salePrice: v.salePrice != null ? Number(v.salePrice) : null,
      };
    }),
  };
}

export async function listProductCategories() {
  await ensureDefaultProductCategories();
  return prisma.productCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
}

export async function createProductCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, 'Category name is required');
  try {
    const code = await generateUniqueCategoryCode(prisma, trimmed);
    return await prisma.productCategory.create({ data: { name: trimmed, code } });
  } catch (err) {
    mapUniqueConstraint(err, 'name', `Product category "${trimmed}" already exists`);
  }
}

export async function listProducts(params: ProductListParams = {}) {
  const settings = await ensureBusinessSettings();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.ProductWhereInput = {};
  if (params.activeOnly !== false) where.isActive = true;
  if (params.categoryId != null) where.categoryId = params.categoryId;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q } },
      { sku: { contains: q } },
      { barcode: { contains: q } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, code: true } },
        variants: {
          select: {
            id: true,
            size: true,
            colour: true,
            sku: true,
            barcode: true,
            purchasePrice: true,
            salePrice: true,
            currentStock: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map((r) => serializeProduct(r, settings.lowStockLimit)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    defaultLowStockLimit: settings.lowStockLimit,
  };
}

export async function getProduct(id: number) {
  const settings = await ensureBusinessSettings();
  const row = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, code: true } },
      variants: {
        orderBy: [{ size: 'asc' }, { colour: 'asc' }],
      },
    },
  });
  if (!row) throw new AppError(404, 'Product not found');
  return serializeProduct(row, settings.lowStockLimit);
}

export type CreateProductInput = {
  name: string;
  sku?: string;
  barcode?: string | null;
  categoryId?: number | null;
  brand?: string | null;
  purchasePrice?: number;
  salePrice: number;
  lowStockLimit?: number | null;
  supplierId?: number | null;
  imagePath?: string | null;
  notes?: string | null;
  variants?: Array<{
    size?: string | null;
    colour?: string | null;
    sku?: string;
    barcode?: string | null;
    purchasePrice?: number | null;
    salePrice?: number | null;
    currentStock?: number;
  }>;
  openingStock?: number;
};

export async function createProduct(input: CreateProductInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Product name is required');

  const salePrice = input.salePrice;
  const purchasePrice = input.purchasePrice ?? 0;
  if (purchasePrice < 0 || salePrice < 0) {
    throw new AppError(400, 'Prices must be zero or greater');
  }

  const variants = (input.variants ?? []).filter(
    (v) => (v.size?.trim() || v.colour?.trim() || (v.currentStock ?? 0) > 0),
  );
  const declaredTotal = Math.max(0, Math.floor(input.openingStock ?? 0));
  const variantSum = variants.reduce((s, v) => s + Math.max(0, Math.floor(v.currentStock ?? 0)), 0);

  if (variants.length > 0 && variantSum > declaredTotal && declaredTotal > 0) {
    throw new AppError(
      400,
      `Variant stock (${variantSum}) exceeds total stock (${declaredTotal})`,
    );
  }
  // When variants exist but no declared total was given, treat sum as the total.
  if (variants.length > 0 && declaredTotal === 0 && variantSum === 0) {
    // allowed — empty opening stock
  }

  try {
    const productId = await prisma.$transaction(async (tx) => {
      let categoryCode: string | null = null;
      if (input.categoryId) {
        const cat = await tx.productCategory.findUnique({ where: { id: input.categoryId } });
        categoryCode = cat?.code ?? null;
      }

      const productCode =
        input.sku?.trim() ||
        (await generateUniqueProductCode(tx, name, { categoryCode }));
      const productBarcode =
        input.barcode?.trim() || (await generateUniqueBarcode(tx, { categoryCode }));

      const product = await tx.product.create({
        data: {
          name,
          sku: productCode,
          barcode: productBarcode,
          categoryId: input.categoryId ?? null,
          brand: input.brand?.trim() || null,
          purchasePrice,
          salePrice,
          lowStockLimit: input.lowStockLimit ?? null,
          supplierId: input.supplierId ?? null,
          imagePath: input.imagePath?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });

      for (const v of variants) {
        const variantCode =
          v.sku?.trim() ||
          (await generateUniqueProductCode(tx, name, {
            parentCode: productCode,
            size: v.size,
            colour: v.colour,
            categoryCode,
          }));
        const variantBarcode =
          v.barcode?.trim() || (await generateUniqueBarcode(tx, { categoryCode }));

        const created = await tx.productVariant.create({
          data: {
            productId: product.id,
            size: v.size?.trim() || null,
            colour: v.colour?.trim() || null,
            sku: variantCode,
            barcode: variantBarcode,
            purchasePrice: v.purchasePrice ?? null,
            salePrice: v.salePrice ?? null,
            currentStock: 0,
          },
        });

        const openingQty = Math.max(0, Math.floor(v.currentStock ?? 0));
        if (openingQty > 0) {
          await adjustStockInTx(
            tx,
            { productId: product.id, variantId: created.id },
            openingQty,
            StockMovementType.OPENING,
            { note: 'Opening stock on variant create' },
          );
        }
      }

      if (variants.length === 0 && declaredTotal > 0) {
        await adjustStockInTx(
          tx,
          { productId: product.id },
          declaredTotal,
          StockMovementType.OPENING,
          { note: 'Opening stock on product create' },
        );
      }

      return product.id;
    });

    return getProduct(productId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = String(err.meta?.target ?? '');
      if (target.includes('sku')) throw new AppError(409, 'Product code is already in use');
      if (target.includes('barcode')) throw new AppError(409, 'Barcode is already in use');
      throw new AppError(409, 'Duplicate product code or barcode');
    }
    throw err;
  }
}

export type UpdateProductInput = Partial<Omit<CreateProductInput, 'variants'>>;

export async function updateProduct(id: number, input: UpdateProductInput) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Product not found');

  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AppError(400, 'Product name is required');
    data.name = name;
  }
  if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  if (input.brand !== undefined) data.brand = input.brand?.trim() || null;
  if (input.purchasePrice !== undefined) {
    if (input.purchasePrice < 0) throw new AppError(400, 'Purchase price must be zero or greater');
    data.purchasePrice = input.purchasePrice;
  }
  if (input.salePrice !== undefined) {
    if (input.salePrice < 0) throw new AppError(400, 'Sale price must be zero or greater');
    data.salePrice = input.salePrice;
  }
  if (input.lowStockLimit !== undefined) data.lowStockLimit = input.lowStockLimit;
  if (input.supplierId !== undefined) {
    data.supplier = input.supplierId ? { connect: { id: input.supplierId } } : { disconnect: true };
  }
  if (input.imagePath !== undefined) data.imagePath = input.imagePath?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  try {
    await prisma.product.update({ where: { id }, data });
    return getProduct(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Duplicate product code or barcode');
    }
    throw err;
  }
}

export async function deactivateProduct(id: number) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, 'Product not found');

  const updated = await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });
  return updated;
}

export type CreateVariantInput = {
  size?: string | null;
  colour?: string | null;
  sku?: string;
  barcode?: string | null;
  purchasePrice?: number | null;
  salePrice?: number | null;
  openingStock?: number;
};

export async function createProductVariant(productId: number, input: CreateVariantInput) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: { select: { id: true } } },
  });
  if (!product) throw new AppError(404, 'Product not found');
  if (!product.isActive) throw new AppError(400, 'Cannot add variants to an inactive product');

  try {
    return await prisma.$transaction(async (tx) => {
      const variantCode =
        input.sku?.trim() ||
        (await generateUniqueProductCode(tx, product.name, {
          parentCode: product.sku,
          size: input.size,
          colour: input.colour,
        }));
      const variantBarcode = input.barcode?.trim() || (await generateUniqueBarcode(tx));

      const variant = await tx.productVariant.create({
        data: {
          productId,
          size: input.size?.trim() || null,
          colour: input.colour?.trim() || null,
          sku: variantCode,
          barcode: variantBarcode,
          purchasePrice: input.purchasePrice ?? null,
          salePrice: input.salePrice ?? null,
          currentStock: 0,
        },
      });

      const openingQty = input.openingStock ?? 0;
      if (openingQty > 0) {
        await adjustStockInTx(
          tx,
          { productId, variantId: variant.id },
          openingQty,
          StockMovementType.OPENING,
          { note: 'Opening stock on variant create' },
        );
      } else {
        await syncProductStockFromVariants(tx, productId);
      }

      const { sku, ...rest } = variant;
      return { ...rest, productCode: sku };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Product code or barcode is already in use');
    }
    throw err;
  }
}

export type UpdateVariantInput = Partial<Omit<CreateVariantInput, 'openingStock'>>;

export async function updateProductVariant(productId: number, variantId: number, input: UpdateVariantInput) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
  });
  if (!variant) throw new AppError(404, 'Variant not found');

  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.size !== undefined) data.size = input.size?.trim() || null;
  if (input.colour !== undefined) data.colour = input.colour?.trim() || null;
  if (input.purchasePrice !== undefined) data.purchasePrice = input.purchasePrice;
  if (input.salePrice !== undefined) data.salePrice = input.salePrice;

  try {
    const updated = await prisma.productVariant.update({ where: { id: variantId }, data });
    const { sku, ...rest } = updated;
    return { ...rest, productCode: sku };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Duplicate product code or barcode');
    }
    throw err;
  }
}

export async function manualStockAdjustment(
  productId: number,
  input: {
    variantId?: number;
    quantity: number;
    direction: 'add' | 'reduce';
    note?: string;
  },
) {
  const type =
    input.direction === 'add' ? StockMovementType.MANUAL_ADD : StockMovementType.MANUAL_REDUCE;

  const target: AdjustStockTarget =
    input.variantId != null
      ? { productId, variantId: input.variantId }
      : { productId };

  return adjustStock(target, input.quantity, type, { note: input.note });
}

export async function listStockMovements(
  productId: number,
  params: { variantId?: number; page?: number; pageSize?: number } = {},
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError(404, 'Product not found');

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const where: Prisma.StockMovementWhereInput = { productId };
  if (params.variantId != null) where.variantId = params.variantId;

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: {
        variant: { select: { id: true, size: true, colour: true, sku: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    items: items.map((row) => ({
      ...row,
      variant: row.variant
        ? {
            id: row.variant.id,
            size: row.variant.size,
            colour: row.variant.colour,
            productCode: row.variant.sku,
          }
        : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProductByBarcode(barcode: string) {
  const trimmed = barcode.trim();
  if (!trimmed) throw new AppError(400, 'Barcode is required');

  const settings = await ensureBusinessSettings();

  const variantRow = await prisma.productVariant.findFirst({
    where: { barcode: trimmed },
    include: {
      product: {
        include: {
          category: { select: { id: true, name: true, code: true } },
          variants: { orderBy: [{ size: 'asc' }, { colour: 'asc' }] },
        },
      },
    },
  });

  if (variantRow) {
    const product = serializeProduct(variantRow.product, settings.lowStockLimit);
    const variant = product.variants?.find((v) => v.id === variantRow.id) ?? null;
    return {
      matchType: 'variant' as const,
      product,
      variant,
    };
  }

  const productRow = await prisma.product.findFirst({
    where: { barcode: trimmed },
    include: {
      category: { select: { id: true, name: true, code: true } },
      variants: { orderBy: [{ size: 'asc' }, { colour: 'asc' }] },
    },
  });

  if (!productRow) throw new AppError(404, 'No product found for this barcode');

  return {
    matchType: 'product' as const,
    product: serializeProduct(productRow, settings.lowStockLimit),
    variant: null,
  };
}
