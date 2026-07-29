import bcrypt from 'bcryptjs';
import { FinancialYearStatus } from '@prisma/client';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import {
  bootstrapChartOfAccounts,
  fiscalYearLabelForDate,
} from '../modules/accounting/accounting.service';
import { ensureDeveloperPassphraseHash } from '../modules/settings/identity-access.service';
import { ensureBusinessSettings } from '../modules/settings/settings.service';

/**
 * Packaged installs run migrations but never `prisma/seed.ts`, so the User
 * table stays empty and login always fails with "Invalid username or password".
 * Idempotent first-run bootstrap for admin + essentials.
 */
export async function ensureFirstRunDefaults(): Promise<void> {
  const username = process.env.DEFAULT_ADMIN_USERNAME ?? 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: 'Shop Owner',
      },
    });
    try {
      await prisma.$executeRaw`
        UPDATE User SET role = ${'Owner'} WHERE username = ${username}
      `;
    } catch {
      /* role column may be missing on very old DBs; ensure-schema covers that */
    }
    logger.info('Created default admin user (first run)', { username });
  }

  const activeYear = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!activeYear) {
    const { label, startDate } = fiscalYearLabelForDate(new Date());
    await prisma.financialYear.create({
      data: { label, startDate, status: FinancialYearStatus.ACTIVE },
    });
    logger.info('Created active financial year', { label });
  }

  try {
    await bootstrapChartOfAccounts();
  } catch (err) {
    logger.warn('Chart of accounts bootstrap skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await ensureBusinessSettings();
    await ensureDeveloperPassphraseHash();
  } catch (err) {
    logger.warn('Business settings ensure skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
