const path = require('path');
const fs = require('fs');

process.env.USMAN_USER_DATA = path.join(process.env.TEMP, 'usman-local-migrate-userdata');
process.env.NODE_ENV = 'production';
fs.mkdirSync(process.env.USMAN_USER_DATA, { recursive: true });

for (const s of ['', '-wal', '-shm']) {
  const p = path.join(process.env.USMAN_USER_DATA, `usman-garments.db${s}`);
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

(async () => {
  const { runStartupTasks } = require('../dist/startup');
  await runStartupTasks();
  const { prisma } = require('../dist/lib/prisma');
  const tables = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  console.log(
    'TABLES',
    tables.map((t) => t.name).join(', '),
  );
  const settings = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM BusinessSettings`);
  console.log('BusinessSettings', settings);
  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
