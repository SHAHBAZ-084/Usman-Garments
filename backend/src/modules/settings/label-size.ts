/** Allowed barcode label size keys stored on BusinessSettings.barcodeLabelSize. */

export const BARCODE_LABEL_SIZE_PRESETS = ['58x40', '33x23', '40x30', '50x25', '50x30', 'a4'] as const;

const CUSTOM_RE = /^(\d{2,3})x(\d{2,3})$/i;
/** Dynamic presets: e.g. 33x23-1723700000000 */
const DB_PRESET_KEY_RE = /^(\d{2,3})x(\d{2,3})-\d+$/i;

export function isValidBarcodeLabelSize(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if ((BARCODE_LABEL_SIZE_PRESETS as readonly string[]).includes(trimmed)) return true;
  if (CUSTOM_RE.test(trimmed)) return true;
  return DB_PRESET_KEY_RE.test(trimmed);
}

export function normalizeBarcodeLabelSize(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'a4') return 'a4';
  if (DB_PRESET_KEY_RE.test(trimmed)) return trimmed;
  const match = CUSTOM_RE.exec(trimmed);
  if (match) return `${Number(match[1])}x${Number(match[2])}`;
  return trimmed;
}
