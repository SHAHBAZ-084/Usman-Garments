import { describe, expect, it } from 'vitest';
import {
  a4GridColumns,
  a4GridRows,
  expandLabelCopies,
  parseLabelSize,
} from './barcodeLabels';

describe('barcodeLabels helpers', () => {
  it('parses thermal presets and a4', () => {
    expect(parseLabelSize('58x40').mode).toBe('thermal');
    expect(parseLabelSize('58x40').widthMm).toBe(58);
    expect(parseLabelSize('58x40').heightMm).toBe(40);
    expect(parseLabelSize('40x30').mode).toBe('thermal');
    expect(parseLabelSize('40x30').widthMm).toBe(40);
    expect(parseLabelSize('a4').mode).toBe('a4');
    expect(parseLabelSize('60x40').isCustom).toBe(true);
    expect(parseLabelSize('60x40').widthMm).toBe(60);
  });

  it('expands print quantities', () => {
    const items = [
      { key: 'a', name: 'One' },
      { key: 'b', name: 'Two' },
    ];
    const expanded = expandLabelCopies(items, { a: 3, b: 1 });
    expect(expanded).toHaveLength(4);
    expect(expanded.filter((i) => i.key.startsWith('a')).length).toBe(3);
  });

  it('computes A4 grid that fits the page', () => {
    expect(a4GridColumns(50)).toBeGreaterThanOrEqual(3);
    expect(a4GridRows(30)).toBeGreaterThanOrEqual(8);
  });
});
