/**
 * The Logbook report's period picker — a self-contained calendar the owner
 * uses to jump to any day/month/year from the business's registration date up
 * to today. Built in-app (no native date library) so it runs the same on web
 * preview as on a device, matching how the rest of Localo avoids native-only
 * deps. Anything outside [min, max] is disabled.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import {
  MONTHS_FULL,
  MONTHS_SHORT,
  type PeriodMode,
  startOfDay,
} from './reportUtils';

interface Props {
  visible: boolean;
  mode: PeriodMode;
  anchor: Date;
  /** Earliest selectable date — the business's registration date. */
  min: Date;
  /** Latest selectable date — today. */
  max: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ReportDatePicker({ visible, mode, anchor, min, max, onSelect, onClose }: Props) {
  const colors = useColors();
  // Month being viewed in day mode / year being viewed in month mode.
  const [viewMonth, setViewMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [viewYear, setViewYear] = useState(() => anchor.getFullYear());

  // Re-centre on the current selection each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setViewMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      setViewYear(anchor.getFullYear());
    }
  }, [visible, anchor]);

  const title = mode === 'day' ? 'Pick a day' : mode === 'month' ? 'Pick a month' : 'Pick a year';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Text weight="semibold" variant="subheading">
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text weight="bold" tone="muted">
                ✕
              </Text>
            </Pressable>
          </View>

          {mode === 'day' ? (
            <DayGrid
              viewMonth={viewMonth}
              setViewMonth={setViewMonth}
              anchor={anchor}
              min={min}
              max={max}
              onSelect={onSelect}
            />
          ) : mode === 'month' ? (
            <MonthGrid
              viewYear={viewYear}
              setViewYear={setViewYear}
              anchor={anchor}
              min={min}
              max={max}
              onSelect={onSelect}
            />
          ) : (
            <YearGrid anchor={anchor} min={min} max={max} onSelect={onSelect} />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** ‹ label › navigation header shared by the day/month views. */
function NavHeader({
  label,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.navRow}>
      <Pressable onPress={onPrev} disabled={prevDisabled} hitSlop={8} style={styles.navBtn}>
        <Text variant="subheading" weight="bold" style={{ color: prevDisabled ? colors.border : colors.brand }}>
          ‹
        </Text>
      </Pressable>
      <Text weight="semibold">{label}</Text>
      <Pressable onPress={onNext} disabled={nextDisabled} hitSlop={8} style={styles.navBtn}>
        <Text variant="subheading" weight="bold" style={{ color: nextDisabled ? colors.border : colors.brand }}>
          ›
        </Text>
      </Pressable>
    </View>
  );
}

function DayGrid({
  viewMonth,
  setViewMonth,
  anchor,
  min,
  max,
  onSelect,
}: {
  viewMonth: Date;
  setViewMonth: (d: Date) => void;
  anchor: Date;
  min: Date;
  max: Date;
  onSelect: (d: Date) => void;
}) {
  const colors = useColors();
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const minDay = startOfDay(min).getTime();
  const maxDay = startOfDay(max).getTime();
  const selDay = startOfDay(anchor).getTime();
  const todayDay = startOfDay(new Date()).getTime();

  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Prev/next month allowed while any day of that month is inside [min, max].
  const prevDisabled = new Date(y, m, 0).getTime() < startOfDay(new Date(min.getFullYear(), min.getMonth(), 1)).getTime();
  const nextDisabled = new Date(y, m + 1, 1).getTime() > startOfDay(new Date(max.getFullYear(), max.getMonth(), 1)).getTime();

  return (
    <View>
      <NavHeader
        label={`${MONTHS_FULL[m]} ${y}`}
        onPrev={() => setViewMonth(new Date(y, m - 1, 1))}
        onNext={() => setViewMonth(new Date(y, m + 1, 1))}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
      />
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={styles.dayCell}>
            <Text variant="caption" tone="muted" weight="semibold">
              {w}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (d == null) return <View key={i} style={styles.dayCell} />;
          const t = new Date(y, m, d).getTime();
          const disabled = t < minDay || t > maxDay;
          const selected = t === selDay;
          const isToday = t === todayDay;
          return (
            <Pressable
              key={i}
              style={styles.dayCell}
              disabled={disabled}
              onPress={() => onSelect(new Date(y, m, d))}
            >
              <View style={[styles.dayPill, selected && { backgroundColor: colors.brand }, !selected && isToday && { borderWidth: 1, borderColor: colors.brand }]}>
                <Text
                  variant="label"
                  weight={selected || isToday ? 'semibold' : 'regular'}
                  style={{ color: disabled ? colors.border : selected ? colors.textInverse : colors.text }}
                >
                  {d}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({
  viewYear,
  setViewYear,
  anchor,
  min,
  max,
  onSelect,
}: {
  viewYear: number;
  setViewYear: (y: number) => void;
  anchor: Date;
  min: Date;
  max: Date;
  onSelect: (d: Date) => void;
}) {
  const colors = useColors();
  const minMonth = min.getFullYear() * 12 + min.getMonth();
  const maxMonth = max.getFullYear() * 12 + max.getMonth();
  const selMonth = anchor.getFullYear() * 12 + anchor.getMonth();

  const prevDisabled = viewYear - 1 < min.getFullYear();
  const nextDisabled = viewYear + 1 > max.getFullYear();

  return (
    <View>
      <NavHeader
        label={`${viewYear}`}
        onPrev={() => setViewYear(viewYear - 1)}
        onNext={() => setViewYear(viewYear + 1)}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
      />
      <View style={styles.grid}>
        {MONTHS_SHORT.map((label, i) => {
          const cellMonth = viewYear * 12 + i;
          const disabled = cellMonth < minMonth || cellMonth > maxMonth;
          const selected = cellMonth === selMonth;
          return (
            <Pressable
              key={i}
              style={styles.monthCell}
              disabled={disabled}
              onPress={() => onSelect(new Date(viewYear, i, 1))}
            >
              <View style={[styles.monthPill, selected && { backgroundColor: colors.brand }, { borderColor: colors.border }]}>
                <Text
                  variant="label"
                  weight={selected ? 'semibold' : 'regular'}
                  style={{ color: disabled ? colors.border : selected ? colors.textInverse : colors.text }}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function YearGrid({ anchor, min, max, onSelect }: { anchor: Date; min: Date; max: Date; onSelect: (d: Date) => void }) {
  const colors = useColors();
  const years: number[] = [];
  for (let y = max.getFullYear(); y >= min.getFullYear(); y--) years.push(y);
  const selYear = anchor.getFullYear();
  return (
    <View style={styles.grid}>
      {years.map((y) => {
        const selected = y === selYear;
        return (
          <Pressable key={y} style={styles.monthCell} onPress={() => onSelect(new Date(y, 0, 1))}>
            <View style={[styles.monthPill, selected && { backgroundColor: colors.brand }, { borderColor: colors.border }]}>
              <Text
                variant="label"
                weight={selected ? 'semibold' : 'regular'}
                style={{ color: selected ? colors.textInverse : colors.text }}
              >
                {y}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: { borderRadius: radius.lg, padding: spacing.lg, maxWidth: 380, width: '100%', alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  navBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  dayPill: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  monthCell: { width: `${100 / 3}%`, padding: spacing.xs },
  monthPill: { paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'center' },
});
