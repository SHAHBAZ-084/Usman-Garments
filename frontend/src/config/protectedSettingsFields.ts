/** Must match backend `PROTECTED_BUSINESS_IDENTITY_FIELDS` in protected-fields.ts */
export const PROTECTED_SETTINGS_FIELD_KEYS = [
  'businessName',
  'phone',
  'address',
  'invoicePrefix',
  'currency',
] as const;

export type ProtectedSettingsFieldKey = (typeof PROTECTED_SETTINGS_FIELD_KEYS)[number];

export function isProtectedSettingsField(key: string): key is ProtectedSettingsFieldKey {
  return (PROTECTED_SETTINGS_FIELD_KEYS as readonly string[]).includes(key);
}
