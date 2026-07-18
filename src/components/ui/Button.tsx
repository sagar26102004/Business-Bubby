/** Themed button with primary / secondary / ghost variants. */
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
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
  }[variant];

  const borderColor = variant === 'secondary' ? colors.border : 'transparent';
  const textTone = variant === 'primary' ? 'inverse' : variant === 'ghost' ? 'brand' : 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor, borderWidth: variant === 'secondary' ? 1 : 0 },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textInverse : colors.brand} />
      ) : (
        <Text variant="label" tone={textTone} weight="semibold">
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
