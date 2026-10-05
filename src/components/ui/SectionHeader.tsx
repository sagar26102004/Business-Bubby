/**
 * A section heading in the redesign's rhythm: optional icon/emoji, a bold
 * title, an optional muted subtitle, a count pill, and a trailing action
 * ("View all ›", "＋ New offering"). Sections separate by 24px above.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { spacing, useColors } from '@/theme/theme';
import { Icon, type IconName } from './Icon';
import { Tag } from './Tag';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  emoji?: string;
  icon?: IconName;
  /** A pill beside the title — "2 Active Offers", "3 Urgent". */
  badge?: string;
  badgeTone?: 'soft' | 'status' | 'cta' | 'warning' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
  /** Anything custom on the right instead of the text action. */
  right?: ReactNode;
  style?: ViewStyle;
}

export function SectionHeader({
  title,
  subtitle,
  emoji,
  icon,
  badge,
  badgeTone = 'soft',
  actionLabel,
  onAction,
  right,
  style,
}: SectionHeaderProps) {
  const colors = useColors();
  return (
    <View style={[styles.row, style]}>
      <View style={styles.main}>
        <View style={styles.titleRow}>
          {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
          {icon ? <Icon name={icon} size={20} color={colors.brand} /> : null}
          <Text variant="heading" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {badge ? <Tag label={badge} tone={badgeTone} size="sm" /> : null}
        </View>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ??
        (actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button" style={styles.action}>
            <Text variant="label" weight="bold" tone="brand">
              {actionLabel}
            </Text>
            <Icon name="chevronRight" size={16} color={colors.brandText} />
          </Pressable>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  main: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  emoji: { fontSize: 20, lineHeight: 26 },
  title: { flexShrink: 1 },
  subtitle: { marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
