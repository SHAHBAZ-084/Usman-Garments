import fs from 'fs';
import path from 'path';
import { getLogsDir } from '../config/paths';

const MAX_LOG_FILES = 10;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function logFilePath(name: string) {
  return path.join(getLogsDir(), name);
}

function rotateIfNeeded(file: string) {
  try {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).size < MAX_LOG_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(file, `${file}.${stamp}`);
    const dir = path.dirname(file);
    const base = path.basename(file);
    const rotated = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + '.'))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const old of rotated.slice(MAX_LOG_FILES - 1)) {
      fs.unlinkSync(old);
    }
  } catch {
    /* ignore rotation errors */
  }
}

function append(level: string, message: string, meta?: Record<string, unknown>) {
  const file = logFilePath('app.log');
  rotateIfNeeded(file);
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
  fs.appendFileSync(file, line + '\n', 'utf8');
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    append('info', message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    append('warn', message, meta);
    if (process.env.NODE_ENV !== 'test') console.warn(message, meta ?? '');
  },
  error(message: string, meta?: Record<string, unknown>) {
    append('error', message, meta);
    if (process.env.NODE_ENV !== 'test') console.error(message, meta ?? '');
  },
};

/** User-facing error codes for common failures. */
export const ErrorCodes = {
  DB_LOCKED: 'DB_LOCKED',
  DISK_FULL: 'DISK_FULL',
  BACKUP_CORRUPT: 'BACKUP_CORRUPT',
  BACKUP_INVALID: 'BACKUP_INVALID',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  VOUCHER_POST_FAILED: 'VOUCHER_POST_FAILED',
  PRINTER_OFFLINE: 'PRINTER_OFFLINE',
} as const;

export function userMessageForError(code: string, fallback: string): string {
  switch (code) {
    case ErrorCodes.DB_LOCKED:
      return 'The database is busy. Please wait a moment and try again.';
    case ErrorCodes.DISK_FULL:
      return 'Not enough disk space. Free up space and try again.';
    case ErrorCodes.BACKUP_CORRUPT:
      return 'This backup file is damaged and cannot be restored.';
    case ErrorCodes.BACKUP_INVALID:
      return 'This is not a valid Usman Mall backup.';
    case ErrorCodes.INSUFFICIENT_STOCK:
      return 'Insufficient stock for this sale.';
    case ErrorCodes.VOUCHER_POST_FAILED:
      return 'Accounting entry could not be posted. No changes were saved.';
    case ErrorCodes.PRINTER_OFFLINE:
      return 'Printer is offline or unavailable. Your sale was saved successfully.';
    default:
      return fallback;
  }
}
