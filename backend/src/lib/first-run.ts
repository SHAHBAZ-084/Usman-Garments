import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { FinancialYearStatus } from '@prisma/client';
import { getUploadsDir } from '../config/paths';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import {
  bootstrapChartOfAccounts,
  fiscalYearLabelForDate,
} from '../modules/accounting/accounting.service';
import { ensureDeveloperPassphraseHash } from '../modules/settings/identity-access.service';
import { BUSINESS_SETTINGS_ID, ensureBusinessSettings } from '../modules/settings/settings.service';

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

    const settings = await prisma.businessSettings.findUnique({ where: { id: BUSINESS_SETTINGS_ID } });
    if (settings) {
      const uploadsDir = getUploadsDir();
      const currentLogoPath = settings.logoPath ? path.join(uploadsDir, path.basename(settings.logoPath)) : null;
      const logoExists = currentLogoPath ? fs.existsSync(currentLogoPath) : false;

      if (!logoExists) {
        const candidates = [
          path.resolve(__dirname, '../../frontend/dist/logo.png'),
          path.resolve(__dirname, '../../frontend/public/logo.png'),
          path.resolve(__dirname, '../../../frontend/public/logo.png'),
          path.resolve(__dirname, '../../../frontend/dist/logo.png'),
          path.resolve(process.cwd(), 'frontend/dist/logo.png'),
          path.resolve(process.cwd(), 'frontend/public/logo.png'),
          path.resolve(process.cwd(), 'resources/app/frontend/dist/logo.png'),
          path.resolve(process.cwd(), 'resources/app.asar/frontend/dist/logo.png'),
        ];
        const source = candidates.find((c) => fs.existsSync(c));
        if (source) {
          const filename = 'logo-default.png';
          const dest = path.join(uploadsDir, filename);
          fs.copyFileSync(source, dest);
          await prisma.businessSettings.update({
            where: { id: BUSINESS_SETTINGS_ID },
            data: { logoPath: path.join('uploads', filename) },
          });
          logger.info('Ensured default shop logo file in user data uploads.', { source, dest });
        } else {
          logger.warn('Default shop logo source not found in candidates.', { candidates });
        }
      }
    }
  } catch (err) {
    logger.warn('Business settings / default logo ensure skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
