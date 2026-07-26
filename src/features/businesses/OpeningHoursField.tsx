/**
 * Opening-hours editor — captures a business's weekly timings in a STRUCTURED,
 * proper format (24h "HH:MM" per day) so the app can compute Open/Closed and
 * render clean timings everywhere, instead of relying on free text.
 *
 * The user types times however they like ("9", "9:30 am", "18:00", "6pm"); we
 * parse each to "HH:MM" for storage and echo it back nicely ("9 AM") on blur.
 * The value we emit is a `domain/hours.ts` `OpeningHours` (7 days, Mon…Sun), or
 * `undefined` when every day is closed (i.e. no hours specified).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  DAY_LABELS,
  formatTime,
  hasUsableHours,
  type OpeningHours,
} from '@/domain/hours';
import { Button, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface OpeningHoursFieldProps {
  value?: OpeningHours;
  onChange: (value: OpeningHours | undefined) => void;
}

/** One editable day row's local state — display text the user typed. */
interface Row {
  closed: boolean;
  open: string;
  close: string;
}

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

function rowsFromValue(value?: OpeningHours): Row[] {
  return DAY_LABELS.map((_, i) => {
    const d = value?.days?.[i];
    if (!d || d.closed) return { closed: true, open: '', close: '' };
    return { closed: false, open: formatTime(d.open), close: formatTime(d.close) };
  });
}

export function OpeningHoursField({ value, onChange }: OpeningHoursFieldProps) {
  const colors = useColors();
  // Initialised once from the incoming value (e.g. a restored draft); after that
  // the local rows are the source of truth and we emit upward on every edit.
  const [rows, setRows] = useState<Row[]>(() => rowsFromValue(value));

  const emit = (next: Row[]) => {
    const week: OpeningHours = {
      days: next.map((r) =>
        r.closed
          ? { closed: true }
          : { open: parseTimeInput(r.open), close: parseTimeInput(r.close) },
      ),
    };
    const anyOpen = next.some((r) => !r.closed);
    onChange(anyOpen ? week : undefined);
  };

  // Note: compute the next rows here and call setRows + emit separately. Do NOT
  // call emit() inside a setRows(prev => …) updater — React runs updaters during
  // render, and emit() calls the parent's onChange (a setState on RegisterScreen),
  // which triggers a "cannot update a component while rendering another" warning.
  const update = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    emit(next);
  };

  /** Normalise a typed time to its pretty form on blur, if it parses. */
  const normalise = (i: number, field: 'open' | 'close') => {
    const parsed = parseTimeInput(rows[i][field]);
    if (!parsed) return;
    const next = rows.map((r, idx) => (idx === i ? { ...r, [field]: formatTime(parsed) } : r));
    setRows(next);
    emit(next);
  };

  /** Copy the first open day's times onto every other day (opening them). */
  const applyToAll = () => {
    const src = rows.find((r) => !r.closed && r.open);
    if (!src) return;
    const next = rows.map(() => ({ closed: false, open: src.open, close: src.close }));
    setRows(next);
    emit(next);
  };

  const canApplyToAll = rows.some((r) => !r.closed && r.open);

  return (
    <View style={styles.wrap}>
      <Text weight="medium">Opening hours (optional)</Text>
      <Text variant="caption" tone="muted" style={styles.hint}>
        Set the times customers can reach you — we’ll show an Open / Closed badge automatically.
      </Text>

      {rows.map((row, i) => (
        <View key={DAY_LABELS[i]} style={styles.row}>
          <Text weight="semibold" style={styles.dayLabel}>
            {DAY_LABELS[i]}
          </Text>
          <Pressable
            onPress={() => update(i, { closed: !row.closed })}
            style={[
              styles.toggle,
              {
                backgroundColor: row.closed ? colors.surfaceAlt : colors.brandSoft,
                borderColor: row.closed ? colors.border : colors.brand,
              },
            ]}
          >
            <Text variant="caption" weight="semibold" tone={row.closed ? 'muted' : 'brand'}>
              {row.closed ? 'Closed' : 'Open'}
            </Text>
          </Pressable>
          {!row.closed ? (
            <View style={styles.times}>
              <TextInput
                style={[styles.timeInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                placeholder="9 AM"
                placeholderTextColor={colors.textMuted}
                value={row.open}
                onChangeText={(t) => update(i, { open: t })}
                onBlur={() => normalise(i, 'open')}
                autoCorrect={false}
              />
              <Text tone="muted">–</Text>
              <TextInput
                style={[styles.timeInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                placeholder="6 PM"
                placeholderTextColor={colors.textMuted}
                value={row.close}
                onChangeText={(t) => update(i, { close: t })}
                onBlur={() => normalise(i, 'close')}
                autoCorrect={false}
              />
            </View>
          ) : (
            <View style={styles.times} />
          )}
        </View>
      ))}

      {canApplyToAll ? (
        <Button
          title="Apply the first day’s times to every day"
          variant="ghost"
          onPress={applyToAll}
          style={styles.applyAll}
        />
      ) : null}

      {!hasUsableHours(value) ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Leave all days Closed to skip hours for now.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  hint: { marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  dayLabel: { width: 38 },
  toggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 62,
    alignItems: 'center',
  },
  times: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  timeInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 15,
    textAlign: 'center',
  },
  applyAll: { alignSelf: 'flex-start' },
});
