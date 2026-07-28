import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import {
  IDENTITY_EDIT_IDLE_MS,
  activateIdentityEditSession,
  changeIdentityPassphrase,
  endIdentityEditSession,
  identityEditExpiry,
  isIdentityEditActive,
  touchIdentityEditSession,
  verifyIdentityPassphrase,
} from './identity-access.service';
import { PROTECTED_BUSINESS_IDENTITY_FIELDS } from './protected-fields';
import {
  BUSINESS_SETTINGS_ID,
  ensureBusinessSettings,
  getBusinessSettings,
  updateBusinessSettings,
} from './settings.service';

describe('identity access (developer edit mode)', () => {
  beforeEach(async () => {
    await ensureBusinessSettings();
    await prisma.businessSettings.update({
      where: { id: BUSINESS_SETTINGS_ID },
      data: {
        developerPassphraseHash: await bcrypt.hash('CUIVHR', 10),
        developerCreditLine: 'AS Solutions | Ali & Shahbaz | 0322-0726006',
      },
    });
  });

  it('exports a single protected-field list', () => {
    expect(PROTECTED_BUSINESS_IDENTITY_FIELDS).toEqual([
      'businessName',
      'tagline',
      'ownerName',
      'phone',
      'whatsapp',
      'address',
      'logoPath',
      'developerCreditLine',
    ]);
  });

  it('rejects protected field updates without an active edit session', async () => {
    await expect(updateBusinessSettings({ businessName: 'Changed Name' })).rejects.toThrow(
      /cannot be changed/i,
    );
    await expect(updateBusinessSettings({ phone: '0300-0000000' })).rejects.toThrow(/cannot be changed/i);
    await expect(
      updateBusinessSettings({ developerCreditLine: 'Hacked Credit' }),
    ).rejects.toThrow(/cannot be changed/i);
  });

  it('allows protected field updates when identity edit session is active', async () => {
    const updated = await updateBusinessSettings(
      { businessName: 'Changed Name', phone: '0300-1111111', developerCreditLine: 'Custom Credit Line' },
      { identityEditActive: true },
    );
    expect(updated.businessName).toBe('Changed Name');
    expect(updated.phone).toBe('0300-1111111');
    expect(updated.developerCreditLine).toBe('Custom Credit Line');
  });

  it('defaults developerCreditLine and allows invoice fields without edit session', async () => {
    const settings = await getBusinessSettings();
    expect(settings.developerCreditLine).toBe('AS Solutions | Ali & Shahbaz | 0322-0726006');

    const updated = await updateBusinessSettings({
      invoicePrefix: 'XX-',
      currency: 'USD',
      invoiceFooter: 'Thanks',
    });
    expect(updated.invoicePrefix).toBe('XX-');
    expect(updated.currency).toBe('USD');
    expect(updated.invoiceFooter).toBe('Thanks');
  });

  it('allows non-protected updates without identity edit session', async () => {
    const updated = await updateBusinessSettings({ lowStockLimit: 9 });
    expect(updated.lowStockLimit).toBe(9);
  });

  it('verifies passphrase and never exposes hash in settings payload', async () => {
    await expect(verifyIdentityPassphrase('CUIVHR')).resolves.toBe(true);
    await expect(verifyIdentityPassphrase('wrong')).resolves.toBe(false);

    const settings = await getBusinessSettings();
    expect(settings).not.toHaveProperty('developerPassphraseHash');
    expect(JSON.stringify(settings)).not.toMatch(/\$2[aby]\$/);
  });

  it('rejects wrong passphrase cleanly and allows retry', async () => {
    await expect(verifyIdentityPassphrase('bad-1')).resolves.toBe(false);
    await expect(verifyIdentityPassphrase('bad-2')).resolves.toBe(false);
    await expect(verifyIdentityPassphrase('CUIVHR')).resolves.toBe(true);
  });

  it('requires the current passphrase to change it', async () => {
    await expect(changeIdentityPassphrase('wrong', 'NEW-PASS')).rejects.toThrow(/Incorrect passphrase/i);
    await changeIdentityPassphrase('CUIVHR', 'NEW-PASS');
    await expect(verifyIdentityPassphrase('CUIVHR')).resolves.toBe(false);
    await expect(verifyIdentityPassphrase('NEW-PASS')).resolves.toBe(true);
    await prisma.businessSettings.update({
      where: { id: BUSINESS_SETTINGS_ID },
      data: { developerPassphraseHash: await bcrypt.hash('CUIVHR', 10) },
    });
  });

  describe('session expiry logic', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('expires after idle timeout', () => {
      vi.useFakeTimers();
      const session: { identityEditExpiresAt?: number } = {};
      activateIdentityEditSession(session);
      expect(isIdentityEditActive(session)).toBe(true);

      vi.advanceTimersByTime(IDENTITY_EDIT_IDLE_MS + 1);
      expect(isIdentityEditActive(session)).toBe(false);
      expect(identityEditExpiry(session)).toBeNull();
    });

    it('ends immediately when session is cleared (page leave)', () => {
      const session: { identityEditExpiresAt?: number } = {};
      activateIdentityEditSession(session);
      endIdentityEditSession(session);
      expect(isIdentityEditActive(session)).toBe(false);
    });

    it('extends idle window on touch while active', () => {
      vi.useFakeTimers();
      const session: { identityEditExpiresAt?: number } = {};
      activateIdentityEditSession(session);
      vi.advanceTimersByTime(IDENTITY_EDIT_IDLE_MS - 1000);
      touchIdentityEditSession(session);
      vi.advanceTimersByTime(2000);
      expect(isIdentityEditActive(session)).toBe(true);
    });
  });
});
