/**
 * Opening-hours editor — asks the two things a business actually knows: the
 * hours it keeps, and which days it keeps them. Instead of seven rows to fill
 * in, one block says "9 AM – 6 PM, Mon–Sat"; a shop whose Sunday differs adds a
 * SECOND block ("11 AM – 3 PM, Sun") rather than editing days one by one.
 *
 * A day can sit in SEVERAL blocks, because a business may open twice in one day
 * — a gym running 5–10 AM and 5–10 PM picks Mon–Sat in both blocks and the day
 * keeps both shifts. (Blocks used to be exclusive, so the second entry silently
 * replaced the first.) A day no block claims is closed.
 *
 * The user types times however they like ("9", "9:30 am", "18:00", "6pm"); we
 * parse each to "HH:MM" for storage and echo it back nicely ("9 AM") on blur.
 * The value we emit is a `domain/hours.ts` `OpeningHours` (7 days, Mon…Sun), or
 * `undefined` while no block has a usable open→close time (i.e. hours skipped).
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  DAY_LABELS,
  dayFromShifts,
  dayShifts,
  formatTime,
  summarizeHours,
  type DayHours,
  type OpeningHours,
  type Shift,
} from '@/domain/hours';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface OpeningHoursFieldProps {
  value?: OpeningHours;
  onChange: (value: OpeningHours | undefined) => void;
}

/** One timing and the days that keep it. `days` has 7 flags, 0=Mon…6=Sun. */
interface Block {
  key: string;
  /** Display text the user typed, e.g. "9 AM". */
  open: string;
  close: string;
  days: boolean[];
}

const noDays = () => DAY_LABELS.map(() => false);
const allDays = () => DAY_LABELS.map(() => true);
/** Days 0..n selected, the rest off — Mon-anchored runs like Mon–Fri. */
const runOfDays = (through: number) => DAY_LABELS.map((_, i) => i <= through);

/** Quick fills for the first block — the three schedules most businesses keep. */
const PRESETS: { label: string; days: () => boolean[] }[] = [
  { label: 'Every day', days: allDays },
  { label: 'Mon–Sat', days: () => runOfDays(5) },
  { label: 'Mon–Fri', days: () => runOfDays(4) },
];

/**
 * Lenient time parser → 24h "HH:MM". Accepts "9", "9:30", "9am", "9:30 pm",
 * "18:00", "6 pm". Returns undefined when it can't make sense of the input.
 */
export function parseTimeInput(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return undefined;
  if (mer) {
    if (h < 1 || h > 12) return undefined;
    if (mer === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return undefined;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Fold an existing week back into blocks: every SHIFT of every day is grouped by
 * its timing, so a gym stored as 5–10 AM + 5–10 PM on Mon–Sat comes back as two
 * blocks that both hold Mon–Sat. A fresh form starts as a single every-day block
 * with empty times.
 */
function blocksFromValue(value?: OpeningHours): Block[] {
  const groups = new Map<string, Block>();
  DAY_LABELS.forEach((_, i) => {
    dayShifts(value?.days?.[i]).forEach((s) => {
      const key = `${s.open}-${s.close}`;
      const existing = groups.get(key);
      if (existing) {
        existing.days[i] = true;
        return;
      }
      const days = noDays();
      days[i] = true;
      groups.set(key, { key, open: formatTime(s.open), close: formatTime(s.close), days });
    });
  });
  const list = [...groups.values()];
  return list.length ? list : [{ key: 'b0', open: '', close: '', days: allDays() }];
}

/**
 * Blocks → the 7-day week we store. Each block ADDS a shift to every day it
 * claims (identical timings collapse into one), so two blocks over the same days
 * make a two-shift day instead of the second overwriting the first. Days no
 * block claims are closed.
 */
function weekFromBlocks(blocks: Block[]): OpeningHours | undefined {
  const perDay: Shift[][] = DAY_LABELS.map(() => []);
  let any = false;
  blocks.forEach((b) => {
    const open = parseTimeInput(b.open);
    const close = parseTimeInput(b.close);
    if (!open || !close) return;
    b.days.forEach((on, i) => {
      if (!on) return;
      if (perDay[i].some((s) => s.open === open && s.close === close)) return;
      perDay[i].push({ open, close });
      any = true;
    });
  });
  const days: DayHours[] = perDay.map((shifts) => dayFromShifts(shifts));
  return any ? { days } : undefined;
}

export function OpeningHoursField({ value, onChange }: OpeningHoursFieldProps) {
  const colors = useColors();
  // Initialised once from the incoming value (a restored draft, or the business
  // being edited); after that the local blocks are the source of truth and we
  // emit upward on every edit.
  const [blocks, setBlocks] = useState<Block[]>(() => blocksFromValue(value));
  const nextKey = useRef(blocks.length);

  // Note: compute the next blocks here and call setBlocks + emit separately. Do
  // NOT emit inside a setBlocks(prev => …) updater — React runs updaters during
  // render, and onChange is a setState on the parent screen, which would warn
  // "cannot update a component while rendering another".
  const apply = (next: Block[]) => {
    setBlocks(next);
    onChange(weekFromBlocks(next));
  };

  const setField = (i: number, patch: Partial<Block>) =>
    apply(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  /** Normalise a typed time to its pretty form on blur, if it parses. */
  const normalise = (i: number, field: 'open' | 'close') => {
    const parsed = parseTimeInput(blocks[i][field]);
    if (!parsed) return;
    setField(i, { [field]: formatTime(parsed) } as Partial<Block>);
  };

  /** Give exactly `wanted` to block `bi`. Other blocks keep their own days. */
  const assign = (bi: number, wanted: boolean[]) => setField(bi, { days: [...wanted] });

  /**
   * Tap a day chip: add this block's timing to that day, or take it off. Other
   * blocks are untouched — the same day in two blocks is two shifts, which is
   * exactly how a morning + evening business is entered.
   */
  const toggleDay = (bi: number, di: number) =>
    setField(bi, {
      days: blocks[bi].days.map((on, d) => (d === di ? !on : on)),
    });

  /**
   * A new block starts on the same days as the last one that has any — the
   * common case is a second shift on the very same days, and days can now be
   * shared. Unpick them for hours that only apply to other days.
   */
  const addBlock = () => {
    const key = `b${nextKey.current++}`;
    const last = [...blocks].reverse().find((b) => b.days.some(Boolean));
    apply([...blocks, { key, open: '', close: '', days: last ? [...last.days] : noDays() }]);
  };

  const removeBlock = (i: number) => apply(blocks.filter((_, idx) => idx !== i));

  const week = weekFromBlocks(blocks);
  const summary = summarizeHours(week);
  const closedDays = DAY_LABELS.filter((_, i) => !blocks.some((b) => b.days[i]));

  return (
    <View style={styles.wrap}>
      <Text weight="medium">Opening hours (optional)</Text>
      <Text variant="caption" tone="muted" style={styles.hint}>
        Set the times you’re open and the days you keep them — we’ll show an Open / Closed badge
        automatically. Open twice a day? Add a second timing over the same days.
      </Text>

      {blocks.map((block, i) => {
        const dayCount = block.days.filter(Boolean).length;
        const timed = !!parseTimeInput(block.open) && !!parseTimeInput(block.close);
        return (
          <View
            key={block.key}
            style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {i > 0 ? (
              <View style={styles.blockHead}>
                <Text variant="caption" weight="semibold" tone="muted">
                  Timing {i + 1}
                </Text>
                <Pressable onPress={() => removeBlock(i)} hitSlop={8}>
                  <Text variant="caption" weight="semibold" tone="danger">
                    Remove
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.times}>
              <View style={styles.timeField}>
                <Text variant="caption" tone="muted">
                  Opens
                </Text>
                <TextInput
                  style={[
                    styles.timeInput,
                    { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  placeholder="9 AM"
                  placeholderTextColor={colors.textMuted}
                  value={block.open}
                  onChangeText={(t) => setField(i, { open: t })}
                  onBlur={() => normalise(i, 'open')}
                  autoCorrect={false}
                />
              </View>
              <Text tone="muted" style={styles.dash}>
                –
              </Text>
              <View style={styles.timeField}>
                <Text variant="caption" tone="muted">
                  Closes
                </Text>
                <TextInput
                  style={[
                    styles.timeInput,
                    { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  placeholder="6 PM"
                  placeholderTextColor={colors.textMuted}
                  value={block.close}
                  onChangeText={(t) => setField(i, { close: t })}
                  onBlur={() => normalise(i, 'close')}
                  autoCorrect={false}
                />
              </View>
            </View>

            <Text variant="caption" tone="muted" style={styles.daysLabel}>
              {i === 0 ? 'On these days' : 'On these days (they can repeat from above)'}
            </Text>

            {i === 0 ? (
              <View style={styles.presets}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p.label}
                    onPress={() => assign(i, p.days())}
                    style={[styles.preset, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                  >
                    <Text variant="caption" weight="semibold">
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.dayRow}>
              {DAY_LABELS.map((label, d) => {
                const on = block.days[d];
                return (
                  <Pressable
                    key={label}
                    onPress={() => toggleDay(i, d)}
                    style={[
                      styles.day,
                      {
                        backgroundColor: on ? colors.brand : colors.surfaceAlt,
                        borderColor: on ? colors.brand : colors.border,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      weight="semibold"
                      tone={on ? 'inverse' : 'muted'}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {timed && dayCount === 0 ? (
              <Text variant="caption" tone="danger">
                Pick at least one day, or these hours won’t be used.
              </Text>
            ) : null}
          </View>
        );
      })}

      {/* Hidden only while an empty block is already waiting for days, so the
          list can't grow a stack of blocks that mean nothing. */}
      {blocks.every((b) => b.days.some(Boolean)) ? (
        <Pressable onPress={addBlock} style={styles.add} hitSlop={6}>
          <Text variant="caption" weight="semibold" tone="brand">
            ＋ Add another timing
          </Text>
          <Text variant="caption" tone="muted">
            A second shift on the same days (5 PM – 10 PM), or different hours
            {closedDays.length > 0 ? ` on ${closedDays.join(', ')}` : ' on some days'}.
          </Text>
        </Pressable>
      ) : null}

      {summary ? (
        <Text variant="caption" tone="muted" style={styles.summary}>
          {summary}
        </Text>
      ) : (
        <Text variant="caption" tone="muted" style={styles.summary}>
          Leave the times empty to skip hours for now.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  hint: { marginBottom: spacing.xs },
  block: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  times: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  timeField: { flex: 1, gap: 2 },
  dash: { paddingBottom: spacing.sm },
  timeInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 15,
    textAlign: 'center',
  },
  daysLabel: { marginTop: spacing.xs },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  preset: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  day: {
    minWidth: 42,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  add: { paddingVertical: spacing.xs, gap: 2 },
  summary: { marginTop: 2 },
});
