/**
 * Themed button with primary / secondary / ghost / cta variants. `cta` is the
 * terracotta "go buy it" accent (Claim deal, View menu, Buy now) — use it
 * sparingly, at most one per card; submit and navigation stay `primary`.
 */
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'cta';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const colors = useColors();
  const isDisabled = disabled || loading;

  const bg = {
    primary: colors.brand,
    secondary: colors.surfaceAlt,
    ghost: 'transparent',
    cta: colors.cta,
  }[variant];
  const solid = variant === 'primary' || variant === 'cta';

  const textTone = solid ? 'inverse' : variant === 'ghost' ? 'brand' : 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? colors.textInverse : colors.brand} />
      ) : (
        <Text variant="label" tone={textTone} weight="bold" style={styles.label}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Fully rounded, borderless, a touch taller — the neighborhood look leans on
  // shape and fill rather than outlines to separate primary from secondary.
  base: {
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
  },
  label: { fontSize: 15 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
