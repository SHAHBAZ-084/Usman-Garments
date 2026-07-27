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
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
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
