import { prisma } from './prisma';
import { logger } from './logger';

type ColumnRow = { name: string };

async function tableColumns(table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<ColumnRow[]>(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((r) => r.name));
}

async function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = await tableColumns(table);
  if (cols.has(column)) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
  logger.info('Added missing schema column', { table, column });
}

/**
 * Guarantees critical columns exist even when `prisma migrate deploy`
 * did not run (common in local/dev) or was blocked by a DB lock.
 */
export async function ensureRequiredSchemaColumns(): Promise<void> {
  await addColumnIfMissing(
    'BusinessSettings',
    'developerCreditLine',
    `"developerCreditLine" TEXT NOT NULL DEFAULT 'AS Solutions — Ali & Shahbaz — 0322-0726006'`,
  );
  await addColumnIfMissing('User', 'role', `"role" TEXT DEFAULT 'Owner'`);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET role = 'Owner' WHERE role IS NULL OR TRIM(role) = ''`,
  );
}
