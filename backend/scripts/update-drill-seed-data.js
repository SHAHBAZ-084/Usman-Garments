/**
 * Create baseline shop data in packaged AppData DB; write snapshot JSON + db hash.
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
  const { configureSqlite, prisma, shutdownDatabase } = require('../dist/lib/prisma');
  const { ensureFirstRunDefaults } = require('../dist/lib/first-run');
  const { createCustomer } = require('../dist/modules/customers/customers.service');
  const { createProduct } = require('../dist/modules/products/products.service');
  const { createSupplier } = require('../dist/modules/suppliers/suppliers.service');
  const { createPurchase } = require('../dist/modules/purchases/purchases.service');
  const { createSale } = require('../dist/modules/sales/sales.service');
  const { createVoucher } = require('../dist/modules/accounting/accounting.service');
  const { PurchasePaymentMethod, SalePaymentMethod, VoucherType } = require('@prisma/client');

  await configureSqlite();
  await ensureFirstRunDefaults();

  const user = await prisma.user.findFirst({ where: { username: 'admin' } });
  if (!user) throw new Error('admin user missing — first-run seed failed');

  const runId = `DRILL-${Date.now()}`;
  const customer = await createCustomer({
    name: `${runId} Customer`,
    phone: '0300-1111222',
  });
  const supplier = await createSupplier({
    name: `${runId} Supplier`,
    phone: '0300-3333444',
  });
  const product = await createProduct({
    name: `${runId} Shirt`,
    salePrice: 1500,
    purchasePrice: 900,
    openingStock: 20,
  });

  const purchase = await createPurchase({
    supplierId: supplier.id,
    date: new Date().toISOString(),
    paymentMethod: PurchasePaymentMethod.CASH,
    items: [{ productId: product.id, quantity: 5, purchasePrice: 900 }],
    paidAmount: 4500,
    createdById: user.id,
  });
  const purchaseId = typeof purchase === 'number' ? purchase : purchase.id;

  const sale = await createSale({
    customerId: customer.id,
    date: new Date().toISOString(),
    paymentMethod: SalePaymentMethod.CASH,
    amountReceived: 1500,
    items: [{ productId: product.id, quantity: 1, rate: 1500 }],
    createdById: user.id,
  });
  const saleId = sale.id;

  const cash = await prisma.account.findFirst({
    where: { name: { contains: 'Cash' }, isActive: true },
  });
  const expense = await prisma.account.findFirst({
    where: { type: 'EXPENSE', isActive: true },
  });
  if (!cash || !expense) throw new Error('Missing cash/expense accounts for voucher');

  const voucher = await createVoucher({
    type: VoucherType.PAYMENT,
    debitAccountId: expense.id,
    creditAccountId: cash.id,
    amount: 100,
    date: new Date(),
    description: `${runId} payment voucher`,
    reference: `${runId}-PAY`,
    createdById: user.id,
  });

  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  const dbPath = path.join(process.env.USMAN_USER_DATA, 'usman-garments.db');

  const inv = await prisma.invoice.findUnique({ where: { id: saleId } });
  const pur = await prisma.purchase.findUnique({ where: { id: purchaseId } });

  const snapshot = {
    runId,
    createdAt: new Date().toISOString(),
    dbPath,
    dbSha256: sha256File(dbPath),
    counts: {
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
    },
    ids: {
      customerId: customer.id,
      supplierId: supplier.id,
      productId: product.id,
      purchaseId,
      saleId,
      voucherId: voucher.id,
      adminUserId: user.id,
      invoiceNumber: inv?.invoiceNumber ?? null,
    },
    amounts: {
      saleTotal: inv ? String(inv.totalAmount) : null,
      purchaseTotal: pur ? String(pur.totalAmount) : null,
      voucherAmount: String(voucher.amount ?? 100),
    },
  };

  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify(snapshot, null, 2));
  await shutdownDatabase();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
