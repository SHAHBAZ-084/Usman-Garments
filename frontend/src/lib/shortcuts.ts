/** Append keyboard shortcut hint to button labels — e.g. "Complete Sale (F9)". */
export function shortcutLabel(label: string, key: string): string {
  return `${label} (${key})`;
}
