/**
 * Wizard chrome: "Step N of M · Phase" eyebrow, a bold title, the back arrow
 * and a progress rule along the bottom edge. Renders as the screen's own
 * header (pair with `headerShown: false`) so the progress sits flush under it.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useColors } from '@/theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface StepHeaderProps {
  step: number;
  total: number;
  /** "Business Identity", "Location & Privacy"… */
  phase: string;
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function StepHeader({ step, total, phase, title, onBack, right }: StepHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pct = Math.max(0, Math.min(1, step / total));
  return (
    <View
      style={{
        backgroundColor: colors.headerTint,
        paddingTop: insets.top,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={styles.row}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
          >
            <Icon name="arrowLeft" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        <View style={styles.titles}>
          <Text variant="caption" weight="bold" tone="muted" style={styles.eyebrow} numberOfLines={1}>
            STEP {step} OF {total} · {phase.toUpperCase()}
          </Text>
          <Text variant="subheading" weight="bold" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.right}>{right}</View>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.brand }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0 },
  eyebrow: { letterSpacing: 0.6, fontSize: 11 },
  right: { minWidth: 40, alignItems: 'flex-end', paddingRight: spacing.sm },
  track: { height: 3 },
  fill: { height: 3, borderTopRightRadius: radius.pill, borderBottomRightRadius: radius.pill },
});
