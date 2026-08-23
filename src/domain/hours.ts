/**
 * Business opening hours — a structured, reusable model (not free text).
 *
 * Times are stored as 24-hour "HH:MM" strings so they're unambiguous, sortable,
 * and easy to reformat for any locale. Days are indexed 0=Monday … 6=Sunday
 * (business-week order); map from JS `Date.getDay()` (0=Sunday) with `todayIndex`.
 *
 * A day holds a LIST of shifts, because plenty of businesses open twice in one
 * day — a gym running 5–10 AM and 5–10 PM, a restaurant that shuts between lunch
 * and dinner. An overnight shift (close earlier than open, e.g. a 6 PM–2 AM bar)
 * is understood by `isOpenNow`. Everything downstream — the Open/Closed pill, the
 * card's 🕒 label, the business page schedule — derives from this one shape.
 *
 * Back-compat: before shifts existed a day was a single `open`/`close` pair, and
 * both stored listings and the other backend still carry that form. `dayShifts`
 * reads either, and writers keep `open`/`close` in step with the FIRST shift so
 * an older reader still shows something true rather than nothing.
 */

/** One open→close interval within a day. 24h "HH:MM" both sides. */
export interface Shift {
  open: string;
  close: string;
}

/** Hours for a single day. Closed all day when `closed` is true. */
export interface DayHours {
  closed?: boolean;
  /**
   * Every interval the business is open that day, in order. When absent, the
   * legacy `open`/`close` pair below is the day's single shift.
   */
  shifts?: Shift[];
  /** 24h "HH:MM", e.g. "09:00". Mirrors `shifts[0].open`. */
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

/**
 * A day's usable shifts, earliest first — the ONE reader every helper goes
 * through. Reads the new `shifts` list or the legacy single pair, drops
 * anything that doesn't parse, and returns [] for a closed (or empty) day.
 */
export function dayShifts(d?: DayHours): Shift[] {
  if (!d || d.closed) return [];
  const raw = d.shifts?.length ? d.shifts : [{ open: d.open, close: d.close }];
  return raw
    .filter(
      (s): s is Shift =>
        !!s && timeToMinutes(s.open) !== null && timeToMinutes(s.close) !== null,
    )
    .sort((a, b) => timeToMinutes(a.open)! - timeToMinutes(b.open)!);
}

/**
 * Build a day from its shifts, keeping the legacy `open`/`close` pair pointed at
 * the first one so older readers (and the other backend) still see real hours.
 */
export function dayFromShifts(shifts: Shift[]): DayHours {
  const ordered = dayShifts({ shifts });
  if (!ordered.length) return { closed: true };
  return { shifts: ordered, open: ordered[0].open, close: ordered[0].close };
}

/** True when a day has at least one usable open→close interval. */
function isDayOpen(d?: DayHours): boolean {
  return dayShifts(d).length > 0;
}

/** One shift as text, e.g. "9 AM – 6 PM". */
function formatShift(s: Shift): string {
  return `${formatTime(s.open)} – ${formatTime(s.close)}`;
}

/** A day's hours as text, e.g. "5 AM – 10 AM, 5 PM – 10 PM" or "Closed". */
export function formatDayHours(d?: DayHours): string {
  const shifts = dayShifts(d);
  if (!shifts.length) return 'Closed';
  return shifts.map(formatShift).join(', ');
}

/** Is `nowMins` inside this shift on the shift's OWN day? */
function coversToday(s: Shift, nowMins: number): boolean {
  const open = timeToMinutes(s.open)!;
  const close = timeToMinutes(s.close)!;
  // Overnight (e.g. 18:00 → 02:00): open from `open` to the end of the day.
  return close > open ? nowMins >= open && nowMins < close : nowMins >= open;
}

/** Does this shift spill past midnight and still cover `nowMins` the next day? */
function spillsIntoNextDay(s: Shift, nowMins: number): boolean {
  const open = timeToMinutes(s.open)!;
  const close = timeToMinutes(s.close)!;
  return close <= open && nowMins < close;
}

/** Is the business open at `now`? `undefined` when there are no usable hours. */
export function isOpenNow(hours?: OpeningHours, now: Date = new Date()): boolean | undefined {
  if (!hours || hours.days.length !== 7) return undefined;
  const anyUsable = hours.days.some((d) => isDayOpen(d) || d.closed);
  if (!anyUsable) return undefined;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = todayIndex(now);

  // Any of today's own shifts.
  if (dayShifts(hours.days[today]).some((s) => coversToday(s, nowMins))) return true;

  // An overnight shift from YESTERDAY that spills into the early morning.
  const prev = hours.days[(today + 6) % 7];
  if (dayShifts(prev).some((s) => spillsIntoNextDay(s, nowMins))) return true;

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
  const text = (d: DayHours) => {
    const shifts = dayShifts(d);
    if (!shifts.length) return 'closed';
    return shifts.map((s) => `${formatTime(s.open)}–${formatTime(s.close)}`).join(', ');
  };
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
