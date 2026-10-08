/**
 * Segmented mode switcher — a recessed linen track with a crisp white pill on
 * the selected option (DESIGN.md → Segmented Mode Switcher). Used for
 * Popular ⇄ Nearest, Customer ⇄ Business and similar two-to-four way toggles.
 *
 * `look="pills"` drops the grey track: every option is its own white pill with
 * dark text, and the selected one turns brand green with white text.
 *
 * Pass `onClear` to let the selection be switched OFF: tapping the selected
 * option then calls it, and `value` may be null (nothing selected).
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface SegmentedControlProps<T extends string> {
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
  /** Makes the control deselectable — tapping the active option calls this. */
  onClear?: () => void;
  /** `track` (default): grey track, white pill on the pick. `pills`: white pills, green pick. */
  look?: 'track' | 'pills';
  /** Stretch segments to fill the row (default) or hug their labels. */
  fill?: boolean;
  style?: ViewStyle;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  onClear,
  look = 'track',
  fill = true,
  style,
}: SegmentedControlProps<T>) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        look === 'pills' ? styles.pillsTrack : { backgroundColor: colors.surfaceAlt },
        !fill && styles.hug,
        style,
      ]}
    >
      {options.map((o) => {
        const on = o.id === value;
        const pills = look === 'pills';
        return (
          <Pressable
            key={o.id}
            onPress={() => (on && onClear ? onClear() : onChange(o.id))}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              styles.seg,
              fill && styles.segFill,
              pills
                ? on
                  ? { backgroundColor: colors.brand, borderColor: colors.brand }
                  : { backgroundColor: colors.surface, borderColor: colors.border }
                : on && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              variant="caption"
              weight={on ? 'bold' : 'medium'}
              tone={pills ? (on ? 'inverse' : 'default') : on ? 'default' : 'muted'}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  hug: { alignSelf: 'flex-start' },
  pillsTrack: { padding: 0, gap: spacing.sm },
  seg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segFill: { flex: 1 },
});
