import fs from 'fs';
import path from 'path';
import { getDatabasePath, getDatabaseUrl, isAppDataMode } from './config/paths';
import { ensureRequiredSchemaColumns } from './lib/ensure-schema';
import { ensureFirstRunDefaults } from './lib/first-run';
import { logger } from './lib/logger';
import { hasPendingMigrationsLocal } from './lib/migrate-local';
import {
  MigrationApplyError,
  migrationFailureUserMessage,
  runSafeMigrations,
} from './lib/migration-safety';
import { configureSqlite, prisma } from './lib/prisma';
import { runDailyBackupIfNeeded } from './modules/backup/backup.service';

const CORE_TABLE = 'BusinessSettings';

export class DatabaseMigrationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseMigrationError';
  }
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

function showMigrationFailureDialog(detail?: string, backupFolderPath?: string | null) {
  try {
    // Available when backend is loaded inside the Electron main process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      dialog?: { showErrorBox: (title: string, content: string) => void };
    };
    const body = migrationFailureUserMessage(backupFolderPath);
    const extra = detail ? `\n\nTechnical details: ${detail.slice(0, 300)}` : '';
    electron.dialog?.showErrorBox('Database update failed', `${body}${extra}`);
  } catch {
    // Not running inside Electron (e.g. `npm run dev -w backend`).
  }
}

/** Exported for tests — backup-then-migrate with restore-on-failure. */
export async function runMigrations(): Promise<void> {
  try {
    await runSafeMigrations();
  } catch (err) {
    const backupPath = err instanceof MigrationApplyError ? err.backupFolderPath : null;
    const message = err instanceof Error ? err.message : String(err);
    logger.error('migrate deploy failed', { error: message, backupPath });
    showMigrationFailureDialog(message, backupPath);
    throw new DatabaseMigrationError(migrationFailureUserMessage(backupPath), err);
  }
}

export async function runStartupTasks(): Promise<void> {
  process.env.DATABASE_URL = getDatabaseUrl();
  await configureSqlite();

  const dataRoot = path.dirname(getDatabasePath());
  fs.mkdirSync(dataRoot, { recursive: true });

  const dbExists = fs.existsSync(getDatabasePath());
  const hasCore = await coreTableExists();
  if (!hasCore) {
    logger.info(`Core table ${CORE_TABLE} not found after connect — forcing migrate deploy`, {
      dbExists,
      appDataMode: isAppDataMode(),
    });
    await runMigrations();
  } else {
    try {
      if (await hasPendingMigrationsLocal()) {
        logger.info('Pending migrations detected — backing up then migrate deploy');
        await runMigrations();
      }
    } catch (err) {
      // hasPendingMigrationsLocal itself failed — force safe migrate path.
      if (err instanceof DatabaseMigrationError) throw err;
      logger.error('migrate status check failed — forcing migrate deploy', {
        error: err instanceof Error ? err.message : String(err),
      });
      await runMigrations();
    }
  }

  try {
    await ensureRequiredSchemaColumns();
  } catch (err) {
    logger.warn('Schema column ensure skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await ensureFirstRunDefaults();
  } catch (err) {
    logger.error('First-run defaults failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await runDailyBackupIfNeeded();
  } catch (err) {
    logger.warn('Daily backup skipped', { error: err instanceof Error ? err.message : String(err) });
  }

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
      showMigrationFailureDialog(retryMessage);
      throw new DatabaseMigrationError(migrationFailureUserMessage(null), retryErr);
    }
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
