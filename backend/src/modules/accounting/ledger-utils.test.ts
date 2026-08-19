import { describe, expect, it } from 'vitest';
import {
  computeLedgerBalance,
  compareLedgerEntries,
  defaultOpeningSide,
  isTrialBalanceBalanced,
  parseVoucherDateInput,
  trialBalanceFromSignedBalance,
} from './ledger-utils';

describe('computeLedgerBalance', () => {
  it('applies previousBalance + debit - credit', () => {
    expect(computeLedgerBalance(10000, 5000, 0)).toBe(15000);
    expect(computeLedgerBalance(10000, 0, 5000)).toBe(5000);
    expect(computeLedgerBalance(0, 20000, 50000)).toBe(-30000);
  });
});

describe('trialBalanceFromSignedBalance', () => {
  it('maps positive to debit and negative to credit', () => {
    expect(trialBalanceFromSignedBalance(10000)).toEqual({ debit: 10000, credit: 0 });
    expect(trialBalanceFromSignedBalance(-50000)).toEqual({ debit: 0, credit: 50000 });
    expect(trialBalanceFromSignedBalance(0)).toEqual({ debit: 0, credit: 0 });
  });
});

describe('isTrialBalanceBalanced', () => {
  it('returns true when totals match', () => {
    expect(isTrialBalanceBalanced(80000, 80000)).toBe(true);
  });

  it('returns false when totals diverge', () => {
    expect(isTrialBalanceBalanced(80000, 79999)).toBe(false);
  });
});

describe('compareLedgerEntries', () => {
  it('sorts by voucher date then voucher number', () => {
    const early = {
      id: 2,
      createdAt: new Date('2026-07-20'),
      isOpeningBalance: false,
      voucher: { date: new Date('2026-07-01'), number: 2 },
    };
    const late = {
      id: 1,
      createdAt: new Date('2026-07-01'),
      isOpeningBalance: false,
      voucher: { date: new Date('2026-07-15'), number: 1 },
    };
    expect(compareLedgerEntries(early, late)).toBeLessThan(0);
  });
});

describe('defaultOpeningSide', () => {
  it('defaults assets and expenses to Dr', () => {
    expect(defaultOpeningSide('ASSET')).toBe('DR');
    expect(defaultOpeningSide('EXPENSE')).toBe('DR');
    expect(defaultOpeningSide('LIABILITY')).toBe('CR');
  });
});

describe('parseVoucherDateInput', () => {
  it('parses ISO date strings', () => {
    const d = parseVoucherDateInput('2026-01-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('throws on invalid dates', () => {
    expect(() => parseVoucherDateInput('not-a-date')).toThrow('Invalid voucher date');
  });
});

describe('display convention (frontend mirrors this)', () => {
  function formatSignedBalance(balance: number) {
    const n = Math.round((balance || 0) * 100) / 100;
    if (n === 0) return '0';
    const abs = Math.abs(n).toLocaleString('en-PK', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return n > 0 ? `${abs} Dr` : `${abs} Cr`;
  }

  it('never shows negative Dr and omits .00', () => {
    expect(formatSignedBalance(-30000)).toMatch(/Cr$/);
    expect(formatSignedBalance(-30000)).not.toMatch(/\.00/);
  });

  it('shows zero without suffix or .00', () => {
    expect(formatSignedBalance(0)).toBe('0');
  });
});
