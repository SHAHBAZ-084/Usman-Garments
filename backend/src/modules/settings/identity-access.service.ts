import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { protectedIdentityFieldsInUpdate, type ProtectedBusinessIdentityField } from './protected-fields';
import type { BusinessSettingsUpdateInput } from './settings.service';
import { BUSINESS_SETTINGS_ID } from './settings.service';

export const IDENTITY_EDIT_IDLE_MS = 10 * 60 * 1000;

type SessionWithIdentityEdit = {
  identityEditExpiresAt?: number;
};

export function identityEditExpiry(session: SessionWithIdentityEdit): number | null {
  const expiresAt = session.identityEditExpiresAt;
  if (!expiresAt || Date.now() >= expiresAt) return null;
  return expiresAt;
}

export function isIdentityEditActive(session: SessionWithIdentityEdit): boolean {
  return identityEditExpiry(session) !== null;
}

export function activateIdentityEditSession(session: SessionWithIdentityEdit): void {
  session.identityEditExpiresAt = Date.now() + IDENTITY_EDIT_IDLE_MS;
}

export function touchIdentityEditSession(session: SessionWithIdentityEdit): void {
  if (isIdentityEditActive(session)) {
    session.identityEditExpiresAt = Date.now() + IDENTITY_EDIT_IDLE_MS;
  }
}

export function endIdentityEditSession(session: SessionWithIdentityEdit): void {
  delete session.identityEditExpiresAt;
}

export async function ensureDeveloperPassphraseHash(): Promise<void> {
  const row = await prisma.businessSettings.findUnique({ where: { id: BUSINESS_SETTINGS_ID } });
  if (row?.developerPassphraseHash) return;

  const initial = process.env.DEFAULT_IDENTITY_PASSPHRASE ?? 'CUIVHR';
  await prisma.businessSettings.update({
    where: { id: BUSINESS_SETTINGS_ID },
    data: { developerPassphraseHash: await bcrypt.hash(initial, 10) },
  });
}

export async function verifyIdentityPassphrase(passphrase: string): Promise<boolean> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { developerPassphraseHash: true },
  });
  if (!row?.developerPassphraseHash) return false;
  return bcrypt.compare(passphrase, row.developerPassphraseHash);
}

export async function changeIdentityPassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
  const valid = await verifyIdentityPassphrase(currentPassphrase);
  if (!valid) {
    throw new AppError(401, 'Incorrect passphrase');
  }
  const trimmed = newPassphrase.trim();
  if (trimmed.length < 4) {
    throw new AppError(400, 'Passphrase must be at least 4 characters');
  }
  await prisma.businessSettings.update({
    where: { id: BUSINESS_SETTINGS_ID },
    data: { developerPassphraseHash: await bcrypt.hash(trimmed, 10) },
  });
}

export function assertIdentityFieldsEditable(
  input: BusinessSettingsUpdateInput,
  identityEditActive: boolean,
): void {
  if (identityEditActive) return;
  const blocked = protectedIdentityFieldsInUpdate(input);
  if (blocked.length > 0) {
    throw new AppError(403, 'This setting cannot be changed');
  }
}

export function listBlockedIdentityFields(input: BusinessSettingsUpdateInput): ProtectedBusinessIdentityField[] {
  return protectedIdentityFieldsInUpdate(input);
}
