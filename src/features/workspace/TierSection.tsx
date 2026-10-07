/**
 * The team's tiers — Managers, Staff, Drivers — and the collapsible section
 * each one renders as. Shared by Workspace › Team and Workspace › Access so
 * both screens group people the same way.
 */
import type { ReactNode } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import type { Employee } from '@/domain/types';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export type TierId = 'managers' | 'staff' | 'drivers';

export const TIER_TITLES: Record<TierId, string> = {
  managers: 'Managers',
  staff: 'Staff',
  drivers: 'Drivers',
};

/**
 * Sort each employee into exactly one tier. Managers stay managers even if
 * they drive; among the rest, vehicle drivers split out from plain staff.
 */
export function splitTiers(employees: Employee[], driverIds: Set<string>): Record<TierId, Employee[]> {
  const managers = employees.filter((e) => (e.level ?? 'staff') === 'manager');
  const nonManagers = employees.filter((e) => (e.level ?? 'staff') !== 'manager');
  return {
    managers,
    staff: nonManagers.filter((e) => !driverIds.has(e.id)),
    drivers: nonManagers.filter((e) => driverIds.has(e.id)),
  };
}

/** Call before flipping a section's open state so it animates. */
export const animateToggle = () =>
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

export function TierSection({
  title,
  count,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** A control at the header's right end — kept OUTSIDE the pressable header. */
  right?: ReactNode;
  children: ReactNode;
}) {
  const colors = useColors();
  if (count === 0) return null;
  return (
    <View style={styles.section}>
      <View style={[styles.header, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Pressable
          onPress={onToggle}
          style={styles.headerPress}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${count}`}
        >
          <Text tone="muted" style={styles.chevron}>
            {open ? '▾' : '▸'}
          </Text>
          <Text weight="semibold" style={styles.flex}>
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {count}
          </Text>
        </Pressable>
        {right}
      </View>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginBottom: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  chevron: { width: 16, textAlign: 'center' },
  body: { marginTop: spacing.sm },
});
