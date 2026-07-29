import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { prisma } from './prisma';

/**
 * Apply Prisma migrations in-process (no Prisma CLI spawn).
 * Packaged Electron cannot reliably run `prisma migrate deploy` because:
 * - shell/cwd inside asar fails with cmd.exe ENOENT
 * - Prisma CLI deps are not fully resolvable from asar.unpacked
 */

function toUnpackedPath(p: string): string {
  return p.replace(/app\.asar(?=$|[\\/])/g, 'app.asar.unpacked');
}

function getElectronResourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function resolveMigrationsDir(): string {
  // Compiled file lives at backend/dist/lib/migrate-local.js → backend root is ../..
  const backendRoot = path.resolve(__dirname, '../..');
  const resources = getElectronResourcesPath();
  const found = firstExisting([
    resources ? path.join(resources, 'prisma', 'migrations') : '',
    toUnpackedPath(path.join(backendRoot, 'prisma', 'migrations')),
    path.join(backendRoot, 'prisma', 'migrations'),
  ]);
  if (!found) {
    throw new Error('Prisma migrations folder not found (packaging error)');
  }
  return found;
}

async function ensureMigrationsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function listAppliedMigrationNames(): Promise<Set<string>> {
  await ensureMigrationsTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  return new Set(rows.map((r) => r.migration_name));
}

function listMigrationFolders(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => {
      const full = path.join(migrationsDir, name);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'migration.sql'));
    })
    .sort();
}

/** Split migration SQL into executable statements (Prisma SQLite migrations are simple DDL). */
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applySqlFile(sql: string): Promise<number> {
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  return statements.length;
}

export async function hasPendingMigrationsLocal(): Promise<boolean> {
  const migrationsDir = resolveMigrationsDir();
  const applied = await listAppliedMigrationNames();
  const folders = listMigrationFolders(migrationsDir);
  return folders.some((name) => !applied.has(name));
}

export async function migrateDeployLocal(): Promise<{ applied: string[] }> {
  const migrationsDir = resolveMigrationsDir();
  const applied = await listAppliedMigrationNames();
  const folders = listMigrationFolders(migrationsDir);
  const newlyApplied: string[] = [];

  for (const name of folders) {
    if (applied.has(name)) continue;

    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const id = crypto.randomUUID().replace(/-/g, '');
    const startedAt = new Date().toISOString();

    logger.info('Applying migration', { name });
    try {
      const steps = await applySqlFile(sql);
      const finishedAt = new Date().toISOString();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
        id,
        checksum,
        finishedAt,
        name,
        startedAt,
        steps,
      );
      newlyApplied.push(name);
      logger.info('Migration applied', { name, steps });
    } catch (err) {
      logger.error('Migration failed', {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return { applied: newlyApplied };
}
