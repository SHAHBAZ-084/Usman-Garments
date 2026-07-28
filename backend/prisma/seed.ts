import bcrypt from 'bcryptjs';
import { FinancialYearStatus, PrismaClient } from '@prisma/client';
import {
  bootstrapChartOfAccounts,
  fiscalYearLabelForDate,
} from '../src/modules/accounting/accounting.service';
import { ensureDeveloperPassphraseHash } from '../src/modules/settings/identity-access.service';
import { ensureBusinessSettings } from '../src/modules/settings/settings.service';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.DEFAULT_ADMIN_USERNAME ?? 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';

  const existing = await prisma.user.findUnique({ where: { username } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: 'Shop Owner',
      },
    });
    console.log(`Created default user "${username}". Change the password after first login.`);
  } else {
    console.log(`Default user "${username}" already exists — skipping user seed.`);
  }

  const activeYear = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });

  if (!activeYear) {
    const now = new Date();
    const { label, startDate } = fiscalYearLabelForDate(now);
    await prisma.financialYear.create({
      data: {
        label,
        startDate,
        status: FinancialYearStatus.ACTIVE,
      },
    });
    console.log(`Created active financial year "${label}".`);
  }

  await bootstrapChartOfAccounts();
  console.log('Chart of accounts bootstrapped.');

  await ensureBusinessSettings();
  await ensureDeveloperPassphraseHash();
  console.log('Business settings ensured.');

  const { ensureDefaultProductCategories } = await import('../src/modules/products/products.service');
  await ensureDefaultProductCategories();
  console.log('Product categories ensured.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
