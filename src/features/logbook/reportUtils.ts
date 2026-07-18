/**
 * Report maths for the Logbook. A "report" is just the logbook entries
 * (app orders + manual records) narrowed to a chosen window — a day, a month,
 * or a year — then sorted and totalled. Everything here is pure so the screen
 * can filter/sort in memory over one `listForBusiness` fetch.
 */
import type { LogEntry } from '@/domain/types';

/** Which window the report covers. */
export type PeriodMode = 'day' | 'month' | 'year';
/** How the rows are ordered. */
export type SortKey = 'time' | 'price';
export type SortDir = 'asc' | 'desc';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export { MONTHS_SHORT, MONTHS_FULL };

/** Midnight (local) of the given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The half-open range [start, end) a period covers, anchored on any date
 * inside it. Day → that calendar day; month → the whole month; year → the
 * whole year.
 */
export function periodRange(mode: PeriodMode, anchor: Date): { start: Date; end: Date } {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();
  if (mode === 'day') return { start: new Date(y, m, d), end: new Date(y, m, d + 1) };
  if (mode === 'month') return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
}

/** Is the entry's timestamp inside the anchored period? */
export function isInPeriod(iso: string, mode: PeriodMode, anchor: Date): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const { start, end } = periodRange(mode, anchor);
  return t >= start.getTime() && t < end.getTime();
}

/** Human label for the selected period, e.g. "18 Jul 2026" / "July 2026" / "2026". */
export function periodLabel(mode: PeriodMode, anchor: Date): string {
  if (mode === 'day') return `${anchor.getDate()} ${MONTHS_SHORT[anchor.getMonth()]} ${anchor.getFullYear()}`;
  if (mode === 'month') return `${MONTHS_FULL[anchor.getMonth()]} ${anchor.getFullYear()}`;
  return `${anchor.getFullYear()}`;
}

/** "Today" / "This month" / "This year" when the anchor is the current period. */
export function relativeLabel(mode: PeriodMode, anchor: Date, now: Date = new Date()): string | null {
  if (mode === 'day') {
    return startOfDay(anchor).getTime() === startOfDay(now).getTime() ? 'Today' : null;
  }
  if (mode === 'month') {
    return anchor.getFullYear() === now.getFullYear() && anchor.getMonth() === now.getMonth()
      ? 'This month'
      : null;
  }
  return anchor.getFullYear() === now.getFullYear() ? 'This year' : null;
}

/** Move the anchor by whole periods (±1 day/month/year). */
export function shiftAnchor(mode: PeriodMode, anchor: Date, delta: number): Date {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();
  if (mode === 'day') return new Date(y, m, d + delta);
  if (mode === 'month') return new Date(y, m + delta, 1);
  return new Date(y + delta, 0, 1);
}

/** Would shifting land within [min, max]'s period on that axis? Bounds the arrows. */
export function canShift(mode: PeriodMode, anchor: Date, delta: number, min: Date, max: Date): boolean {
  const next = shiftAnchor(mode, anchor, delta);
  const { start } = periodRange(mode, next);
  const { start: minStart } = periodRange(mode, min);
  const { start: maxStart } = periodRange(mode, max);
  return start.getTime() >= minStart.getTime() && start.getTime() <= maxStart.getTime();
}

/** The narrowed, sorted rows for the report. */
export function reportEntries(
  entries: LogEntry[],
  mode: PeriodMode,
  anchor: Date,
  sortKey: SortKey,
  sortDir: SortDir,
): LogEntry[] {
  const inWindow = entries.filter((e) => isInPeriod(e.createdAt, mode, anchor));
  const dir = sortDir === 'asc' ? 1 : -1;
  return inWindow.sort((a, b) => {
    if (sortKey === 'price') {
      const av = a.amount ?? -Infinity;
      const bv = b.amount ?? -Infinity;
      if (av !== bv) return (av - bv) * dir;
      // Tie-break priced rows by time so the order is stable.
      return a.createdAt.localeCompare(b.createdAt) * dir;
    }
    return a.createdAt.localeCompare(b.createdAt) * dir;
  });
}

/** Totals for the footer summary. */
export interface ReportTotals {
  count: number;
  /** Rows that carried an amount. */
  pricedCount: number;
  total: number;
  average: number;
  appCount: number;
  manualCount: number;
}

export function reportTotals(rows: LogEntry[]): ReportTotals {
  let total = 0;
  let pricedCount = 0;
  let appCount = 0;
  for (const r of rows) {
    if (r.amount != null) {
      total += r.amount;
      pricedCount += 1;
    }
    if (r.source === 'order') appCount += 1;
  }
  return {
    count: rows.length,
    pricedCount,
    total,
    average: pricedCount ? total / pricedCount : 0,
    appCount,
    manualCount: rows.length - appCount,
  };
}

/** Clip long strings for the details column. */
export function truncate(s: string, n = 44): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n).trimEnd() + '…';
}

/** Time cell: clock for a day report, date for month/year (they span days). */
export function rowTimeLabel(iso: string, mode: PeriodMode): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (mode === 'day') {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
