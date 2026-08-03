/**
 * Compare AppData DB against update-drill-snapshot.json
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.USMAN_USER_DATA = path.join(process.env.APPDATA, 'usman-garments');
process.env.NODE_ENV = 'production';
const SNAPSHOT = path.join(process.env.USMAN_USER_DATA, 'update-drill-snapshot.json');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

(async () => {
  if (!fs.existsSync(SNAPSHOT)) throw new Error('Missing snapshot ' + SNAPSHOT);
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const { configureSqlite, prisma, shutdownDatabase } = require('../dist/lib/prisma');
  await configureSqlite();

  const counts = {
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    suppliers: await prisma.supplier.count(),
    products: await prisma.product.count(),
    purchases: await prisma.purchase.count(),
    invoices: await prisma.invoice.count(),
    vouchers: await prisma.voucher.count(),
    ledgerEntries: await prisma.ledgerEntry.count(),
    financialYears: await prisma.financialYear.count(),
    accounts: await prisma.account.count(),
  };

  const inv = await prisma.invoice.findUnique({ where: { id: snap.ids.saleId } });
  const pur = await prisma.purchase.findUnique({ where: { id: snap.ids.purchaseId } });
  const cust = await prisma.customer.findUnique({ where: { id: snap.ids.customerId } });
  const vouch = await prisma.voucher.findUnique({ where: { id: snap.ids.voucherId } });
  const admins = await prisma.user.findMany({ where: { username: 'admin' } });

  const releaseMarkerCols = await prisma.$queryRawUnsafe(
    `PRAGMA table_info('BusinessSettings')`,
  );
  const hasReleaseMarker = releaseMarkerCols.some((c) => c.name === 'releaseMarker');

  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  const dbPath = path.join(process.env.USMAN_USER_DATA, 'usman-garments.db');

  const report = {
    countsMatch: JSON.stringify(counts) === JSON.stringify(snap.counts),
    countsBefore: snap.counts,
    countsAfter: counts,
    idsPresent: {
      customer: Boolean(cust),
      purchase: Boolean(pur),
      invoice: Boolean(inv),
      voucher: Boolean(vouch),
    },
    amountsMatch: {
      sale: inv && String(inv.totalAmount) === snap.amounts.saleTotal,
      purchase: pur && String(pur.totalAmount) === snap.amounts.purchaseTotal,
    },
    singleAdmin: admins.length === 1,
    financialYearCount: counts.financialYears,
    hasReleaseMarkerColumn: hasReleaseMarker,
    dbSha256After: sha256File(dbPath),
    dbSha256Before: snap.dbSha256,
    note: 'DB hash will differ after a successful additive migration; row identity/amounts must still match.',
  };

  console.log(JSON.stringify(report, null, 2));
  const ok =
    report.countsMatch &&
    report.idsPresent.customer &&
    report.idsPresent.purchase &&
    report.idsPresent.invoice &&
    report.idsPresent.voucher &&
    report.amountsMatch.sale &&
    report.amountsMatch.purchase &&
    report.singleAdmin;

  await shutdownDatabase();
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
