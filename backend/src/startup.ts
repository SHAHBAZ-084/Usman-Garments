import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDatabasePath, getDatabaseUrl, isAppDataMode } from './config/paths';
import { logger } from './lib/logger';
import { configureSqlite } from './lib/prisma';
import { runDailyBackupIfNeeded, runPreMigrationBackup } from './modules/backup/backup.service';

const BACKEND_ROOT = path.resolve(__dirname, '..');

export async function runStartupTasks(): Promise<void> {
  process.env.DATABASE_URL = getDatabaseUrl();
  await configureSqlite();

  const dataRoot = path.dirname(getDatabasePath());
  fs.mkdirSync(dataRoot, { recursive: true });

  if (isAppDataMode() && !fs.existsSync(getDatabasePath())) {
    logger.info('First run in AppData — running migrations');
    await runMigrations(true);
  } else if (isAppDataMode()) {
    const pending = hasPendingMigrations();
    if (pending) {
      logger.info('Pending migrations detected — pre-migration backup then migrate');
      await runPreMigrationBackup();
      await runMigrations(false);
    }
  }

  try {
    await runDailyBackupIfNeeded();
  } catch (err) {
    logger.warn('Daily backup skipped', { error: err instanceof Error ? err.message : String(err) });
  }
}

function hasPendingMigrations(): boolean {
  try {
    const out = execSync('npx prisma migrate status', {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: getDatabaseUrl() },
      encoding: 'utf8',
    });
    return /following migration have not yet been applied/i.test(out);
  } catch {
    return false;
  }
}

async function runMigrations(withBackup: boolean) {
  if (withBackup) {
    await runPreMigrationBackup();
  }
  execSync('npx prisma migrate deploy', {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: getDatabaseUrl() },
    stdio: 'pipe',
  });
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
