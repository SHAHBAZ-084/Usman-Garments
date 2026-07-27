import fs from 'fs';
import path from 'path';

const APP_DB_NAME = 'usman-garments.db';

/** True when running under packaged Electron (USMAN_USER_DATA set by main process). */
export function isAppDataMode(): boolean {
  return Boolean(process.env.USMAN_USER_DATA?.trim());
}

/** Root folder for DB, uploads, logs, and default backups. */
export function getDataRoot(): string {
  if (isAppDataMode()) {
    return process.env.USMAN_USER_DATA!.trim();
  }
  return path.resolve(__dirname, '../../prisma/data');
}

export function getDatabasePath(): string {
  if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL?.startsWith('file:')) {
    const fromUrl = process.env.DATABASE_URL.slice(5);
    return path.normalize(fromUrl);
  }
  return path.join(getDataRoot(), APP_DB_NAME);
}

export function getDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const dbPath = getDatabasePath().replace(/\\/g, '/');
  return `file:${dbPath}`;
}

export function getUploadsDir(): string {
  const dir = path.join(getDataRoot(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogsDir(): string {
  const dir = path.join(getDataRoot(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Default backup storage inside user data; manual backups may also use BusinessSettings.backupFolderPath. */
export function getDefaultBackupsDir(): string {
  const dir = path.join(getDataRoot(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveBackupDestination(customFolder?: string | null): string {
  const trimmed = customFolder?.trim();
  if (trimmed) {
    fs.mkdirSync(trimmed, { recursive: true });
    return trimmed;
  }
  return getDefaultBackupsDir();
}

export function describeDataLocation(): {
  mode: 'development' | 'appdata' | 'test';
  dataRoot: string;
  databasePath: string;
} {
  if (process.env.NODE_ENV === 'test') {
    const dbPath = getDatabasePath();
    return {
      mode: 'test',
      dataRoot: path.dirname(dbPath),
      databasePath: dbPath,
    };
  }
  return {
    mode: isAppDataMode() ? 'appdata' : 'development',
    dataRoot: getDataRoot(),
    databasePath: getDatabasePath(),
  };
}
