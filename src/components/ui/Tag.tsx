/**
 * Pill label (docs/redesign-one-place/DESIGN.md → Chips & intent badges).
 *
 * Tones:
 *  - `default` filter chip — white with a stone hairline, charcoal text; goes
 *    solid sage when `selected`.
 *  - `brand`   always solid sage (an active filter that isn't toggleable).
 *  - `soft`    sage-tinted fill, sage text — tags and "Unlocks:" chips.
 *  - `status`  mint fill, forest text — "Open now", "Active", "In stock".
 *  - `cta`     terracotta tint — deal tags ("FLAT 20% OFF").
 *  - `warning` / `danger` — workspace alerts and cancellations.
 *
 * `count` adds a small number bubble ("All 148"); `size="sm"` is the dense
 * caption chip used inside cards.
 */
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type TagTone = 'default' | 'brand' | 'soft' | 'status' | 'cta' | 'warning' | 'danger';

export interface TagProps {
  label: string;
  /** An emoji (string) or a line icon name drawn before the label. */
  icon?: string;
  lineIcon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  tone?: TagTone;
  size?: 'sm' | 'md';
  count?: number;
  /** Status dot before the label (mint/amber/red, matching the tone). */
  dot?: boolean;
  style?: ViewStyle;
}

export function Tag({
  label,
  icon,
  lineIcon,
  selected,
  onPress,
  tone = 'default',
  size = 'md',
  count,
  dot,
  style,
}: TagProps) {
  const colors = useColors();

  const active = selected || tone === 'brand';
  const palette: Record<TagTone, { bg: string; border: string; fg: string }> = {
    default: { bg: colors.surface, border: colors.border, fg: colors.text },
    brand: { bg: colors.brand, border: colors.brand, fg: colors.textInverse },
    soft: { bg: colors.brandSoft, border: colors.brandSoft, fg: colors.brandText },
    status: { bg: colors.successSoft, border: colors.successSoft, fg: colors.successText },
    cta: { bg: colors.ctaSoft, border: colors.ctaSoft, fg: colors.cta },
    warning: { bg: colors.warningSoft, border: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, border: colors.dangerSoft, fg: colors.danger },
  };
  const p = active ? palette.brand : palette[tone];

  const content = (
    <>
      {dot ? <View style={[styles.dot, { backgroundColor: p.fg }]} /> : null}
      {lineIcon ? <Icon name={lineIcon} size={size === 'sm' ? 13 : 15} color={p.fg} /> : null}
      <Text
        variant="caption"
        weight={active || tone !== 'default' ? 'bold' : 'medium'}
        style={[{ color: p.fg }, size === 'md' && styles.mdText]}
        numberOfLines={1}
      >
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
      {count != null ? (
        <View
          style={[
            styles.count,
            { backgroundColor: active ? 'rgba(255,255,255,0.22)' : colors.surfaceAlt },
          ]}
        >
          <Text variant="caption" weight="bold" style={[styles.countText, { color: p.fg }]}>
            {count}
          </Text>
        </View>
      ) : null}
    </>
  );

  const box: ViewStyle[] = [
    styles.pill,
    size === 'sm' ? styles.sm : styles.md,
    { backgroundColor: p.bg, borderColor: p.border },
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected }}
        style={({ pressed }) => [...box, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[...box, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  md: { paddingHorizontal: 14, paddingVertical: 7 },
  sm: { paddingHorizontal: 10, paddingVertical: 3 },
  mdText: { fontSize: 13 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: { borderRadius: radius.pill, paddingHorizontal: 6, minWidth: 20, alignItems: 'center' },
  countText: { fontSize: 11, lineHeight: 15 },
  pressed: { opacity: 0.7 },
});
