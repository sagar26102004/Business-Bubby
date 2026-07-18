/**
 * Collapsible, categorised list for the business page — the shared engine
 * behind the menu, the products list and the services list. The whole list
 * hides behind a "View …" bar; inside, items group into category dropdowns
 * (Starters / Main Course, or a stall's Electronics / Vehicles…) with optional
 * subcategory dropdowns (Veg / Non-veg). Categories keep the order they first
 * appear in the data, and uncategorised items list right at the top.
 *
 * Longer lists also get a search box: typing filters the whole catalog to a
 * flat list of matches (name, description or category), so a customer can find
 * "paneer" or "oil change" without opening every dropdown.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** Above this many items, the list gets its own search box. */
const SEARCH_THRESHOLD = 4;

/** Normalised catalog row — menu items, products and services all map to this. */
export interface CatalogEntry {
  name: string;
  price?: string;
  description?: string;
  /** Section, e.g. "Starters" or "Electronics". Uncategorised entries list first. */
  category?: string;
  /** Optional group inside the category, e.g. "Veg" / "Non-veg". */
  subcategory?: string;
}

interface SubGroup {
  name: string;
  items: CatalogEntry[];
}

interface CategoryGroup {
  name: string;
  /** Items in the category without a subcategory. */
  direct: CatalogEntry[];
  subs: SubGroup[];
}

function groupEntries(items: CatalogEntry[]): { ungrouped: CatalogEntry[]; groups: CategoryGroup[] } {
  const ungrouped: CatalogEntry[] = [];
  const groups: CategoryGroup[] = [];
  const byName = new Map<string, CategoryGroup>();
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

const countOf = (g: CategoryGroup) =>
  g.direct.length + g.subs.reduce((n, s) => n + s.items.length, 0);

/** Match on name, description, category or subcategory — all case-insensitive. */
function matchesQuery(item: CatalogEntry, q: string): boolean {
  return (
    item.name.toLowerCase().includes(q) ||
    (item.description?.toLowerCase().includes(q) ?? false) ||
    (item.category?.toLowerCase().includes(q) ?? false) ||
    (item.subcategory?.toLowerCase().includes(q) ?? false)
  );
}

/** The category path shown under a search result, e.g. "Starters · Veg". */
function contextOf(item: CatalogEntry): string | undefined {
  return [item.category, item.subcategory].filter(Boolean).join(' · ') || undefined;
}

interface CatalogAccordionProps {
  items: CatalogEntry[];
  /** Word after "View" / "Hide" and the count, e.g. "menu", "products". */
  label: string;
  /** Bar icon, e.g. "📖" for a menu. */
  icon?: string;
}

export function CatalogAccordion({ items, label, icon = '📖' }: CatalogAccordionProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

  const { ungrouped, groups } = useMemo(() => groupEntries(items), [items]);

  const showSearch = items.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const results = useMemo(
    () => (searching ? items.filter((item) => matchesQuery(item, q)) : []),
    [items, searching, q],
  );
  // Typing opens the list; a query always shows results even if "closed".
  const expanded = open || searching;

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

  return (
    <Card style={styles.card}>
      {/* The whole list opens only on demand */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.menuBar}
        accessibilityRole="button"
        accessibilityLabel={expanded ? `Hide ${label}` : `View ${label}`}
      >
        <Text weight="semibold">
          {icon} {expanded ? `Hide ${label}` : `View ${label}`}
        </Text>
        <Text variant="caption" tone="muted">
          {items.length} {items.length === 1 ? 'item' : 'items'} {expanded ? '▲' : '▼'}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {showSearch ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`🔍  Search ${label}`}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.search,
                { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
              autoCorrect={false}
              returnKeyType="search"
            />
          ) : null}

          {searching ? (
            results.length > 0 ? (
              results.map((item, i) => (
                <ItemRow key={`${item.name}-${i}`} item={item} context={contextOf(item)} />
              ))
            ) : (
              <Text variant="caption" tone="muted" style={styles.noMatch}>
                No {label} match “{query.trim()}”.
              </Text>
            )
          ) : (
            <>
              {ungrouped.map((item, i) => (
                <ItemRow key={`${item.name}-${i}`} item={item} />
              ))}

              {groups.map((group) => {
                const catOpen = openCats.has(group.name);
                return (
                  <View
                    key={group.name}
                    style={[styles.catBlock, { borderTopColor: colors.border }]}
                  >
                    <Pressable
                      onPress={() => toggleCat(group.name)}
                      style={styles.catRow}
                      accessibilityRole="button"
                      accessibilityLabel={`${group.name}, ${countOf(group)} items`}
                    >
                      <Text weight="semibold">{group.name}</Text>
                      <Text variant="caption" tone="muted">
                        {countOf(group)} · {catOpen ? '▲' : '▼'}
                      </Text>
                    </Pressable>

                    {catOpen ? (
                      <View style={styles.catBody}>
                        {group.direct.map((item, i) => (
                          <ItemRow key={`${item.name}-${i}`} item={item} />
                        ))}
                        {group.subs.map((sub) => {
                          const subKey = `${group.name}|${sub.name}`;
                          const subOpen = openSubs.has(subKey);
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
                                <Text variant="caption" tone="muted">
                                  {sub.items.length} · {subOpen ? '▲' : '▼'}
                                </Text>
                              </Pressable>
                              {subOpen
                                ? sub.items.map((item, i) => (
                                    <ItemRow key={`${item.name}-${i}`} item={item} indent />
                                  ))
                                : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function ItemRow({
  item,
  indent,
  context,
}: {
  item: CatalogEntry;
  indent?: boolean;
  /** Category path shown under the name in search results, e.g. "Starters · Veg". */
  context?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.itemRow,
        indent && styles.itemIndent,
        { borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.itemInfo}>
        <Text weight="medium">{item.name}</Text>
        {context ? (
          <Text variant="caption" tone="brand">
            {context}
          </Text>
        ) : null}
        {item.description ? (
          <Text variant="caption" tone="muted">
            {item.description}
          </Text>
        ) : null}
      </View>
      {item.price ? (
        <Text weight="semibold" tone="brand">
          {item.price}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 0 },
  menuBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  body: { borderTopWidth: StyleSheet.hairlineWidth },
  search: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  noMatch: { paddingVertical: spacing.md },
  catBlock: { borderTopWidth: StyleSheet.hairlineWidth },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemIndent: { paddingLeft: spacing.md },
  itemInfo: { flex: 1 },
});
