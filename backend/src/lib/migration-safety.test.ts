import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { getDatabasePath } from '../config/paths';
import { configureSqlite, prisma } from './prisma';

vi.mock('./migrate-local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./migrate-local')>();
  return {
    ...actual,
    migrateDeployLocal: vi.fn(),
  };
});

describe('Pre-migration backup safety (runSafeMigrations)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await configureSqlite();
  });

  it('creates a pre-migration backup, does not resolve ready on migrate failure, and restores live DB hash', async () => {
    const dbPath = getDatabasePath();
    expect(fs.existsSync(dbPath)).toBe(true);

    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    const { sha256File, runSafeMigrations, MigrationApplyError } = await import('./migration-safety');
    const migrateLocal = await import('./migrate-local');

    const beforeHash = sha256File(dbPath);

    vi.mocked(migrateLocal.migrateDeployLocal).mockImplementation(async () => {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "__broken_migration_probe" (id INTEGER PRIMARY KEY)`,
      );
      await prisma.$executeRawUnsafe(`INSERT INTO "__broken_migration_probe" (id) VALUES (1)`);
      throw new Error('simulated bad migration');
    });

    let thrown: unknown;
    try {
      await runSafeMigrations();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MigrationApplyError);
    const applyErr = thrown as InstanceType<typeof MigrationApplyError>;
    expect(applyErr.message).toMatch(/simulated bad migration/);
    expect(applyErr.backupFolderPath).toBeTruthy();
    expect(fs.existsSync(path.join(applyErr.backupFolderPath!, 'usman-garments.db'))).toBe(true);
    expect(fs.existsSync(path.join(applyErr.backupFolderPath!, 'manifest.json'))).toBe(true);

    const afterHash = sha256File(dbPath);
    expect(afterHash).toBe(beforeHash);

    const probe = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='__broken_migration_probe'`,
    );
    expect(probe.length).toBe(0);
  });
});
