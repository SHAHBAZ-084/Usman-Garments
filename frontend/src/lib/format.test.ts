import { describe, expect, it } from 'vitest';
import { formatLedgerBalance, formatMoney } from './format';

describe('formatMoney', () => {
  it('writes whole rupees without .00', () => {
    expect(formatMoney(200)).not.toMatch(/\.00/);
    expect(formatMoney(200)).toMatch(/200/);
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney('1900.00')).not.toMatch(/\.00/);
  });

  it('keeps paisa when the amount is not whole', () => {
    expect(formatMoney(200.5)).toMatch(/200\.5/);
    expect(formatMoney(200.55)).toMatch(/200\.55/);
  });
});

describe('formatLedgerBalance', () => {
  it('omits .00 and never shows negative Dr', () => {
    expect(formatLedgerBalance(0)).toBe('0');
    expect(formatLedgerBalance(-30000)).toMatch(/Cr$/);
    expect(formatLedgerBalance(-30000)).not.toMatch(/\.00/);
    expect(formatLedgerBalance(150)).toMatch(/Dr$/);
    expect(formatLedgerBalance(150)).not.toMatch(/\.00/);
  });
});
