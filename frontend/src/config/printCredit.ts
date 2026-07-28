/** Default print footer credit — ASCII separators so thermal printers don't show "?" for em-dashes. */
export const DEFAULT_DEVELOPER_CREDIT_LINE = 'AS Solutions | Ali & Shahbaz | 0322-0726006';

const LEGACY_CREDIT_LINES = new Set([
  'AS Solutions — Ali & Shahbaz — 0322-0726006',
  'AS Solutions – Ali & Shahbaz – 0322-0726006',
  'AS Solutions - Ali & Shahbaz - 0322-0726006',
]);

/** Normalize credit text for thermal / ESC-POS fonts that lack em-dash glyphs. */
export function formatDeveloperCreditForPrint(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return DEFAULT_DEVELOPER_CREDIT_LINE;
  if (LEGACY_CREDIT_LINES.has(text)) return DEFAULT_DEVELOPER_CREDIT_LINE;
  return text
    .replace(/[\u2014\u2013\u2212]/g, ' | ') // em/en/minus dashes
    .replace(/\s*[·•]\s*/g, ' | ')
    .replace(/\s*\?\s*/g, ' | ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
