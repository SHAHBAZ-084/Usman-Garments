import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDatabasePath, getDatabaseUrl, isAppDataMode } from './config/paths';
import { ensureRequiredSchemaColumns } from './lib/ensure-schema';
import { logger } from './lib/logger';
import { configureSqlite, prisma } from './lib/prisma';
import { runDailyBackupIfNeeded, runPreMigrationBackup } from './modules/backup/backup.service';

const BACKEND_ROOT = path.resolve(__dirname, '..');
const CORE_TABLE = 'BusinessSettings';

export class DatabaseMigrationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseMigrationError';
  }
}

function runPrismaCommand(args: string): string {
  const appRoot = path.resolve(BACKEND_ROOT, '..');
  const bundled = path.join(appRoot, 'node_modules', 'prisma', 'build', 'index.js');

  if (fs.existsSync(bundled)) {
    return execSync(`"${process.execPath}" "${bundled}" ${args}`, {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DATABASE_URL: getDatabaseUrl(),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return execSync(`npx prisma ${args}`, {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: getDatabaseUrl() },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function coreTableExists(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${CORE_TABLE}' LIMIT 1`,
    );
    return rows.length > 0;
  } catch (err) {
    logger.error('Failed to check core table existence', {
      table: CORE_TABLE,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function showMigrationFailureDialog() {
  try {
    // Available when backend is loaded inside the Electron main process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      dialog?: { showErrorBox: (title: string, content: string) => void };
    };
    electron.dialog?.showErrorBox(
      'Database update failed',
      'Update failed to apply database changes. Please contact support.',
    );
  } catch {
    // Not running inside Electron (e.g. `npm run dev -w backend`).
  }
}

async function runMigrations(): Promise<void> {
  const dbExists = fs.existsSync(getDatabasePath());
  // Always snapshot before migrate when a DB already exists (update / repair path).
  if (dbExists) {
    try {
      await runPreMigrationBackup();
    } catch (err) {
      logger.error('Pre-migration backup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Still attempt migrate — backup failure shouldn't block schema repair forever,
      // but log loudly. First-run empty DB skips backup above.
    }
  }

  try {
    runPrismaCommand('migrate deploy');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('migrate deploy failed', { error: message });
    showMigrationFailureDialog();
    throw new DatabaseMigrationError(
      'Update failed to apply database changes. Please contact support.',
      err,
    );
  }
}

export async function runStartupTasks(): Promise<void> {
  process.env.DATABASE_URL = getDatabaseUrl();
  await configureSqlite();

  const dataRoot = path.dirname(getDatabasePath());
  fs.mkdirSync(dataRoot, { recursive: true });

  // Never rely solely on migrate status — if the core table is gone, force deploy.
  const dbExists = fs.existsSync(getDatabasePath());
  const hasCore = await coreTableExists();
  if (!hasCore) {
    logger.info(`Core table ${CORE_TABLE} not found after connect — forcing migrate deploy`, {
      dbExists,
      appDataMode: isAppDataMode(),
    });
    await runMigrations();
  } else if (hasPendingMigrations()) {
    logger.info('Pending migrations detected — backing up then migrate deploy');
    await runMigrations();
  }

  // Always reconcile critical columns (covers migrate lock / partial apply)
  try {
    await ensureRequiredSchemaColumns();
  } catch (err) {
    logger.warn('Schema column ensure skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await runDailyBackupIfNeeded();
  } catch (err) {
    logger.warn('Daily backup skipped', { error: err instanceof Error ? err.message : String(err) });
  }

  // Final safety net before the server listens: prove the core table is queryable.
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM ${CORE_TABLE} LIMIT 1`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Post-migration table check failed, forcing migrate deploy', { error: message });
    await runMigrations();
    try {
      await prisma.$queryRawUnsafe(`SELECT 1 FROM ${CORE_TABLE} LIMIT 1`);
    } catch (retryErr) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.error('Core table still missing after forced migrate deploy', { error: retryMessage });
      showMigrationFailureDialog();
      throw new DatabaseMigrationError(
        'Update failed to apply database changes. Please contact support.',
        retryErr,
      );
    }
  }
}

function hasPendingMigrations(): boolean {
  try {
    const out = runPrismaCommand('migrate status');
    return /following migration have not yet been applied/i.test(out);
  } catch (err) {
    logger.error('migrate status check failed', {
      error: err instanceof Error ? err.message : String(err),
      stderr:
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr ?? '')
          : undefined,
    });
    // Fail-safe: assume migrations are pending and force deploy.
    return true;
  }
}

export function registerShutdownHooks() {
  const shutdown = async (signal: string) => {
    logger.info('Shutting down', { signal });
    const { shutdownDatabase } = await import('./lib/prisma');
    await shutdownDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export async function gracefulShutdown() {
  const { shutdownDatabase } = await import('./lib/prisma');
  await shutdownDatabase();
}
