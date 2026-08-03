/** Allowed barcode label size keys stored on BusinessSettings.barcodeLabelSize. */

export const BARCODE_LABEL_SIZE_PRESETS = ['58x40', '40x30', '50x25', '50x30', 'a4'] as const;

const CUSTOM_RE = /^(\d{2,3})x(\d{2,3})$/i;

export function isValidBarcodeLabelSize(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if ((BARCODE_LABEL_SIZE_PRESETS as readonly string[]).includes(trimmed)) return true;
  return CUSTOM_RE.test(trimmed);
}

export function normalizeBarcodeLabelSize(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'a4') return 'a4';
  const match = CUSTOM_RE.exec(trimmed);
  if (match) return `${Number(match[1])}x${Number(match[2])}`;
  return trimmed;
}
