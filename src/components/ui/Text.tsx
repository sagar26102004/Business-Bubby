/** Themed Text. Variants map to the type scale; color follows the theme. */
import { Text as RNText, TextProps as RNTextProps, StyleSheet, type TextStyle } from 'react-native';
import { fontSize, useColors } from '@/theme/theme';
import { fontFor, type FontWeight } from '@/theme/fonts';

type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';
type Tone =
  | 'default'
  | 'muted'
  | 'brand'
  | 'accent'
  | 'inverse'
  | 'danger'
  | 'success'
  | 'cta'
  | 'star';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: FontWeight;
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
    success: colors.successText,
    cta: colors.cta,
    star: colors.starText,
  }[tone];

  // A caller's `style={{ fontWeight: '700' }}` still wins — but it has to be
  // turned into the matching FAMILY, because each weight is its own font file
  // and a bare fontWeight on a custom family falls back to the system font.
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const styleWeight = flat?.fontWeight != null ? weightFromStyle(flat.fontWeight) : undefined;
  const resolvedWeight = styleWeight ?? weight ?? variantDefaultWeight[variant];
  const { fontWeight: _dropped, ...restStyle } = flat ?? {};

  return (
    <RNText
      style={[variantStyles[variant], { color: toneColor }, restStyle, fontFor(resolvedWeight)]}
      {...rest}
    />
  );
}

function weightFromStyle(w: TextStyle['fontWeight']): FontWeight {
  const n = typeof w === 'number' ? w : w === 'bold' ? 700 : w === 'normal' ? 400 : Number(w);
  if (!Number.isFinite(n)) return 'regular';
  if (n >= 700) return 'bold';
  if (n >= 600) return 'semibold';
  if (n >= 500) return 'medium';
  return 'regular';
}

const variantDefaultWeight: Record<Variant, FontWeight> = {
  title: 'bold',
  heading: 'bold',
  subheading: 'semibold',
  body: 'regular',
  label: 'medium',
  caption: 'regular',
};

/** The One Place type scale (docs/redesign-one-place/DESIGN.md). */
const variantStyles = StyleSheet.create({
  title: { fontSize: fontSize.xxl, lineHeight: 30 },
  heading: { fontSize: fontSize.xl, lineHeight: 26 },
  subheading: { fontSize: fontSize.lg, lineHeight: 24 },
  body: { fontSize: fontSize.md, lineHeight: 24 },
  label: { fontSize: fontSize.sm, lineHeight: 20 },
  caption: { fontSize: fontSize.xs, lineHeight: 16 },
});
