import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { withWindowsSafeShellEnv } from '../lib/shell-env';

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(BACKEND_ROOT, '.vitest-test-env.json');

export default async function globalSetup() {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usman-garments-test-'));
  const dbPath = path.join(dbDir, 'test.db');
  const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`;

  fs.writeFileSync(ENV_FILE, JSON.stringify({ databaseUrl, dbDir }), 'utf8');

  const env = withWindowsSafeShellEnv(process.env, {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
  });

  execSync('npx prisma migrate deploy', {
    cwd: BACKEND_ROOT,
    env,
    stdio: 'pipe',
  });

  execSync('npx tsx prisma/seed.ts', {
    cwd: BACKEND_ROOT,
    env,
    stdio: 'pipe',
  });

  // Keep parity with app startup: add columns that may not have a migration yet.
  const { ensureRequiredSchemaColumns } = await import('../lib/ensure-schema');
  process.env.DATABASE_URL = databaseUrl;
  await ensureRequiredSchemaColumns();

  return async () => {
    try {
      if (fs.existsSync(ENV_FILE)) fs.unlinkSync(ENV_FILE);
      if (fs.existsSync(dbDir)) fs.rmSync(dbDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  };
}
