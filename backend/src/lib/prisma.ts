import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/paths';

let configured = false;

export const prisma = new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrl() },
  },
});

/** SQLite pragmas for single-instance desktop use: FK enforcement, WAL, busy timeout. */
export async function configureSqlite(): Promise<void> {
  if (configured) return;
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON');
  // journal_mode SET returns the active mode as a row — must use queryRaw, not executeRaw
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  // busy_timeout SET returns the previous timeout value as a row
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  configured = true;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  configured = false;
}

/** Checkpoint WAL and close cleanly on app shutdown. */
export async function shutdownDatabase(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* best effort */
  }
  await prisma.$disconnect();
  configured = false;
}
