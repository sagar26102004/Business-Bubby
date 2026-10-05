/**
 * A switchable capability card — the register wizard's "building blocks" and
 * the workspace's modules. Icon tile, title + blurb, a switch on the right, an
 * optional "Active" pill and an "Unlocks:" chip row. An ON card takes a sage
 * border and a solid icon tile so the selection reads at a glance.
 */
import { Pressable, StyleSheet, Switch, View, type ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { type IconName } from './Icon';
import { IconTile } from './IconTile';
import { Tag } from './Tag';
import { Text } from './Text';

export interface ToggleCardProps {
  title: string;
  blurb?: string;
  icon?: IconName;
  emoji?: string;
  value: boolean;
  onChange?: (next: boolean) => void;
  /** Feature chips this switch turns on. */
  unlocks?: string[];
  /** Shown instead of the switch when the card can't be changed here. */
  lockedLabel?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export function ToggleCard({
  title,
  blurb,
  icon,
  emoji,
  value,
  onChange,
  unlocks,
  lockedLabel,
  disabled,
  style,
}: ToggleCardProps) {
  const colors = useColors();
  const toggle = () => {
    if (!disabled && !lockedLabel) onChange?.(!value);
  };
  return (
    <Pressable
      onPress={toggle}
      disabled={disabled || !!lockedLabel || !onChange}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: value ? colors.brand : colors.border,
          borderWidth: value ? 1.5 : 1,
        },
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={styles.top}>
        <IconTile icon={icon} emoji={emoji} solid={value} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="subheading" weight="bold" style={styles.title}>
              {title}
            </Text>
            {value && !lockedLabel ? <Tag label="Active" tone="status" size="sm" /> : null}
          </View>
          {blurb ? (
            <Text variant="label" tone="muted" weight="regular">
              {blurb}
            </Text>
          ) : null}
        </View>
        {lockedLabel ? (
          <Tag label={lockedLabel} tone="soft" size="sm" />
        ) : onChange ? (
          <Switch
            value={value}
            onValueChange={(v) => {
              if (!disabled) onChange(v);
            }}
            disabled={disabled}
            trackColor={{ true: colors.brand, false: colors.border }}
            thumbColor={colors.surface}
            // Native web switch draws its own active thumb tint otherwise.
            {...({ activeThumbColor: colors.surface } as object)}
          />
        ) : null}
      </View>
      {unlocks && unlocks.length > 0 ? (
        <View style={[styles.unlocks, { borderTopColor: colors.border }]}>
          <Text variant="caption" tone="muted">
            Unlocks:
          </Text>
          {unlocks.map((u) => (
            <Tag key={u} label={value ? `✓ ${u}` : u} tone={value ? 'soft' : 'default'} size="sm" />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  title: { flexShrink: 1 },
  unlocks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
