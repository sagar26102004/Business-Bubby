/**
 * Themed pill button (docs/redesign-one-place/DESIGN.md → Buttons).
 *
 *  - `primary`   deep sage fill — submit, navigation, "Book", "Publish".
 *  - `cta`       terracotta — the "go buy it" accent (Order now, Claim, Buy);
 *                use sparingly, at most one per card.
 *  - `secondary` soft linen fill, charcoal label (alias: `linen`).
 *  - `outline`   white with a stone hairline — quiet alternatives ("View plans").
 *  - `ghost`     no fill, sage label.
 *
 * `size="sm"` is the compact 38px pill used inside cards; the default is the
 * 50px thumb-friendly one.
 */
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'linen' | 'outline' | 'ghost' | 'cta';
  size?: 'sm' | 'md';
  /** Optional leading line icon. */
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const colors = useColors();
  const isDisabled = disabled || loading;
  const v = variant === 'linen' ? 'secondary' : variant;

  const bg = {
    primary: colors.brand,
    secondary: colors.surfaceAlt,
    outline: colors.surface,
    ghost: 'transparent',
    cta: colors.cta,
  }[v];
  const solid = v === 'primary' || v === 'cta';
  const fg = solid ? colors.textInverse : v === 'ghost' || v === 'outline' ? colors.brandText : colors.text;
  const textTone = solid ? 'inverse' : v === 'ghost' || v === 'outline' ? 'brand' : 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!isDisabled }}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' && styles.sm,
        { backgroundColor: bg },
        v === 'outline' && { borderWidth: 1, borderColor: colors.border },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? colors.textInverse : colors.brand} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
          <Text
            variant="label"
            tone={textTone}
            weight="bold"
            style={[size === 'sm' ? styles.labelSm : styles.label, styles.center]}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sm: { minHeight: 38, paddingHorizontal: spacing.lg, gap: spacing.xs + 2 },
  label: { fontSize: 15 },
  labelSm: { fontSize: 14 },
  center: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
