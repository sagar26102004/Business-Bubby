/**
 * Business opening hours — a structured, reusable model (not free text).
 *
 * Times are stored as 24-hour "HH:MM" strings so they're unambiguous, sortable,
 * and easy to reformat for any locale. Days are indexed 0=Monday … 6=Sunday
 * (business-week order); map from JS `Date.getDay()` (0=Sunday) with `todayIndex`.
 *
 * One open→close interval per day covers the common case and stays simple to
 * edit; an overnight interval (close earlier than open, e.g. a 6 PM–2 AM bar) is
 * understood by `isOpenNow`. Everything downstream — the Open/Closed pill, the
 * card's 🕒 label, the business page schedule — derives from this one shape.
 */

/** Hours for a single day. Closed all day when `closed` is true. */
export interface DayHours {
  closed?: boolean;
  /** 24h "HH:MM", e.g. "09:00". */
  open?: string;
  /** 24h "HH:MM", e.g. "18:00". Earlier than `open` = closes after midnight. */
  close?: string;
}

/** A week of opening hours. `days` always has 7 entries, index 0=Mon…6=Sun. */
export interface OpeningHours {
  days: DayHours[];
  /** Optional free note, e.g. "Closed on public holidays". */
  note?: string;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAY_LABELS_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** An empty week (every day closed) — the starting point for the editor. */
export function emptyWeek(): OpeningHours {
  return { days: DAY_LABELS.map(() => ({ closed: true })) };
}

/** Business-week index (0=Mon…6=Sun) for a JS Date (whose getDay is 0=Sun). */
export function todayIndex(now: Date = new Date()): number {
  return (now.getDay() + 6) % 7;
}

/** "HH:MM" → minutes since midnight, or null when unparseable. */
export function timeToMinutes(t?: string): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "09:00" → "9 AM", "18:30" → "6:30 PM". Returns '' for unparseable input. */
export function formatTime(t?: string): string {
  const mins = timeToMinutes(t);
  if (mins === null) return '';
  const h24 = Math.floor(mins / 60);
  const min = mins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${period}` : `${h12}:${String(min).padStart(2, '0')} ${period}`;
}

/** True when a day has a usable open→close interval. */
function isDayOpen(d?: DayHours): d is DayHours & { open: string; close: string } {
  return (
    !!d &&
    !d.closed &&
    timeToMinutes(d.open) !== null &&
    timeToMinutes(d.close) !== null
  );
}

/** A day's hours as text, e.g. "9 AM – 6 PM" or "Closed". */
export function formatDayHours(d?: DayHours): string {
  if (!isDayOpen(d)) return 'Closed';
  return `${formatTime(d.open)} – ${formatTime(d.close)}`;
}

/** Is the business open at `now`? `undefined` when there are no usable hours. */
export function isOpenNow(hours?: OpeningHours, now: Date = new Date()): boolean | undefined {
  if (!hours || hours.days.length !== 7) return undefined;
  const anyUsable = hours.days.some((d) => isDayOpen(d) || d.closed);
  if (!anyUsable) return undefined;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = todayIndex(now);

  // Today's own interval.
  const t = hours.days[today];
  if (isDayOpen(t)) {
    const open = timeToMinutes(t.open)!;
    const close = timeToMinutes(t.close)!;
    if (close > open) {
      if (nowMins >= open && nowMins < close) return true;
    } else {
      // Overnight (e.g. 18:00 → 02:00): open from `open` to end of day.
      if (nowMins >= open) return true;
    }
  }

  // An overnight interval from YESTERDAY that spills into the early morning.
  const prev = hours.days[(today + 6) % 7];
  if (isDayOpen(prev)) {
    const open = timeToMinutes(prev.open)!;
    const close = timeToMinutes(prev.close)!;
    if (close <= open && nowMins < close) return true;
  }

  return false;
}

/** Today's hours label, e.g. "9 AM – 6 PM" / "Closed today". */
export function todayHoursLabel(hours?: OpeningHours, now: Date = new Date()): string | undefined {
  if (!hours || hours.days.length !== 7) return undefined;
  const d = hours.days[todayIndex(now)];
  if (!d) return undefined;
  return isDayOpen(d) ? formatDayHours(d) : 'Closed today';
}

/**
 * A compact multi-day summary, grouping consecutive days that share hours —
 * e.g. "Mon–Fri 9 AM–6 PM · Sat 10 AM–2 PM · Sun closed". Handy as a one-line
 * label and as the legacy `Business.hours` fallback.
 */
export function summarizeHours(hours?: OpeningHours): string | undefined {
  if (!hours || hours.days.length !== 7) return undefined;
  const text = (d: DayHours) => (isDayOpen(d) ? `${formatTime(d.open)}–${formatTime(d.close)}` : 'closed');
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const cur = text(hours.days[i]);
    let j = i;
    while (j + 1 < 7 && text(hours.days[j + 1]) === cur) j++;
    const label = i === j ? DAY_LABELS[i] : `${DAY_LABELS[i]}–${DAY_LABELS[j]}`;
    parts.push(cur === 'closed' ? `${label} closed` : `${label} ${cur}`);
    i = j + 1;
  }
  // If every day is closed there's nothing meaningful to show.
  if (parts.every((p) => p.endsWith('closed'))) return undefined;
  return parts.join(' · ');
}

/** Does this hours object carry at least one real open day? */
export function hasUsableHours(hours?: OpeningHours): boolean {
  return !!hours && hours.days.length === 7 && hours.days.some(isDayOpen);
}

/** The 7-row schedule for the business page, today flagged. */
export function weeklySchedule(
  hours: OpeningHours,
  now: Date = new Date(),
): { label: string; text: string; today: boolean }[] {
  const today = todayIndex(now);
  return DAY_LABELS_FULL.map((label, i) => ({
    label,
    text: formatDayHours(hours.days[i]),
    today: i === today,
  }));
}

/**
 * The combined open state used by the card + page: prefers structured hours,
 * falling back to the legacy stored `openNow` boolean when there are none.
 */
export function openState(
  business: { openingHours?: OpeningHours; openNow?: boolean },
  now: Date = new Date(),
): { open?: boolean; todayLabel?: string } {
  const fromHours = isOpenNow(business.openingHours, now);
  if (fromHours !== undefined) {
    return { open: fromHours, todayLabel: todayHoursLabel(business.openingHours, now) };
  }
  return { open: business.openNow };
}
