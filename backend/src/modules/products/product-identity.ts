import { Prisma } from '@prisma/client';
import { AppError } from '../../utils/helpers';

const RESERVED_CODES = new Set(['PRD', 'VAR', 'UM']);

/** Derive a 2–4 letter category code from a display name. */
export function deriveCategoryCodeCandidate(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_+/]+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(Boolean);

  if (words.length >= 2) {
    const initials = words.map((w) => w[0]!).join('').slice(0, 4);
    if (initials.length >= 2) return initials;
  }

  const letters = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (letters.length >= 3) return letters.slice(0, 3);
  if (letters.length >= 2) return letters.slice(0, 2);
  return 'CAT';
}

export async function generateUniqueCategoryCode(
  tx: Prisma.TransactionClient | typeof import('../../lib/prisma').prisma,
  name: string,
): Promise<string> {
  const base = deriveCategoryCodeCandidate(name);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base.slice(0, 3)}${attempt}`.slice(0, 4).toUpperCase();
    if (RESERVED_CODES.has(candidate)) continue;
    const existing = await tx.productCategory.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  const fallback = `C${Date.now().toString().slice(-3)}`;
  return fallback.slice(0, 4);
}

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

/** Readable unique product code stored in the sku column. Prefixed with category code when provided. */
export async function generateUniqueProductCode(
  tx: Prisma.TransactionClient,
  name: string,
  options?: {
    parentCode?: string;
    size?: string | null;
    colour?: string | null;
    categoryCode?: string | null;
  },
): Promise<string> {
  const categoryPrefix = options?.categoryCode?.trim().toUpperCase() || null;

  const prefix = options?.parentCode
    ? `${options.parentCode}-${variantSuffix(options.size, options.colour)}`
    : categoryPrefix || lettersFromName(name);

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

/**
 * Numeric Code128-compatible barcode. When categoryCode is provided, embeds a
 * numeric fingerprint of the category into the middle digits for uniqueness grouping.
 */
export async function generateUniqueBarcode(
  tx: Prisma.TransactionClient,
  options?: { categoryCode?: string | null },
): Promise<string> {
  const cat = options?.categoryCode?.trim().toUpperCase() || '';
  let catDigits = '00';
  if (cat) {
    let hash = 0;
    for (let i = 0; i < cat.length; i++) hash = (hash + cat.charCodeAt(i) * (i + 1)) % 100;
    catDigits = String(hash).padStart(2, '0');
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    const timePart = String(Date.now() % 1_000_000_000).padStart(9, '0');
    const randPart = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const candidate = `890${catDigits}${timePart.slice(-4)}${randPart.slice(0, 4)}`.slice(0, 12);
    if (!(await barcodeExists(tx, candidate))) return candidate;
  }
  throw new AppError(500, 'Could not generate a unique barcode');
}
