import type { BusinessSettingsUpdateInput } from './settings.service';

/** Shop identity fields locked unless an active server-side edit session is present. */
export const PROTECTED_BUSINESS_IDENTITY_FIELDS = [
  'businessName',
  'phone',
  'address',
  'invoicePrefix',
  'currency',
] as const satisfies readonly (keyof BusinessSettingsUpdateInput)[];

export type ProtectedBusinessIdentityField = (typeof PROTECTED_BUSINESS_IDENTITY_FIELDS)[number];

export function protectedIdentityFieldsInUpdate(input: BusinessSettingsUpdateInput): ProtectedBusinessIdentityField[] {
  return PROTECTED_BUSINESS_IDENTITY_FIELDS.filter((field) => input[field] !== undefined);
}
