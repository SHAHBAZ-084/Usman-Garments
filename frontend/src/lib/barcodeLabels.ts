/** Shared barcode label size presets and print helpers (frontend-only layout). */

export type LabelSizePreset = {
  key: string;
  label: string;
  mode: 'thermal' | 'a4';
  widthMm: number;
  heightMm: number;
};

/** Common thermal roll sizes + A4 sheet mode. */
export const BARCODE_LABEL_PRESETS: LabelSizePreset[] = [
  { key: '40x30', label: '40 × 30 mm (thermal)', mode: 'thermal', widthMm: 40, heightMm: 30 },
  { key: '50x25', label: '50 × 25 mm (thermal)', mode: 'thermal', widthMm: 50, heightMm: 25 },
  { key: '50x30', label: '50 × 30 mm (thermal)', mode: 'thermal', widthMm: 50, heightMm: 30 },
  { key: 'a4', label: 'A4 sheet (grid)', mode: 'a4', widthMm: 50, heightMm: 30 },
];

export const DEFAULT_BARCODE_LABEL_SIZE = '50x30';

export type ParsedLabelSize = {
  key: string;
  mode: 'thermal' | 'a4';
  widthMm: number;
  heightMm: number;
  label: string;
  isCustom: boolean;
};

const CUSTOM_RE = /^(\d{2,3})x(\d{2,3})$/i;

export function parseLabelSize(raw: string | null | undefined): ParsedLabelSize {
  const key = (raw ?? DEFAULT_BARCODE_LABEL_SIZE).trim() || DEFAULT_BARCODE_LABEL_SIZE;
  const preset = BARCODE_LABEL_PRESETS.find((p) => p.key === key);
  if (preset) {
    return {
      key: preset.key,
      mode: preset.mode,
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      label: preset.label,
      isCustom: false,
    };
  }
  const match = CUSTOM_RE.exec(key);
  if (match) {
    const widthMm = Number(match[1]);
    const heightMm = Number(match[2]);
    return {
      key: `${widthMm}x${heightMm}`,
      mode: 'thermal',
      widthMm,
      heightMm,
      label: `${widthMm} × ${heightMm} mm (custom)`,
      isCustom: true,
    };
  }
  return parseLabelSize(DEFAULT_BARCODE_LABEL_SIZE);
}

export function isKnownLabelSizeKey(raw: string): boolean {
  const key = raw.trim();
  if (BARCODE_LABEL_PRESETS.some((p) => p.key === key)) return true;
  return CUSTOM_RE.test(key);
}

export function expandLabelCopies<T extends { key: string }>(
  items: T[],
  quantities: Record<string, number>,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const qty = Math.max(1, Math.min(99, Math.floor(quantities[item.key] ?? 1)));
    for (let i = 0; i < qty; i++) {
      out.push(i === 0 ? item : { ...item, key: `${item.key}-copy-${i}` });
    }
  }
  return out;
}

/** A4 grid: how many label columns fit on a page with ~8mm margins and 2mm gaps. */
export function a4GridColumns(labelWidthMm: number): number {
  const usable = 210 - 16;
  const gap = 2;
  return Math.max(1, Math.floor((usable + gap) / (labelWidthMm + gap)));
}

export function a4GridRows(labelHeightMm: number): number {
  const usable = 297 - 16;
  const gap = 2;
  return Math.max(1, Math.floor((usable + gap) / (labelHeightMm + gap)));
}
