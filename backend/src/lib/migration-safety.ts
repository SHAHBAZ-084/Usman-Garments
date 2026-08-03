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

export function migrationWithoutBackupUserMessage(errorDetail?: string): string {
  const detail = errorDetail?.trim()
    ? `\n\nTechnical details: ${errorDetail.trim().slice(0, 300)}`
    : '';
  return (
    'Database update continued without a safety backup.\n\n' +
    'The pre-update backup could not be created (disk full, permissions, or another system error). ' +
    'The app still applied the update so you are not stuck, but there was no safety net for this attempt.\n\n' +
    'Please create a manual backup from the Backups screen as soon as the app opens.' +
    detail
  );
}

/**
 * User-visible alert when migrate proceeds after a failed pre-migration backup.
 * Object form so tests can spy on the method (same-module function spies are not intercepted).
 */
export const migrationAlerts = {
  withoutBackup(errorDetail?: string): void {
    const body = migrationWithoutBackupUserMessage(errorDetail);
    logger.error('Pre-migration backup failed — continuing with migrate anyway', {
      error: errorDetail ?? 'unknown',
      userNotified: true,
    });
    try {
      // Available when backend is loaded inside the Electron main process.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as {
        dialog?: {
          showMessageBoxSync?: (opts: {
            type: string;
            title: string;
            message: string;
            detail?: string;
            buttons?: string[];
          }) => number;
          showErrorBox?: (title: string, content: string) => void;
        };
      };
      if (electron.dialog?.showMessageBoxSync) {
        electron.dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Update continued without backup',
          message: 'Database update continued without a safety backup',
          detail: body,
          buttons: ['OK'],
        });
      } else {
        electron.dialog?.showErrorBox?.('Update continued without backup', body);
      }
    } catch {
      // Not running inside Electron (e.g. `npm run dev -w backend` / tests).
    }
  },
};

/**
 * Back up (when a real DB with tables exists), then migrate.
 * On migrate failure, restore the live DB from that pre-migration backup
 * so a half-applied migration cannot leave shop data corrupted.
 */
export async function runSafeMigrations(): Promise<{
  applied: string[];
  backup: BackupEntry | null;
  proceededWithoutBackup: boolean;
  backupFailureReason: string | null;
}> {
  const dbPath = getDatabasePath();
  const dbExists = fs.existsSync(dbPath);
  let backup: BackupEntry | null = null;
  let proceededWithoutBackup = false;
  let backupFailureReason: string | null = null;

  if (dbExists) {
    try {
      // Returns null when the DB file exists but has no tables yet (first install).
      // On failure (disk/permissions/etc.), warn the user and still migrate so shops
      // are not permanently stuck on a schema the new binary cannot read.
      backup = await runPreMigrationBackup();
    } catch (err) {
      backupFailureReason = err instanceof Error ? err.message : String(err);
      proceededWithoutBackup = true;
      backup = null;
      migrationAlerts.withoutBackup(backupFailureReason);
    }
  }

  const beforeHash = dbExists && fs.existsSync(dbPath) ? sha256File(dbPath) : null;

  try {
    const migrationsDir = resolveMigrationsDir();
    logger.info('Running in-process migrate deploy', {
      migrationsDir,
      hasBackup: Boolean(backup),
      proceededWithoutBackup,
    });
    const result = await migrateDeployLocal();
    logger.info('Migrate deploy finished', { applied: result.applied, proceededWithoutBackup });
    return { applied: result.applied, backup, proceededWithoutBackup, backupFailureReason };
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
