import fs from 'fs';
import { getTrialBalance } from '../accounting/accounting.service';
import {
  estimateBackupBytes,
  getFreeDiskSpaceBytes,
  getLastBackupInfo,
  listBackups,
} from '../backup/backup.service';
import { getDatabasePath, describeDataLocation } from '../../config/paths';
import { prisma } from '../../lib/prisma';

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
    const movements = await prisma.stockMovement.groupBy({
      by: ['type'],
      where: { productId: p.id },
      _sum: { quantity: true },
    });
    let expected = 0;
    for (const m of movements) {
      const qty = m._sum.quantity ?? 0;
      const t = m.type;
      if (t === 'SALE' || t === 'MANUAL_REDUCE' || t === 'PURCHASE_RETURN' || t === 'CANCELLATION') {
        expected -= qty;
      } else if (t !== 'DAMAGED') {
        expected += qty;
      }
    }
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
