/**
 * "What we offer" — the heart of the business page. Everything the business
 * provides lives here in up to three (or four) parallel blocks: the menu, the
 * services, what's for rent, and any products. A business only ever shows the
 * blocks it actually has.
 *
 * Every block looks and behaves IDENTICALLY, because a menu, a product list, a
 * service list and a rental list are the same kind of thing (see
 * `domain/offerings.ts`) and a customer should not have to learn two ways of
 * reading one. A block presents its CATEGORIES — Desserts, Beverages, Repairs,
 * Cars — as collapsible sections, exactly like the catalog screen's: tap a
 * heading to fold it open or shut, and the nested folders inside it fold the
 * same way one level down.
 *
 * A long category cuts off with a "+ N more" that expands it, or hands over to
 * the block's own full-catalog screen when it has one.
 *
 * Every block also ends with ITS OWN action button — Order the menu, Buy the
 * products, Request a service, Enroll in a plan. The blocks look identical on
 * purpose; the button is the one place they differ, so a customer reading a
 * page never has to work out how to take the thing they are looking at. (The
 * "Full menu ›" link at the top stays: it is the same destination, found by
 * people who scan headings rather than scroll to the end.)
 */
import { createContext, useContext, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CatalogItem } from '@/domain/offerings';
import { Button, Card, Icon, Text } from '@/components/ui';
import { useCart } from '@/features/orders/CartContext';
import { radius, spacing, useColors } from '@/theme/theme';

/**
 * One Place redesign: a row whose entry carries its `item` can be picked
 * straight from the page — "+ Add" turns into a −/n/+ stepper on the SAME cart
 * the full catalog screen uses (CartContext), and the page's order bar takes it
 * from there. Plans never enter a cart; their rows carry an Enroll pill.
 */
const PickContext = createContext<{
  businessId?: string;
  addable: boolean;
  onEnroll?: (item: CatalogItem) => void;
}>({ addable: false });

/** Normalised offering row — menu items, services, rentals and products all map to this. */
export interface CatalogEntry {
  name: string;
  price?: string;
  description?: string;
  /** Section, e.g. "Starters" or "Cars". Uncategorised entries collect at the end. */
  category?: string;
  /** One line under the name — a product's specs, "1.5 Ton · Split". */
  subcategory?: string;
  /** Thumbnail. Falls back to the group's icon when the business added no photo. */
  imageUrl?: string;
  /**
   * Where this sits INSIDE its category, as folder segments:
   * `["Flat", "2 BHK"]`. Given one, the category nests — Flats & rooms opens
   * onto Flat and Room, Flat opens onto 1 BHK, 2 BHK — instead of piling every
   * flat, room and PG bed into one list. Leave it off and the category lists
   * its entries flat.
   */
  path?: string[];
  /**
   * A small tag beside the price — "per day", "per month". A price with no
   * period is a price nobody can compare, and on one page a flat is monthly
   * while the scooter is daily.
   */
  badge?: string;
  /** The catalog item behind this row — lets the row be picked into the cart. */
  item?: CatalogItem;
}

/** Items listed inline before the block defers to its full screen. */
const PREVIEW_LIMIT = 6;
/** Bucket for entries that never got filed under a category. */
const OTHER = 'Everything else';

export interface OfferingGroup {
  key: string;
  title: string;
  /** Line under the title, e.g. "12 dishes · per day". */
  subtitle?: string;
  entries: CatalogEntry[];
  /** Emoji stand-in on rows whose item has no photo. */
  icon?: string;
  /** Link out to the block's own full-catalog screen. */
  seeAll?: { label: string; onPress: () => void };
  /**
   * How a customer takes what's in this block — "🛒 Order", "🛍️ Buy",
   * "🛠️ Request", "🎟️ Enroll". Shown as a button at the foot of the block.
   */
  action?: { label: string; onPress: () => void };
  /** Rows can be added to the cart right here (orders module on, not plans). */
  addable?: boolean;
  /** Plans: each row's Enroll pill. */
  onEnroll?: (item: CatalogItem) => void;
}

export function OfferingsSection({
  groups,
  businessId,
  onLayoutGroup,
}: {
  groups: OfferingGroup[];
  /** Needed for the inline add-to-cart steppers. */
  businessId?: string;
  /** Reports each block's y offset inside this section — for the page's tab strip. */
  onLayoutGroup?: (key: string, y: number) => void;
}) {
  const visible = groups.filter((g) => g.entries.length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={styles.section}>
      {visible.map((group) => (
        <View
          key={group.key}
          onLayout={
            onLayoutGroup ? (e) => onLayoutGroup(group.key, e.nativeEvent.layout.y) : undefined
          }
        >
          <PickContext.Provider
            value={{
              businessId,
              addable: !!group.addable && !!businessId,
              onEnroll: group.onEnroll,
            }}
          >
            <OfferingBlock group={group} />
          </PickContext.Provider>
        </View>
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

  // The first category starts open so the block never reads as empty; the rest
  // are folded.
  const [openCats, setOpenCats] = useState<Set<string>>(
    () => new Set(categories.length > 0 ? [categories[0].name] : []),
  );
  const toggleCat = (name: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const icon = group.icon;
  // A single unnamed bucket means the block has no real categories — nothing to
  // fold, so it just lists what it has.
  const hasCategories = categories.length > 1 || categories[0].name !== OTHER;

  const head = (
    <View style={styles.head}>
      {icon ? (
        <View style={[styles.headIcon, { backgroundColor: colors.brandSoft }]}>
          <Text style={styles.headEmoji}>{icon}</Text>
        </View>
      ) : null}
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
        <Pressable
          onPress={group.seeAll.onPress}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.seeAll}
        >
          <Text variant="label" weight="bold" tone="brand">
            {group.seeAll.label}
          </Text>
          <Icon name="chevronRight" size={16} color={colors.brandText} />
        </Pressable>
      ) : null}
    </View>
  );

  // The way in, at the end of what it applies to.
  const foot = group.action ? (
    <Button title={group.action.label} onPress={group.action.onPress} style={styles.action} />
  ) : null;

  // No categories worth folding — one flat list, still cut off at the preview
  // limit so a hundred items can't swallow the page.
  if (!hasCategories) {
    return (
      <Card style={styles.block}>
        {head}
        <FolderContents
          entries={categories[0].entries}
          depth={0}
          label={group.title}
          icon={icon}
          seeAll={group.seeAll}
        />
        {foot}
      </Card>
    );
  }

  return (
    <Card style={styles.block}>
      {head}
      <View style={styles.dropdowns}>
        {categories.map((cat) => {
          const open = openCats.has(cat.name);
          return (
            <View key={cat.name}>
              <Pressable
                onPress={() => toggleCat(cat.name)}
                style={[styles.dropdownHead, { borderTopColor: colors.border }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${cat.name}, ${cat.entries.length} items`}
              >
                <Text weight="bold">
                  {cat.name}{' '}
                  <Text tone="muted" weight="medium">
                    ({cat.entries.length})
                  </Text>
                </Text>
                <View style={open ? styles.chevOpen : undefined}>
                  <Icon name="chevronDown" size={18} color={colors.textMuted} />
                </View>
              </Pressable>
              {open ? (
                <FolderContents
                  entries={cat.entries}
                  depth={0}
                  label={cat.name}
                  icon={icon}
                  seeAll={group.seeAll}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      {foot}
    </Card>
  );
}

/** One level of a category: its own rows, then the folders inside it. */
function FolderContents({
  entries,
  depth,
  label,
  icon,
  seeAll,
}: {
  entries: CatalogEntry[];
  depth: number;
  label: string;
  icon?: string;
  seeAll?: { label: string; onPress: () => void };
}) {
  const [expanded, setExpanded] = useState(false);

  // Split what sits HERE from what belongs in a folder one level down. Folders
  // keep the order they first appear in, so the library's order survives.
  const { here, folders } = useMemo(() => {
    const direct: CatalogEntry[] = [];
    const byName = new Map<string, CatalogEntry[]>();
    for (const entry of entries) {
      const segment = entry.path?.[depth];
      if (!segment) {
        direct.push(entry);
        continue;
      }
      const list = byName.get(segment);
      if (list) list.push(entry);
      else byName.set(segment, [entry]);
    }
    return {
      here: direct,
      folders: Array.from(byName, ([name, items]) => ({ name, items })),
    };
  }, [entries, depth]);

  const rows = expanded ? here : here.slice(0, PREVIEW_LIMIT);
  const rest = here.length - rows.length;

  return (
    <>
      <EntryRows entries={rows} icon={icon} />
      {rest > 0 ? (
        <Pressable
          onPress={() => (seeAll ? seeAll.onPress() : setExpanded(true))}
          style={styles.more}
          accessibilityRole="button"
        >
          <Text variant="label" weight="semibold" tone="accent">
            + {rest} more in {label.toLowerCase()}
          </Text>
        </Pressable>
      ) : null}
      {folders.map((folder) => (
        <SubFolder
          key={folder.name}
          name={folder.name}
          entries={folder.items}
          depth={depth + 1}
          icon={icon}
          seeAll={seeAll}
        />
      ))}
    </>
  );
}

/**
 * A folder inside a category — "Flat", then "2 BHK" inside that. Folded shut
 * until tapped, and indented one step per level so the nesting is legible
 * rather than guessed at.
 */
function SubFolder({
  name,
  entries,
  depth,
  icon,
  seeAll,
}: {
  name: string;
  entries: CatalogEntry[];
  depth: number;
  icon?: string;
  seeAll?: { label: string; onPress: () => void };
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  // Indent by level, but stop growing after a few — deep folders shouldn't
  // squeeze their own rows off the side of a phone.
  const indent = spacing.md * Math.min(depth, 3);

  return (
    <View style={{ paddingLeft: indent }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.subHead, { borderTopColor: colors.border }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${entries.length} items`}
      >
        <Text variant="label" weight="semibold">
          {name}{' '}
          <Text variant="caption" tone="muted">
            ({entries.length})
          </Text>
        </Text>
        <View style={open ? styles.chevOpen : undefined}>
          <Icon name="chevronDown" size={16} color={colors.textMuted} />
        </View>
      </Pressable>
      {open ? (
        <FolderContents entries={entries} depth={depth} label={name} icon={icon} seeAll={seeAll} />
      ) : null}
    </View>
  );
}

/** The item rows themselves — the same row for a dish, a product or a service. */
function EntryRows({ entries, icon }: { entries: CatalogEntry[]; icon?: string }) {
  const colors = useColors();
  return (
    <View style={styles.list}>
      {entries.map((entry, i) => (
        <View
          key={`${entry.name}-${i}`}
          style={[
            styles.row,
            i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
          ]}
        >
          {entry.imageUrl ? (
            <Image source={{ uri: entry.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : icon ? (
            <View style={[styles.thumb, styles.thumbBlank, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={styles.thumbIcon}>{icon}</Text>
            </View>
          ) : null}
          <View style={styles.rowInfo}>
            {typeof entry.item?.isVeg === 'boolean' ? <VegDot veg={entry.item.isVeg} /> : null}
            <Text weight="bold">{entry.name}</Text>
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
          {entry.price || entry.item ? (
            <View style={styles.priceCol}>
              {entry.price ? <Text weight="bold">{entry.price}</Text> : null}
              {entry.badge ? (
                <Text
                  variant="caption"
                  tone="muted"
                  style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}
                >
                  {entry.badge}
                </Text>
              ) : null}
              {entry.item ? <PickControl item={entry.item} /> : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** The small veg / non-veg square every Indian menu prints. */
function VegDot({ veg }: { veg: boolean }) {
  const c = veg ? '#15803D' : '#B91C1C';
  return (
    <View
      style={[styles.veg, { borderColor: c }]}
      accessibilityLabel={veg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <View style={[styles.vegDot, { backgroundColor: c }]} />
    </View>
  );
}

/** "+ Add" → −/n/+ on the shared cart; an Enroll pill for plans. */
function PickControl({ item }: { item: CatalogItem }) {
  const { businessId, addable, onEnroll } = useContext(PickContext);
  if (item.bucket === 'plans') {
    return onEnroll ? (
      <Button title="Enroll" size="sm" variant="outline" onPress={() => onEnroll(item)} />
    ) : null;
  }
  if (!addable || !businessId) return null;
  return <Stepper businessId={businessId} item={item} />;
}

function Stepper({ businessId, item }: { businessId: string; item: CatalogItem }) {
  const colors = useColors();
  const cart = useCart(businessId);
  const qty = cart.quantityOf(item);
  if (qty === 0) {
    return (
      <Button
        title="Add"
        icon="plus"
        size="sm"
        variant="outline"
        onPress={() => cart.bump(item, 1)}
        accessibilityLabel={`Add ${item.name}`}
        style={styles.addBtn}
      />
    );
  }
  return (
    <View style={[styles.stepper, { backgroundColor: colors.brand }]}>
      <Pressable
        onPress={() => cart.bump(item, -1)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${item.name}`}
        style={styles.stepBtn}
      >
        <Icon name="minus" size={16} color={colors.textInverse} />
      </Pressable>
      <Text weight="bold" tone="inverse">
        {qty}
      </Text>
      <Pressable
        onPress={() => cart.bump(item, 1)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Add one more ${item.name}`}
        style={styles.stepBtn}
      >
        <Icon name="plus" size={16} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headEmoji: { fontSize: 20, lineHeight: 26 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  veg: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  addBtn: { minHeight: 34, paddingHorizontal: spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 34,
    paddingHorizontal: 4,
  },
  stepBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  section: { gap: spacing.md },
  block: { paddingVertical: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headInfo: { flex: 1 },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  thumbBlank: { alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 20 },
  dropdowns: { marginTop: spacing.sm },
  subHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  priceCol: { alignItems: 'flex-end', gap: spacing.xs },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  dropdownHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { marginTop: spacing.md },
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
