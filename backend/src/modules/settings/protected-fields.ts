import type { BusinessSettingsUpdateInput } from './settings.service';

/** Fields editable only while an identity-edit session is active (Business Info). */
export const PROTECTED_BUSINESS_IDENTITY_FIELDS = [
  'businessName',
  'tagline',
  'ownerName',
  'phoneLabel',
  'phone',
  'whatsappLabel',
  'whatsapp',
  'address',
  'logoPath',
  'developerCreditLine',
  'primaryColor',
  'secondaryColor',
] as const satisfies readonly (keyof BusinessSettingsUpdateInput)[];

export type ProtectedBusinessIdentityField = (typeof PROTECTED_BUSINESS_IDENTITY_FIELDS)[number];

export function protectedIdentityFieldsInUpdate(input: BusinessSettingsUpdateInput): ProtectedBusinessIdentityField[] {
  return PROTECTED_BUSINESS_IDENTITY_FIELDS.filter((field) => input[field] !== undefined);
}
