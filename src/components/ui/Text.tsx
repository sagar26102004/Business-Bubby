/** Themed Text. Variants map to the type scale; color follows the theme. */
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { fontSize, useColors } from '@/theme/theme';

type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';
type Tone = 'default' | 'muted' | 'brand' | 'accent' | 'inverse' | 'danger' | 'success';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

export function Text({
  variant = 'body',
  tone = 'default',
  weight,
  style,
  ...rest
}: TextProps) {
  const colors = useColors();

  const toneColor = {
    default: colors.text,
    muted: colors.textMuted,
    brand: colors.brandText,
    accent: colors.accent,
    inverse: colors.textInverse,
    danger: colors.danger,
    success: colors.success,
  }[tone];

  const variantStyle = variantStyles[variant];
  const resolvedWeight = weight ?? variantDefaultWeight[variant];

  return (
    <RNText
      style={[variantStyle, { color: toneColor, fontWeight: weightMap[resolvedWeight] }, style]}
      {...rest}
    />
  );
}

const weightMap = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

const variantDefaultWeight: Record<Variant, keyof typeof weightMap> = {
  title: 'bold',
  heading: 'bold',
  subheading: 'semibold',
  body: 'regular',
  label: 'medium',
  caption: 'regular',
};

const variantStyles = StyleSheet.create({
  title: { fontSize: fontSize.xxl, lineHeight: fontSize.xxl * 1.2 },
  heading: { fontSize: fontSize.xl, lineHeight: fontSize.xl * 1.25 },
  subheading: { fontSize: fontSize.lg, lineHeight: fontSize.lg * 1.3 },
  body: { fontSize: fontSize.md, lineHeight: fontSize.md * 1.45 },
  label: { fontSize: fontSize.sm, lineHeight: fontSize.sm * 1.4 },
  caption: { fontSize: fontSize.xs, lineHeight: fontSize.xs * 1.4 },
});
