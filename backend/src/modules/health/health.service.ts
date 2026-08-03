import fs from 'fs';
import { StockMovementType } from '@prisma/client';
import { getTrialBalance } from '../accounting/accounting.service';
import {
  estimateBackupBytes,
  getFreeDiskSpaceBytes,
  getLastBackupInfo,
  listBackups,
} from '../backup/backup.service';
import { getDatabasePath, describeDataLocation } from '../../config/paths';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { isStockInType, isStockOutType, manualStockAdjustment } from '../products/products.service';

export type HealthReport = {
  dataLocation: ReturnType<typeof describeDataLocation>;
  databaseIntegrity: { ok: boolean; detail: string };
  trialBalance: { ok: boolean; totalDebit: number; totalCredit: number };
  stockReconciliation: {
    ok: boolean;
    productsChecked: number;
    mismatches: { productId: number; name: string; expected: number; actual: number }[];
  };
  databaseSizeBytes: number;
  freeDiskSpaceBytes: number | null;
  backup: Awaited<ReturnType<typeof getLastBackupInfo>>;
  recentBackups: Awaited<ReturnType<typeof listBackups>>;
};

function expectedStockFromMovements(
  movements: Array<{ type: string; quantity: number; sourceType: string | null }>,
): number {
  let expected = 0;
  for (const m of movements) {
    const qty = m.quantity;
    const t = m.type as StockMovementType;
    // Damaged returns add to damaged inventory only — they never left sellable stock as DAMAGED out.
    if (t === StockMovementType.DAMAGED && m.sourceType === 'SALE_RETURN') continue;
    if (isStockInType(t)) expected += qty;
    else if (isStockOutType(t)) expected -= qty;
  }
  return expected;
}

export async function runHealthCheck(): Promise<HealthReport> {
  let integrityOk = true;
  let integrityDetail = 'OK';
  try {
    const result = await prisma.$queryRaw<{ integrity_check: string }[]>`PRAGMA integrity_check`;
    const msg = result[0]?.integrity_check ?? 'unknown';
    integrityOk = msg === 'ok';
    integrityDetail = msg;
  } catch (err) {
    integrityOk = false;
    integrityDetail = err instanceof Error ? err.message : 'integrity_check failed';
  }

  const tb = await getTrialBalance();

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, currentStock: true },
    take: 200,
  });

  const mismatches: HealthReport['stockReconciliation']['mismatches'] = [];
  for (const p of products) {
    const movements = await prisma.stockMovement.findMany({
      where: { productId: p.id },
      select: { type: true, quantity: true, sourceType: true },
    });
    const expected = expectedStockFromMovements(movements);
    if (expected !== p.currentStock) {
      mismatches.push({
        productId: p.id,
        name: p.name,
        expected,
        actual: p.currentStock,
      });
    }
  }

  const dbPath = getDatabasePath();
  const databaseSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const freeDiskSpaceBytes = await getFreeDiskSpaceBytes(getDatabasePath());

  return {
    dataLocation: describeDataLocation(),
    databaseIntegrity: { ok: integrityOk, detail: integrityDetail },
    trialBalance: {
      ok: tb.isBalanced,
      totalDebit: tb.totalDebit,
      totalCredit: tb.totalCredit,
    },
    stockReconciliation: {
      ok: mismatches.length === 0,
      productsChecked: products.length,
      mismatches: mismatches.slice(0, 20),
    },
    databaseSizeBytes,
    freeDiskSpaceBytes,
    backup: await getLastBackupInfo(),
    recentBackups: (await listBackups()).slice(0, 10),
  };
}

export { estimateBackupBytes, getFreeDiskSpaceBytes };

/**
 * Align on-hand stock with the sum of stock movements (health "Agree / fix" action).
 * Prefer this over dismissing forever when the movement ledger is trusted.
 */
export async function reconcileProductStockToMovements(productId: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: { select: { id: true, currentStock: true } } },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    select: { type: true, quantity: true, sourceType: true },
  });
  const expected = expectedStockFromMovements(movements);

  if (product.variants.length > 0) {
    const variantSum = product.variants.reduce((s, v) => s + v.currentStock, 0);
    if (variantSum === product.currentStock && expected === variantSum) {
      return { productId, expected, actual: product.currentStock, adjusted: 0 };
    }
    // Sync parent to variant sum when movement expected matches variants, else adjust top variant.
    if (expected === variantSum && product.currentStock !== variantSum) {
      await prisma.product.update({ where: { id: productId }, data: { currentStock: variantSum } });
      return { productId, expected, actual: product.currentStock, adjusted: variantSum - product.currentStock };
    }
    const sorted = [...product.variants].sort((a, b) => b.currentStock - a.currentStock);
    const target = sorted[0];
    if (!target) throw new AppError(400, 'No variant to adjust');
    const variantDelta = expected - variantSum;
    if (variantDelta === 0) {
      await prisma.product.update({ where: { id: productId }, data: { currentStock: variantSum } });
      return { productId, expected: variantSum, actual: product.currentStock, adjusted: 0 };
    }
    await manualStockAdjustment(productId, {
      variantId: target.id,
      quantity: Math.abs(variantDelta),
      direction: variantDelta > 0 ? 'add' : 'reduce',
      note: 'Health reconcile: align stock with movements',
    });
    return { productId, expected, actual: product.currentStock, adjusted: variantDelta };
  }

  const delta = expected - product.currentStock;
  if (delta === 0) return { productId, expected, actual: product.currentStock, adjusted: 0 };

  await manualStockAdjustment(productId, {
    quantity: Math.abs(delta),
    direction: delta > 0 ? 'add' : 'reduce',
    note: 'Health reconcile: align stock with movements',
  });
  return { productId, expected, actual: product.currentStock, adjusted: delta };
}
