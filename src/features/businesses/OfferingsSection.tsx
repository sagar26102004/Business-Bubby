/**
 * "What we offer" — the heart of the business page. Everything the business
 * provides lives here in up to three (or four) parallel blocks: the menu, the
 * services, what's for rent, and any products. A business only ever shows the
 * blocks it actually has.
 *
 * Each block leads with its CATEGORIES as chips — Desserts, Beverages,
 * Repairs, Cars — because that's how a customer scans an offering. Picking a
 * chip lists that category's items right there; long categories cut off with a
 * "see all" that hands over to the full screen (the menu, for one, is its own
 * ordering flow).
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** Normalised offering row — menu items, services, rentals and products all map to this. */
export interface CatalogEntry {
  name: string;
  price?: string;
  description?: string;
  /** Section, e.g. "Starters" or "Cars". Uncategorised entries collect at the end. */
  category?: string;
  /** Group inside the category, e.g. "Veg" / "Non-veg". */
  subcategory?: string;
}

/** Items listed inline before the block defers to its full screen. */
const PREVIEW_LIMIT = 6;
/** Bucket for entries that never got filed under a category. */
const OTHER = 'Everything else';

export interface OfferingGroup {
  key: string;
  icon: string;
  title: string;
  /** Line under the title, e.g. "12 dishes · per day". */
  subtitle?: string;
  entries: CatalogEntry[];
  /** Link out to the block's own screen (the menu, the stall…). */
  seeAll?: { label: string; onPress: () => void };
}

export function OfferingsSection({ groups }: { groups: OfferingGroup[] }) {
  const visible = groups.filter((g) => g.entries.length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={styles.section}>
      {visible.map((group) => (
        <OfferingBlock key={group.key} group={group} />
      ))}
    </View>
  );
}

function OfferingBlock({ group }: { group: OfferingGroup }) {
  const colors = useColors();

  // Categories keep the order they first appear in the data; uncategorised
  // items collect in one bucket at the end so nothing goes missing.
  const categories = useMemo(() => {
    const byName = new Map<string, CatalogEntry[]>();
    for (const entry of group.entries) {
      const name = entry.category?.trim() || OTHER;
      const list = byName.get(name);
      if (list) list.push(entry);
      else byName.set(name, [entry]);
    }
    const all = Array.from(byName, ([name, entries]) => ({ name, entries }));
    // "Everything else" is a fallback, not a real category — it goes last.
    return [...all.filter((c) => c.name !== OTHER), ...all.filter((c) => c.name === OTHER)];
  }, [group.entries]);

  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const current = categories[Math.min(active, categories.length - 1)];
  const shown = expanded ? current.entries : current.entries.slice(0, PREVIEW_LIMIT);
  const hidden = current.entries.length - shown.length;
  // A single unnamed bucket means the block has no real categories to show.
  const showChips = categories.length > 1 || categories[0].name !== OTHER;

  return (
    <Card style={styles.block}>
      <View style={styles.head}>
        <Text style={styles.headIcon}>{group.icon}</Text>
        <View style={styles.headInfo}>
          <Text variant="subheading" weight="bold">
            {group.title}
          </Text>
          {group.subtitle ? (
            <Text variant="caption" tone="muted">
              {group.subtitle}
            </Text>
          ) : null}
        </View>
        {group.seeAll ? (
          <Pressable onPress={group.seeAll.onPress} hitSlop={8} accessibilityRole="button">
            <Text variant="label" weight="semibold" tone="accent">
              {group.seeAll.label} ›
            </Text>
          </Pressable>
        ) : null}
      </View>

      {showChips ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {categories.map((cat, i) => {
            const on = i === active;
            return (
              <Pressable
                key={cat.name}
                onPress={() => {
                  setActive(i);
                  setExpanded(false);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? colors.brand : colors.surfaceAlt,
                    borderColor: on ? colors.brand : colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text variant="label" weight="semibold" tone={on ? 'inverse' : 'default'}>
                  {cat.name}
                </Text>
                <Text variant="caption" tone={on ? 'inverse' : 'muted'}>
                  {cat.entries.length}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.list}>
        {shown.map((entry, i) => (
          <View
            key={`${entry.name}-${i}`}
            style={[
              styles.row,
              i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <View style={styles.rowInfo}>
              <Text weight="medium">{entry.name}</Text>
              {entry.subcategory ? (
                <Text variant="caption" tone="muted">
                  {entry.subcategory}
                </Text>
              ) : null}
              {entry.description ? (
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {entry.description}
                </Text>
              ) : null}
            </View>
            {entry.price ? (
              <Text weight="semibold" tone="brand">
                {entry.price}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {hidden > 0 ? (
        <Pressable
          onPress={() => (group.seeAll ? group.seeAll.onPress() : setExpanded(true))}
          style={styles.more}
          accessibilityRole="button"
        >
          <Text variant="label" weight="semibold" tone="accent">
            + {hidden} more in {current.name.toLowerCase()}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  block: { paddingVertical: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headIcon: { fontSize: 22 },
  headInfo: { flex: 1 },
  chips: { gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  list: { marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowInfo: { flex: 1 },
  more: { paddingTop: spacing.sm },
});
