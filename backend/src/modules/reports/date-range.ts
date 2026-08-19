import { AppError } from '../../utils/helpers';

export type DateRangePreset = 'today' | 'week' | 'month' | 'year' | 'custom' | 'lifetime';

export type ResolvedDateRange = {
  preset: DateRangePreset;
  from: Date | null;
  to: Date | null;
  label: string;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Local calendar-day key (YYYY-MM-DD), NEVER use toISOString() for this —
 *  toISOString() converts to UTC and silently shifts dates across timezone
 *  boundaries. This must match startOfDay/endOfDay's local logic exactly. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return startOfDay(monday);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

export function resolveDateRange(
  preset: DateRangePreset,
  fromDate?: string,
  toDate?: string,
  now: Date = new Date(),
): ResolvedDateRange {
  const today = startOfDay(now);

  switch (preset) {
    case 'today':
      return { preset, from: today, to: endOfDay(now), label: 'Today' };
    case 'week':
      return { preset, from: startOfWeek(now), to: endOfDay(now), label: 'This Week' };
    case 'month':
      return { preset, from: startOfMonth(now), to: endOfDay(now), label: 'This Month' };
    case 'year':
      return { preset, from: startOfYear(now), to: endOfDay(now), label: 'This Year' };
    case 'lifetime':
      return { preset, from: null, to: null, label: 'Lifetime' };
    case 'custom': {
      if (!fromDate?.trim() || !toDate?.trim()) {
        throw new AppError(400, 'Custom range requires fromDate and toDate');
      }
      const from = startOfDay(new Date(fromDate));
      const to = endOfDay(new Date(toDate));
      if (from > to) throw new AppError(400, 'fromDate must be on or before toDate');
      return { preset, from, to, label: `${fromDate} – ${toDate}` };
    }
    default:
      throw new AppError(400, 'Invalid date range preset');
  }
}

/** Same-length period immediately before the given range (null for lifetime / open-ended). */
export function resolvePreviousDateRange(range: ResolvedDateRange): ResolvedDateRange | null {
  if (range.preset === 'lifetime' || !range.from || !range.to) return null;

  const durationMs = range.to.getTime() - range.from.getTime();
  const prevTo = endOfDay(new Date(range.from.getTime() - 1));
  const prevFrom = startOfDay(new Date(prevTo.getTime() - durationMs));

  return {
    preset: range.preset,
    from: prevFrom,
    to: prevTo,
    label: 'Previous period',
  };
}

export function dateFilter(from: Date | null, to: Date | null) {
  if (!from && !to) return undefined;
  if (from && to) return { gte: from, lte: to };
  if (from) return { gte: from };
  return { lte: to! };
}

export function paginateParams(page?: number, pageSize?: number) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(100, Math.max(1, pageSize ?? 20));
  return {
    page: p,
    pageSize: ps,
    skip: (p - 1) * ps,
    take: ps,
  };
}
