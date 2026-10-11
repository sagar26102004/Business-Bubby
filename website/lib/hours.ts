/**
 * Opening-hours helpers — COPIED (trimmed) from `src/domain/hours.ts` in the app.
 * Times are 24h "HH:MM"; days are 0=Mon…6=Sun; a close earlier than its open
 * is an overnight shift.
 */
import type { DayHours, OpeningHours, Shift } from './types';

export const DAY_LABELS_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Business-week index (0=Mon…6=Sun) for a JS Date. */
export function todayIndex(now: Date = new Date()): number {
  return (now.getDay() + 6) % 7;
}

function timeToMinutes(t?: string): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatTime(t?: string): string {
  const mins = timeToMinutes(t);
  if (mins === null) return '';
  const h24 = Math.floor(mins / 60);
  const min = mins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${period}` : `${h12}:${String(min).padStart(2, '0')} ${period}`;
}

function dayShifts(d?: DayHours): Shift[] {
  if (!d || d.closed) return [];
  const raw = d.shifts?.length ? d.shifts : [{ open: d.open, close: d.close }];
  return raw
    .filter(
      (s): s is Shift =>
        !!s && timeToMinutes(s.open) !== null && timeToMinutes(s.close) !== null,
    )
    .sort((a, b) => timeToMinutes(a.open)! - timeToMinutes(b.open)!);
}

/** "9 AM – 6 PM, 7 PM – 11 PM" or "Closed". */
export function formatDayHours(d?: DayHours): string {
  const shifts = dayShifts(d);
  if (!shifts.length) return 'Closed';
  return shifts.map((s) => `${formatTime(s.open)} – ${formatTime(s.close)}`).join(', ');
}

export function hasUsableHours(hours?: OpeningHours): hours is OpeningHours {
  return !!hours && hours.days?.length === 7 && hours.days.some((d) => dayShifts(d).length > 0);
}

/** Open at `now`? `undefined` when there are no usable hours. */
export function isOpenNow(hours?: OpeningHours, now: Date = new Date()): boolean | undefined {
  if (!hasUsableHours(hours)) return undefined;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = todayIndex(now);
  const coversToday = (s: Shift) => {
    const open = timeToMinutes(s.open)!;
    const close = timeToMinutes(s.close)!;
    return close > open ? nowMins >= open && nowMins < close : nowMins >= open;
  };
  const spills = (s: Shift) => {
    const open = timeToMinutes(s.open)!;
    const close = timeToMinutes(s.close)!;
    return close <= open && nowMins < close;
  };
  if (dayShifts(hours.days[today]).some(coversToday)) return true;
  if (dayShifts(hours.days[(today + 6) % 7]).some(spills)) return true;
  return false;
}

/** Today's hours, e.g. "9 AM – 6 PM" / "Closed today". */
export function todayHoursLabel(hours?: OpeningHours, now: Date = new Date()): string | undefined {
  if (!hasUsableHours(hours)) return undefined;
  const d = hours.days[todayIndex(now)];
  return dayShifts(d).length ? formatDayHours(d) : 'Closed today';
}

/** schema.org `openingHoursSpecification` entries, for search engines. */
export function openingHoursSpec(hours?: OpeningHours) {
  if (!hasUsableHours(hours)) return undefined;
  return hours.days.flatMap((d, i) =>
    dayShifts(d).map((s) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY_LABELS_FULL[i],
      opens: s.open,
      closes: s.close,
    })),
  );
}
