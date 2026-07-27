import { Prisma } from '@prisma/client';
import { AppError } from '../../utils/helpers';

function lettersFromName(name: string, max = 4): string {
  const letters = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (letters.length >= 2) return letters.slice(0, max);
  return 'PRD'.slice(0, max);
}

function variantSuffix(size?: string | null, colour?: string | null): string {
  const parts = [size, colour]
    .map((p) => (p?.trim() ? p.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('') : 'VAR';
}

async function productCodeExists(tx: Prisma.TransactionClient, code: string): Promise<boolean> {
  const [product, variant] = await Promise.all([
    tx.product.findUnique({ where: { sku: code }, select: { id: true } }),
    tx.productVariant.findUnique({ where: { sku: code }, select: { id: true } }),
  ]);
  return Boolean(product || variant);
}

async function barcodeExists(tx: Prisma.TransactionClient, barcode: string): Promise<boolean> {
  const [product, variant] = await Promise.all([
    tx.product.findFirst({ where: { barcode }, select: { id: true } }),
    tx.productVariant.findFirst({ where: { barcode }, select: { id: true } }),
  ]);
  return Boolean(product || variant);
}

/** Readable unique product code stored in the sku column. */
export async function generateUniqueProductCode(
  tx: Prisma.TransactionClient,
  name: string,
  options?: { parentCode?: string; size?: string | null; colour?: string | null },
): Promise<string> {
  const prefix = options?.parentCode
    ? `${options.parentCode}-${variantSuffix(options.size, options.colour)}`
    : lettersFromName(name);

  const baseCount = await tx.product.count();
  for (let attempt = 0; attempt < 200; attempt++) {
    const seq = String(baseCount + attempt + 1).padStart(5, '0');
    const candidate = options?.parentCode
      ? `${prefix}-${seq}`.slice(0, 80)
      : `${prefix}-${seq}`;
    if (!(await productCodeExists(tx, candidate))) return candidate;
  }

  const fallback = `UM-${Date.now()}${Math.floor(Math.random() * 1000)}`;
  if (await productCodeExists(tx, fallback)) {
    throw new AppError(500, 'Could not generate a unique product code');
  }
  return fallback.slice(0, 80);
}

/** Numeric Code128-compatible barcode, unique across products and variants. */
export async function generateUniqueBarcode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const timePart = String(Date.now() % 1_000_000_000).padStart(9, '0');
    const randPart = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const candidate = `890${timePart.slice(-5)}${randPart}`.slice(0, 12);
    if (!(await barcodeExists(tx, candidate))) return candidate;
  }
  throw new AppError(500, 'Could not generate a unique barcode');
}
