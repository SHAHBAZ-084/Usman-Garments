/**
 * One-shot repair: add BusinessSettings.releaseMarker if missing,
 * and record the migration as applied when its SQL already matches.
 */
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const candidates = [
  path.join(process.env.APPDATA || '', 'usman-garments', 'usman-garments.db'),
  path.join(process.env.APPDATA || '', 'Usman-Garments', 'usman-garments.db'),
];

async function repair(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log('skip missing', dbPath);
    return;
  }
  process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`;
  const prisma = new PrismaClient();
  try {
    const cols = await prisma.$queryRawUnsafe('PRAGMA table_info("BusinessSettings")');
    const names = cols.map((c) => c.name);
    console.log(dbPath);
    console.log('  columns:', names.join(', '));
    if (!names.includes('releaseMarker')) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "BusinessSettings" ADD COLUMN "releaseMarker" TEXT',
      );
      console.log('  added releaseMarker');
    } else {
      console.log('  releaseMarker already present');
    }

    const migrationName = '20260802090000_release_marker';
    const applied = await prisma.$queryRawUnsafe(
      'SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?',
      migrationName,
    );
    if (!applied.length) {
      const sqlPath = path.join(
        __dirname,
        '..',
        'backend',
        'prisma',
        'migrations',
        migrationName,
        'migration.sql',
      );
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)`,
        crypto.randomUUID(),
        checksum,
        migrationName,
      );
      console.log('  recorded migration', migrationName);
    } else {
      console.log('  migration already recorded');
    }
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  const seen = new Set();
  for (const db of candidates) {
    const key = fs.existsSync(db) ? fs.realpathSync(db) : db;
    if (seen.has(key)) continue;
    seen.add(key);
    await repair(db);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
