/**
 * Manual-upgrade data safety drill (no GitHub / no Electron installer UI).
 *
 * Models shop USB update: Setup.exe replaces Program Files only; shop DB lives in
 * %AppData%\usman-garments and is only touched by runSafeMigrations on next launch.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'usman-manual-upgrade-'));
const userData = path.join(drillRoot, 'userData');
const dbPath = path.join(userData, 'usman-garments.db');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  fs.mkdirSync(userData, { recursive: true });
  process.env.USMAN_USER_DATA = userData;
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`;

  console.log('Drill AppData:', userData);

  execSync('npx prisma migrate deploy', { cwd: BACKEND, env: { ...process.env }, stdio: 'inherit' });
  execSync('npm run build -w backend', { cwd: ROOT, stdio: 'inherit' });

  const { configureSqlite, prisma, shutdownDatabase } = require(path.join(BACKEND, 'dist/lib/prisma'));
  const { ensureFirstRunDefaults } = require(path.join(BACKEND, 'dist/lib/first-run'));
  const { runSafeMigrations, sha256File: hashFn } = require(path.join(BACKEND, 'dist/lib/migration-safety'));
  const { restoreLiveDatabaseFromBackup, runPreMigrationBackup } = require(
    path.join(BACKEND, 'dist/modules/backup/backup.service'),
  );

  await configureSqlite();
  await ensureFirstRunDefaults();

  const runId = `MANUAL-${Date.now()}`;
  const customer = await prisma.customer.create({
    data: { name: `${runId} Customer`, phone: '03001111222' },
  });
  const product = await prisma.product.create({
    data: {
      name: `${runId} Product`,
      sku: `SKU-${runId}`,
      salePrice: 1000,
      purchasePrice: 500,
      currentStock: 10,
      notes: `${runId} note`,
    },
  });
  const supplier = await prisma.supplier.create({
    data: { name: `${runId} Supplier`, phone: '03003333444' },
  });

  console.log('Seeded markers', { customer: customer.id, product: product.id, supplier: supplier.id });

  // Force pending migration so runSafeMigrations takes the backup-then-migrate path
  await prisma.$executeRawUnsafe(
    `DELETE FROM "_prisma_migrations" WHERE migration_name = '20260802090000_release_marker'`,
  );

  const good = await runSafeMigrations();
  assert(good.backup != null, 'Expected pre-migration backup on good path');
  assert(fs.existsSync(path.join(good.backup.folderPath, 'usman-garments.db')), 'Backup DB missing');
  assert(fs.existsSync(path.join(good.backup.folderPath, 'manifest.json')), 'Backup manifest missing');

  const customerAfter = await prisma.customer.findUnique({ where: { id: customer.id } });
  const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
  const supplierAfter = await prisma.supplier.findUnique({ where: { id: supplier.id } });
  assert(customerAfter?.name === `${runId} Customer`, 'Customer lost after migrate');
  assert(productAfter?.name === `${runId} Product`, 'Product lost after migrate');
  assert(productAfter?.notes === `${runId} note`, 'Product note changed after migrate');
  assert(supplierAfter?.name === `${runId} Supplier`, 'Supplier lost after migrate');
  console.log('PASS good-path: backup + migrate; shop markers intact');

  // Bad migration path — same restore safety net used on app startup after manual install
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  const hashBeforeBad = hashFn(dbPath);
  const backup = await runPreMigrationBackup();
  assert(backup, 'Pre-migration backup required for bad-path test');

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "__broken_migration_probe" (id INTEGER PRIMARY KEY)`,
  );
  await prisma.$executeRawUnsafe(`INSERT INTO "__broken_migration_probe" (id) VALUES (1)`);

  await restoreLiveDatabaseFromBackup(backup.folderPath);
  await configureSqlite();

  const hashAfter = hashFn(dbPath);
  assert(hashAfter === hashBeforeBad, 'DB hash mismatch after restore');
  const probe = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='__broken_migration_probe'`,
  );
  assert(probe.length === 0, 'Broken migration table still present after restore');
  const customerRestored = await prisma.customer.findUnique({ where: { id: customer.id } });
  assert(customerRestored?.name === `${runId} Customer`, 'Customer lost after bad-migration restore');
  console.log('PASS bad-path: restore-from-backup protected shop data');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.build?.nsis?.deleteAppDataOnUninstall === false, 'NSIS must not wipe AppData');
  assert(!pkg.build?.publish, 'GitHub publish config must be removed');
  assert(!pkg.dependencies?.['electron-updater'], 'electron-updater must be removed');
  console.log('PASS installer config: AppData preserved; no GitHub publish/updater');

  await shutdownDatabase();
  console.log('ALL MANUAL-UPGRADE DATA SAFETY CHECKS PASSED');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
