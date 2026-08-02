import crypto from 'crypto';
import fs from 'fs';
import { getDatabasePath } from '../config/paths';
import {
  type BackupEntry,
  restoreLiveDatabaseFromBackup,
  runPreMigrationBackup,
} from '../modules/backup/backup.service';
import { logger } from './logger';
import { migrateDeployLocal, resolveMigrationsDir } from './migrate-local';

export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export class MigrationApplyError extends Error {
  constructor(
    message: string,
    readonly backupFolderPath: string | null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MigrationApplyError';
  }
}

/**
 * Back up (when a real DB with tables exists), then migrate.
 * On migrate failure, restore the live DB from that pre-migration backup
 * so a half-applied migration cannot leave shop data corrupted.
 */
export async function runSafeMigrations(): Promise<{
  applied: string[];
  backup: BackupEntry | null;
}> {
  const dbPath = getDatabasePath();
  const dbExists = fs.existsSync(dbPath);
  let backup: BackupEntry | null = null;

  if (dbExists) {
    // Throws if backup fails while tables exist — do not migrate without a snapshot.
    // Returns null when the DB file exists but has no tables yet (first install).
    backup = await runPreMigrationBackup();
  }

  const beforeHash = dbExists && fs.existsSync(dbPath) ? sha256File(dbPath) : null;

  try {
    const migrationsDir = resolveMigrationsDir();
    logger.info('Running in-process migrate deploy', { migrationsDir, hasBackup: Boolean(backup) });
    const result = await migrateDeployLocal();
    logger.info('Migrate deploy finished', { applied: result.applied });
    return { applied: result.applied, backup };
  } catch (err) {
    if (backup) {
      try {
        await restoreLiveDatabaseFromBackup(backup.folderPath);
        const afterHash = fs.existsSync(dbPath) ? sha256File(dbPath) : null;
        logger.info('Restored database from pre-migration backup after migrate failure', {
          backup: backup.folderPath,
          hashMatch: beforeHash != null && beforeHash === afterHash,
        });
      } catch (restoreErr) {
        logger.error('Failed to restore pre-migration backup after migrate failure', {
          backup: backup.folderPath,
          error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new MigrationApplyError(message, backup?.folderPath ?? null, err);
  }
}

export function migrationFailureUserMessage(backupFolderPath?: string | null): string {
  const backupNote = backupFolderPath
    ? ` Your previous data is safe in the pre-migration backup:\n${backupFolderPath}`
    : ' If a pre-migration backup was created, restore it from the Backups screen or contact support.';
  return `Update failed to apply database changes.${backupNote}\n\nPlease contact support. Do not keep using the app until this is resolved.`;
}
