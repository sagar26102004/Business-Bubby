/**
 * Segmented mode switcher — a recessed linen track with a crisp white pill on
 * the selected option (DESIGN.md → Segmented Mode Switcher). Used for
 * Popular ⇄ Nearest, Customer ⇄ Business and similar two-to-four way toggles.
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface SegmentedControlProps<T extends string> {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** Stretch segments to fill the row (default) or hug their labels. */
  fill?: boolean;
  style?: ViewStyle;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = true,
  style,
}: SegmentedControlProps<T>) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.surfaceAlt }, !fill && styles.hug, style]}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              styles.seg,
              fill && styles.segFill,
              on && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              variant="caption"
              weight={on ? 'bold' : 'medium'}
              tone={on ? 'default' : 'muted'}
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
