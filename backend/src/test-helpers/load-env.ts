import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(BACKEND_ROOT, '.vitest-test-env.json');

if (!fs.existsSync(ENV_FILE)) {
  throw new Error(
    'Test database not initialized. Vitest globalSetup must run before tests. ' +
      'Run tests via: npm run test -w backend',
  );
}

const { databaseUrl } = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')) as { databaseUrl: string };
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';

/** Fresh schema+seed before every test file so trials never accumulate cross-file state. */
async function resetTestDatabase() {
  const dbPath = databaseUrl.startsWith('file:') ? databaseUrl.slice(5) : databaseUrl;
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore locked file */
      }
    }
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execSync('npx prisma migrate deploy', { cwd: BACKEND_ROOT, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd: BACKEND_ROOT, env, stdio: 'pipe' });

  const { disconnectPrisma } = await import('../lib/prisma');
  try {
    await disconnectPrisma();
  } catch {
    /* ignore */
  }
}

await resetTestDatabase();

export {};
