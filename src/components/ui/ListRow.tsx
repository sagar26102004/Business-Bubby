/**
 * ListRow — one tappable line in a settings-style list: icon, label, an
 * optional value or hint on the right, and a chevron.
 *
 * The account area is a stack of these, and they are what makes a settings
 * screen read as a settings screen rather than a pile of buttons. Rows group
 * into a `ListGroup`, which draws the shared surface and the hairlines between
 * them so a group looks like one card instead of several.
 */
import { Children, cloneElement, isValidElement } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, spacing, useColors } from '@/theme/theme';

export interface ListRowProps {
  icon?: IconName;
  label: string;
  /** Second line under the label — what the row is for, or its current value. */
  sub?: string;
  /** Right-hand text, e.g. the value the row would edit ("Not added"). */
  value?: string;
  onPress?: () => void;
  /** Render in the danger colour (Delete account). */
  danger?: boolean;
  /** Replaces the chevron — used for a Switch. */
  accessory?: React.ReactNode;
  /** Drawn by ListGroup between rows; standalone rows don't need it. */
  divider?: boolean;
}

export function ListRow({
  icon,
  label,
  sub,
  value,
  onPress,
  danger,
  accessory,
  divider,
}: ListRowProps) {
  const colors = useColors();
  const tint = danger ? colors.danger : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
        pressed && onPress ? { backgroundColor: colors.surfaceAlt } : null,
      ]}
    >
      {icon ? (
        <View style={[styles.iconBox, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={18} color={tint} />
        </View>
      ) : null}

      <View style={styles.labels}>
        <Text weight="medium" style={{ color: tint }}>
          {label}
        </Text>
        {sub ? (
          <Text variant="caption" tone="muted" style={styles.sub}>
            {sub}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}

      {accessory ?? (onPress ? <Icon name="chevronRight" size={16} color={colors.textMuted} /> : null)}
    </Pressable>
  );
}

export interface ListGroupProps {
  /** Small uppercase caption above the group. */
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A card of `ListRow`s, hairline-separated.
 *
 * The separators are injected here rather than passed by every caller, so a row
 * conditionally rendered out (`{isAdmin ? <ListRow …/> : null}`) can never leave
 * a stray line behind or a doubled one — `Children.toArray` drops the nulls
 * before the index that decides the hairline is taken.
 */
export function ListGroup({ title, children, style }: ListGroupProps) {
  const colors = useColors();
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={style}>
      {title ? (
        <Text variant="caption" weight="bold" tone="muted" style={styles.groupTitle}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {rows.map((child, i) =>
          // The first row never gets a top hairline; the rest always do.
          cloneElement(child as React.ReactElement<ListRowProps>, { divider: i > 0 }),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  iconBox: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1 },
  sub: { marginTop: 2 },
  value: { maxWidth: '45%', textAlign: 'right' },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  groupTitle: { marginBottom: spacing.xs, marginLeft: spacing.xs, letterSpacing: 0.6 },
});
