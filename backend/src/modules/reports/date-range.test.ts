import { describe, expect, it } from 'vitest';
import { localDateKey, resolveDateRange, resolvePreviousDateRange } from './date-range';

describe('localDateKey', () => {
  it('formats local calendar components as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 7, 19, 0, 30, 0, 0))).toBe('2026-08-19');
    expect(localDateKey(new Date(2026, 7, 19, 23, 45, 0, 0))).toBe('2026-08-19');
    expect(localDateKey(new Date(2026, 0, 1, 0, 0, 0, 0))).toBe('2026-01-01');
    expect(localDateKey(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31');
  });

  it('pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0, 0, 0))).toBe('2026-01-05');
  });

  it('does not follow UTC toISOString() when local midnight is a different UTC date', () => {
    const earlyLocal = new Date(2026, 7, 19, 0, 30, 0, 0);
    const utcKey = earlyLocal.toISOString().slice(0, 10);
    expect(localDateKey(earlyLocal)).toBe('2026-08-19');
    if (utcKey !== '2026-08-19') {
      expect(localDateKey(earlyLocal)).not.toBe(utcKey);
    }
  });

  it('matches startOfDay/endOfDay calendar day for today preset', () => {
    const now = new Date(2026, 7, 19, 3, 15, 0, 0);
    const range = resolveDateRange('today', undefined, undefined, now);
    expect(localDateKey(range.from!)).toBe('2026-08-19');
    expect(localDateKey(range.to!)).toBe('2026-08-19');
  });
});

describe('resolvePreviousDateRange labels via localDateKey', () => {
  it('previous window dates stay on local calendar days', () => {
    const range = resolveDateRange('custom', '2026-08-10', '2026-08-19', new Date(2026, 7, 19, 12, 0, 0));
    const prev = resolvePreviousDateRange(range);
    expect(prev).not.toBeNull();
    expect(localDateKey(prev!.to!)).toBe('2026-08-09');
    expect(localDateKey(prev!.from!)).toBe('2026-07-31');
  });
});
