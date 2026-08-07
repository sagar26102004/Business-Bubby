/**
 * The shared "pick what you want" list — one component so a customer placing an
 * order and a member building a bill see EXACTLY the same catalog: collapsible
 * category → subcategory groups (from the free-text menu grouping), a quantity
 * stepper per item, picked counts kept visible on collapsed bars, and an
 * optional bargain-price input for personal stalls.
 *
 * Used by app/order/new/[businessId].tsx and app/bill/new/[businessId].tsx.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { OfferingKind } from '@/domain/types';
import { Card, Input, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface Offering {
  kind: OfferingKind;
  name: string;
  price?: string;
  description?: string;
  /** Free-text menu grouping ("Starters" → "Veg"), copied from MenuItem. */
  category?: string;
  subcategory?: string;
}

/** Stable identity for an offering inside the quantity/offer maps. */
export const keyOf = (o: Offering) => `${o.kind}:${o.name}`;

interface OfferingSubGroup {
  name: string;
  items: Offering[];
}

interface OfferingCategory {
  name: string;
  /** Items in the category without a subcategory. */
  direct: Offering[];
  subs: OfferingSubGroup[];
}

/**
 * Categories keep the order they first appear in the data; uncategorised items
 * list first.
 */
function groupOfferings(items: Offering[]): { ungrouped: Offering[]; groups: OfferingCategory[] } {
  const ungrouped: Offering[] = [];
  const groups: OfferingCategory[] = [];
  const byName = new Map<string, OfferingCategory>();
  for (const item of items) {
    if (!item.category) {
      ungrouped.push(item);
      continue;
    }
    let group = byName.get(item.category);
    if (!group) {
      group = { name: item.category, direct: [], subs: [] };
      byName.set(item.category, group);
      groups.push(group);
    }
    if (!item.subcategory) {
      group.direct.push(item);
      continue;
    }
    let sub = group.subs.find((s) => s.name === item.subcategory);
    if (!sub) {
      sub = { name: item.subcategory, items: [] };
      group.subs.push(sub);
    }
    sub.items.push(item);
  }
  return { ungrouped, groups };
}

const countOf = (g: OfferingCategory) =>
  g.direct.length + g.subs.reduce((n, s) => n + s.items.length, 0);

export function OfferingGroup({
  title,
  offerings,
  quantities,
  onBump,
  offers,
  onOffer,
}: {
  title: string;
  offerings: Offering[];
  quantities: Record<string, number>;
  onBump: (o: Offering, delta: number) => void;
  /** When set (personal stalls), picked items show a "your offer" bargain input. */
  offers?: Record<string, string>;
  onOffer?: (o: Offering, value: string) => void;
}) {
  const colors = useColors();
  const { ungrouped, groups } = useMemo(() => groupOfferings(offerings), [offerings]);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

  const toggleCat = (name: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const toggleSub = (key: string) =>
    setOpenSubs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // How many units are picked inside a set of items — shown on collapsed
  // category/subcategory bars so selections never disappear from view.
  const pickedIn = (items: Offering[]) => items.reduce((n, o) => n + (quantities[keyOf(o)] ?? 0), 0);

  const renderRow = (o: Offering, divider: boolean, indent?: boolean) => (
    <OfferingRow
      key={keyOf(o)}
      offering={o}
      qty={quantities[keyOf(o)] ?? 0}
      onBump={onBump}
      offerValue={offers?.[keyOf(o)]}
      onOffer={onOffer}
      divider={divider}
      indent={indent}
    />
  );

  return (
    <View style={styles.group}>
      <Text variant="subheading" weight="bold" style={styles.groupTitle}>
        {title}
      </Text>
      <Card>
        {ungrouped.map((o, i) => renderRow(o, i < ungrouped.length - 1 || groups.length > 0))}

        {groups.map((group) => {
          const catOpen = openCats.has(group.name);
          const catPicked = pickedIn([...group.direct, ...group.subs.flatMap((s) => s.items)]);
          return (
            <View key={group.name} style={[styles.catBlock, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={() => toggleCat(group.name)}
                style={styles.catRow}
                accessibilityRole="button"
                accessibilityLabel={`${group.name}, ${countOf(group)} items`}
              >
                <Text weight="semibold">{group.name}</Text>
                <View style={styles.catMeta}>
                  {catPicked > 0 ? (
                    <Text variant="caption" weight="bold" tone="brand">
                      {catPicked} ✓
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="muted">
                    {countOf(group)} · {catOpen ? '▲' : '▼'}
                  </Text>
                </View>
              </Pressable>

              {catOpen ? (
                <View style={styles.catBody}>
                  {group.direct.map((o) => renderRow(o, true))}
                  {group.subs.map((sub) => {
                    const subKey = `${group.name}|${sub.name}`;
                    const subOpen = openSubs.has(subKey);
                    const subPicked = pickedIn(sub.items);
                    return (
                      <View key={subKey}>
                        <Pressable
                          onPress={() => toggleSub(subKey)}
                          style={[styles.subRow, { backgroundColor: colors.surfaceAlt }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${sub.name}, ${sub.items.length} items`}
                        >
                          <Text variant="label" weight="semibold">
                            {sub.name}
                          </Text>
                          <View style={styles.catMeta}>
                            {subPicked > 0 ? (
                              <Text variant="caption" weight="bold" tone="brand">
                                {subPicked} ✓
                              </Text>
                            ) : null}
                            <Text variant="caption" tone="muted">
                              {sub.items.length} · {subOpen ? '▲' : '▼'}
                            </Text>
                          </View>
                        </Pressable>
                        {subOpen ? sub.items.map((o) => renderRow(o, true, true)) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function OfferingRow({
  offering: o,
  qty,
  onBump,
  offerValue,
  onOffer,
  divider,
  indent,
}: {
  offering: Offering;
  qty: number;
  onBump: (o: Offering, delta: number) => void;
  offerValue?: string;
  onOffer?: (o: Offering, value: string) => void;
  divider: boolean;
  indent?: boolean;
}) {
  const colors = useColors();
  const bargaining = !!onOffer && qty > 0;
  return (
    <View
      style={[
        indent && styles.itemIndent,
        divider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.rowInfo}>
          <Text weight="medium">{o.name}</Text>
          {o.description ? (
            <Text variant="caption" tone="muted">
              {o.description}
            </Text>
          ) : null}
          <Text variant="caption" weight="semibold" tone="brand">
            {o.price ?? 'Price on request'}
          </Text>
        </View>
        <View style={styles.stepper}>
          <StepBtn label="−" disabled={qty === 0} onPress={() => onBump(o, -1)} />
          <Text weight="semibold" style={styles.qty}>
            {qty}
          </Text>
          <StepBtn label="+" onPress={() => onBump(o, 1)} />
        </View>
      </View>
      {bargaining ? (
        <Input
          label="💰 Your offer (optional)"
          placeholder={o.price ? `Listed at ${o.price} — name your price` : 'Name your price'}
          value={offerValue ?? ''}
          onChangeText={(v) => onOffer(o, v)}
          style={styles.offerInput}
        />
      ) : null}
    </View>
  );
}

export function StepBtn({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.stepBtn,
        {
          backgroundColor: disabled ? colors.surfaceAlt : colors.brand,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Add one' : 'Remove one'}
    >
      <Text weight="bold" tone={disabled ? 'muted' : 'inverse'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.lg },
  groupTitle: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowInfo: { flex: 1, gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { minWidth: 22, textAlign: 'center' },
  catBlock: { borderTopWidth: StyleSheet.hairlineWidth },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  catMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catBody: { paddingBottom: spacing.sm },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  itemIndent: { paddingLeft: spacing.md },
  offerInput: { marginBottom: spacing.md },
});
