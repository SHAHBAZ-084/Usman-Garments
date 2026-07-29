/** Default Usman Mall brand colors (black + premium gold). */
export const DEFAULT_PRIMARY_COLOR = '#111111';
export const DEFAULT_SECONDARY_COLOR = '#C99618';

export function normalizeHexColor(raw: string): string | null {
  const value = raw.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return null;
  return value.toUpperCase();
}

/** Relative luminance (0–1) for WCAG-style contrast decisions. */
export function relativeLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_PRIMARY_COLOR;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Black or white text for readable contrast on a solid fill. */
export function contrastingTextColor(backgroundHex: string): '#111111' | '#FFFFFF' {
  return relativeLuminance(backgroundHex) > 0.45 ? '#111111' : '#FFFFFF';
}

export function applyBrandColors(primary: string, secondary: string) {
  const primaryColor = normalizeHexColor(primary) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(secondary) ?? DEFAULT_SECONDARY_COLOR;
  const onPrimary = contrastingTextColor(primaryColor);
  const onSecondary = contrastingTextColor(secondaryColor);
  const root = document.documentElement;

  root.style.setProperty('--brand-primary', primaryColor);
  root.style.setProperty('--brand-secondary', secondaryColor);
  root.style.setProperty('--on-brand-primary', onPrimary);
  root.style.setProperty('--on-brand-secondary', onSecondary);

  // Primary = main brand (sidebar / financial actions)
  root.style.setProperty('--nav-bg', primaryColor);
  root.style.setProperty('--fill-financial', primaryColor);
  root.style.setProperty('--on-financial', onPrimary);
  root.style.setProperty('--text-financial', primaryColor);
  root.style.setProperty('--nav-text', onPrimary === '#FFFFFF' ? '#F0F0F0' : '#333333');
  root.style.setProperty('--nav-text-hover', onPrimary);

  // Secondary = accent (active nav / highlights)
  root.style.setProperty('--fill-accent', secondaryColor);
  root.style.setProperty('--on-accent', onSecondary);
  root.style.setProperty('--nav-active-bg', secondaryColor);
  root.style.setProperty('--nav-active-text', onSecondary);
  root.style.setProperty('--text-accent', secondaryColor);
  root.style.setProperty('--soft-gold', secondaryColor);
  root.style.setProperty('--voucher-journal', secondaryColor);
}

export function clearBrandColorOverrides() {
  const props = [
    '--brand-primary',
    '--brand-secondary',
    '--on-brand-primary',
    '--on-brand-secondary',
    '--nav-bg',
    '--fill-financial',
    '--on-financial',
    '--text-financial',
    '--nav-text',
    '--nav-text-hover',
    '--fill-accent',
    '--on-accent',
    '--nav-active-bg',
    '--nav-active-text',
    '--text-accent',
    '--soft-gold',
    '--voucher-journal',
  ];
  for (const prop of props) {
    document.documentElement.style.removeProperty(prop);
  }
}
