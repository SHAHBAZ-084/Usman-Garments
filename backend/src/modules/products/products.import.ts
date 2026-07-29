import * as XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createProduct,
  createProductCategory,
  ensureDefaultProductCategories,
  getProduct,
  listProductCategories,
  manualStockAdjustment,
} from './products.service';

export type ImportRowInput = {
  rowNumber: number;
  productName: string;
  category: string;
  totalStock: string;
};

export type ImportRowError = { rowNumber: number; message: string };

export type ImportPreviewProduct = {
  name: string;
  category: string;
  salePrice: number;
  purchasePrice: number;
  totalStock: number;
  needsVariants: boolean;
  mergeIntoProductId?: number;
  action: 'create' | 'merge';
  variants: Array<{ size: string | null; colour: string | null; stock: number }>;
};

export type ImportPreviewResult = {
  validCount: number;
  errorCount: number;
  productsToCreate: number;
  productsToMerge: number;
  errors: ImportRowError[];
  products: ImportPreviewProduct[];
  /** Opaque payload the client sends back on confirm — same validated products. */
  commitPayload: ImportPreviewProduct[];
};

const TEMPLATE_HEADERS: string[] = ['Product Name', 'Category', 'Total Stock'];

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const found = Object.keys(row).find((k) => k.trim().toLowerCase() === key.toLowerCase());
    if (found != null && row[found] != null && String(row[found]).trim() !== '') {
      return String(row[found]).trim();
    }
  }
  return '';
}

function parseNumber(raw: string, field: string, rowNumber: number): { value?: number; error?: string } {
  if (raw === '') return { value: undefined };
  const n = Number(raw);
  if (Number.isNaN(n)) return { error: `Row ${rowNumber}: ${field} must be a number` };
  return { value: n };
}

export function buildImportTemplateBuffer(): Buffer {
  const sample = [
    TEMPLATE_HEADERS,
    ['Cotton Shirt', 'Men Shirts', '10'],
    ['Kids Cap', 'Kids Wear', '20'],
    ['Denim Jacket', 'Outerwear', '5'],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sample);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Products');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function parseImportFile(buffer: Buffer): ImportRowInput[] {
  const book = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new AppError(400, 'Import file has no sheets');
  const sheet = book.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rows.map((row, idx) => ({
    rowNumber: idx + 2, // header is row 1
    productName: cell(row, 'Product Name', 'Name'),
    category: cell(row, 'Category'),
    totalStock: cell(row, 'Total Stock', 'Stock'),
  }));
}

/**
 * Validate import rows. Template is name + category + total stock only.
 * Existing products (same name, case-insensitive) merge stock instead of duplicating.
 */
export async function previewImportRows(rawRows: ImportRowInput[]): Promise<ImportPreviewResult> {
  const errors: ImportRowError[] = [];
  const groups = new Map<
    string,
    {
      name: string;
      category: string;
      totalStock: number;
      rows: number[];
    }
  >();

  for (const row of rawRows) {
    if (!row.productName && !row.category && !row.totalStock) continue;

    if (!row.productName) {
      errors.push({ rowNumber: row.rowNumber, message: 'Product Name is required' });
      continue;
    }
    if (!row.category) {
      errors.push({ rowNumber: row.rowNumber, message: 'Category is required' });
      continue;
    }

    const stock = parseNumber(row.totalStock, 'Total Stock', row.rowNumber);
    if (stock.error) {
      errors.push({ rowNumber: row.rowNumber, message: stock.error.replace(/^Row \d+: /, '') });
      continue;
    }
    if (stock.value == null || !Number.isInteger(stock.value) || stock.value < 0) {
      errors.push({ rowNumber: row.rowNumber, message: 'Total Stock must be a whole number ≥ 0' });
      continue;
    }

    const key = row.productName.trim().toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.totalStock += stock.value;
      existing.rows.push(row.rowNumber);
    } else {
      groups.set(key, {
        name: row.productName.trim(),
        category: row.category.trim(),
        totalStock: stock.value,
        rows: [row.rowNumber],
      });
    }
  }

  const existingProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, variants: { select: { id: true } } },
  });
  const byName = new Map(existingProducts.map((p) => [p.name.trim().toLowerCase(), p]));

  const products: ImportPreviewProduct[] = [];
  for (const group of groups.values()) {
    const match = byName.get(group.name.toLowerCase());
    if (match) {
      products.push({
        name: group.name,
        category: group.category,
        salePrice: 0,
        purchasePrice: 0,
        totalStock: group.totalStock,
        needsVariants: match.variants.length === 0,
        mergeIntoProductId: match.id,
        action: 'merge',
        variants: [],
      });
    } else {
      products.push({
        name: group.name,
        category: group.category,
        salePrice: 0,
        purchasePrice: 0,
        totalStock: group.totalStock,
        needsVariants: true,
        action: 'create',
        variants: [],
      });
    }
  }

  const toCreate = products.filter((p) => p.action === 'create').length;
  const toMerge = products.filter((p) => p.action === 'merge').length;

  return {
    validCount: products.length,
    errorCount: errors.length,
    productsToCreate: toCreate,
    productsToMerge: toMerge,
    errors,
    products,
    commitPayload: products,
  };
}

export async function previewImportBuffer(buffer: Buffer): Promise<ImportPreviewResult> {
  await ensureDefaultProductCategories();
  const rows = parseImportFile(buffer);
  if (rows.length === 0) throw new AppError(400, 'Import file has no data rows');
  return previewImportRows(rows);
}

export async function commitImport(products: ImportPreviewProduct[]) {
  if (!products.length) throw new AppError(400, 'Nothing to import');

  await ensureDefaultProductCategories();
  const categories = await listProductCategories();
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

  const created: Awaited<ReturnType<typeof createProduct>>[] = [];
  const merged: Awaited<ReturnType<typeof createProduct>>[] = [];

  for (const p of products) {
    if (!p.name?.trim()) throw new AppError(400, 'Invalid import payload: missing product name');

    let category = byName.get(p.category.trim().toLowerCase());
    if (!category) {
      category = await createProductCategory(p.category.trim());
      byName.set(category.name.trim().toLowerCase(), category);
    }

    if (p.action === 'merge' && p.mergeIntoProductId) {
      const existing = await prisma.product.findUnique({
        where: { id: p.mergeIntoProductId },
        include: { variants: { select: { id: true, currentStock: true } } },
      });
      if (!existing || !existing.isActive) {
        throw new AppError(400, `Cannot merge into missing product: ${p.name}`);
      }

      const addQty = Math.max(0, Math.floor(p.totalStock));
      if (addQty > 0) {
        if (existing.variants.length > 0) {
          const target = [...existing.variants].sort((a, b) => b.currentStock - a.currentStock)[0]!;
          await manualStockAdjustment(existing.id, {
            variantId: target.id,
            quantity: addQty,
            direction: 'add',
            note: 'Stock import merge',
          });
        } else {
          await manualStockAdjustment(existing.id, {
            quantity: addQty,
            direction: 'add',
            note: 'Stock import merge',
          });
        }
      }

      if (existing.variants.length === 0) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            needsVariants: true,
            categoryId: category.id,
          },
        });
      }

      merged.push(await getProduct(existing.id));
      continue;
    }

    const product = await createProduct({
      name: p.name.trim(),
      categoryId: category.id,
      salePrice: p.salePrice ?? 0,
      purchasePrice: p.purchasePrice ?? 0,
      openingStock: p.totalStock,
      needsVariants: true,
    });
    created.push(product);
  }

  return {
    createdCount: created.length,
    mergedCount: merged.length,
    products: [...created, ...merged],
  };
}
