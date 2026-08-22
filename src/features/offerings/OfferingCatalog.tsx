/**
 * The full catalog of ONE of a business's offering lists — its menu, its
 * products, its services or what it rents out — shown the way a food app shows
 * a menu, because all four are the same kind of thing and there is no reason a
 * customer should have to learn two ways of reading a price list.
 *
 * So every bucket gets exactly this: sections you can collapse, the nested
 * folders inside them ("Repairs › Washing machine › Front load") folded shut
 * until tapped, one card per item (photo with an ADD button on the right;
 * name, price and description on the left), and a sticky bar at the bottom so
 * "Place order" is always one tap away — never a scroll to the end of a long
 * list.
 *
 * Picks go into the shared cart (features/orders/CartContext), so they survive
 * the trip to /cart/[businessId] and back via its "Add" button. A cart line
 * remembers which bucket it came from, so the cart knows where "Add" returns to
 * and whether the line orders as a product or a service.
 *
 * Both routes are thin wrappers over this: app/menu/[businessId] (the menu
 * keeps its own readable URL, and everything links to it) and
 * app/catalog/[businessId] for the other three.
 */
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  offeringBucket,
  type CatalogItem,
  type OfferingBucket,
  type OfferingBucketView,
} from '@/domain/offerings';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { EmptyView, ErrorView, LoadingView, Text } from '@/components/ui';
import { VegDot } from '@/features/businesses/FoodMenuEditor';
import { useCart } from '@/features/orders/CartContext';
import { totalLabel, totalOf } from '@/features/orders/orderUtils';
import { radius, spacing, useColors } from '@/theme/theme';

/**
 * One node of the catalog tree: a category (top level) or a nested folder
 * inside it. `items` are filed directly at this node; `children` are its
 * folders, which nest to any depth.
 */
interface CatalogNode {
  key: string;
  name: string;
  items: CatalogItem[];
  children: CatalogNode[];
}

const nodeCount = (n: CatalogNode): number =>
  n.items.length + n.children.reduce((sum, c) => sum + nodeCount(c), 0);

/**
 * Build the tree: top level is the categories (already in their library's
 * canonical order — `domain/offerings.ts` sorts them; uncategorised first), and
 * each item's folder path becomes a chain of nodes under its category. So a
 * category opens onto its folders before any of its own items.
 */
function buildTree(items: CatalogItem[]): CatalogNode[] {
  const roots: CatalogNode[] = [];
  const rootByName = new Map<string, CatalogNode>();
  const getRoot = (name: string) => {
    let root = rootByName.get(name);
    if (!root) {
      root = { key: name, name, items: [], children: [] };
      rootByName.set(name, root);
      roots.push(root);
    }
    return root;
  };
  for (const item of items) {
    let node = getRoot(item.category ?? '');
    for (const seg of item.path) {
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = { key: `${node.key}›${seg}`, name: seg, items: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }
  // An unnamed category is the "never filed" bucket — it reads first, with no
  // heading, so nothing goes missing behind a fold.
  return [...roots.filter((r) => !r.name), ...roots.filter((r) => r.name)];
}

export interface OfferingCatalogProps {
  businessId: string;
  bucket: OfferingBucket;
}

/** The whole screen: loads the business, then renders one of its buckets. */
export function OfferingCatalog({ businessId, bucket }: OfferingCatalogProps) {
  const repos = useRepositories();

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  const view = useMemo(
    () => (business ? offeringBucket(business, bucket) : null),
    [business, bucket],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;
  if (!view) {
    return (
      <>
        <Stack.Screen options={{ title: business.name }} />
        <EmptyView
          title={`No ${EMPTY_NOUN[bucket]} yet`}
          subtitle={`${business.name} hasn’t added this yet.`}
        />
      </>
    );
  }

  return <CatalogBody businessId={businessId} businessName={business.name} view={view} />;
}

/** What to call an empty bucket in the "nothing here yet" line. */
const EMPTY_NOUN: Record<OfferingBucket, string> = {
  menu: 'menu',
  products: 'products',
  services: 'services',
  rentals: 'rentals',
};

function CatalogBody({
  businessId,
  businessName,
  view,
}: {
  businessId: string;
  businessName: string;
  view: OfferingBucketView;
}) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cart = useCart(businessId);

  const tree = useMemo(() => buildTree(view.items), [view.items]);
  // A node's key sits in `toggled` when its state differs from the default —
  // top-level categories start OPEN (a list nobody unfolds is a list nobody
  // reads), nested folders start CLOSED (tap a category, see its folders; tap a
  // folder, see what's in it).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const total = totalOf(cart.lines.map((l) => ({ price: l.item.price, quantity: l.quantity })));

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: businessName }} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          // Clear the sticky bar so the last item is never trapped under it.
          { paddingBottom: cart.itemCount > 0 ? 120 : spacing.xl },
        ]}
      >
        {tree.map((root) => (
          <CatalogGroup
            key={root.key || 'ungrouped'}
            node={root}
            depth={0}
            icon={view.icon}
            toggled={toggled}
            onToggle={toggle}
            cart={cart}
          />
        ))}
      </ScrollView>

      {/* Sticky order bar — the whole point: never scroll to order. */}
      {cart.itemCount > 0 ? (
        <View
          style={[
            styles.bar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={styles.barInfo}>
            <Text weight="semibold">
              {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}
            </Text>
            <Text variant="caption" tone="muted">
              {totalLabel(total)}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push(`/cart/${businessId}`)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.barBtn,
              { backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text weight="bold" tone="inverse">
              Place order ›
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One node of the tree, rendered recursively. Top-level categories start open
 * and read as section headings; nested folders start collapsed and read as
 * indented dropdowns — tap to reveal their own folders and items. A node's
 * folders list before its own items.
 */
function CatalogGroup({
  node,
  depth,
  icon,
  toggled,
  onToggle,
  cart,
}: {
  node: CatalogNode;
  depth: number;
  icon: string;
  toggled: Set<string>;
  onToggle: (key: string) => void;
  cart: ReturnType<typeof useCart>;
}) {
  const colors = useColors();
  const hasHeader = node.name !== '';
  const defaultOpen = depth === 0;
  const isOpen = !hasHeader || (toggled.has(node.key) ? !defaultOpen : defaultOpen);
  const count = nodeCount(node);

  return (
    <View style={depth > 0 ? styles.nested : undefined}>
      {hasHeader ? (
        <Pressable
          onPress={() => onToggle(node.key)}
          style={[
            styles.groupHeader,
            depth > 0 && {
              borderBottomColor: colors.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          accessibilityLabel={`${node.name}, ${count} items`}
        >
          <Text
            variant={depth === 0 ? 'subheading' : 'body'}
            weight={depth === 0 ? 'bold' : 'semibold'}
          >
            {node.name}
          </Text>
          <Text tone="muted">
            {count} · {isOpen ? '▲' : '▼'}
          </Text>
        </Pressable>
      ) : null}

      {isOpen ? (
        <>
          {node.children.map((child) => (
            <CatalogGroup
              key={child.key}
              node={child}
              depth={depth + 1}
              icon={icon}
              toggled={toggled}
              onToggle={onToggle}
              cart={cart}
            />
          ))}
          {node.items.map((item, i) => (
            <ItemCard
              key={item.key}
              item={item}
              icon={icon}
              quantity={cart.quantityOf(item)}
              onBump={(d) => cart.bump(item, d)}
              divider={i < node.items.length - 1}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

/** One offering: details left, photo + ADD button right. */
function ItemCard({
  item,
  icon,
  quantity,
  onBump,
  divider,
}: {
  item: CatalogItem;
  icon: string;
  quantity: number;
  onBump: (delta: number) => void;
  divider: boolean;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.item,
        divider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.itemInfo}>
        <VegDot isVeg={item.isVeg} />
        <Text weight="semibold" style={styles.itemName}>
          {item.name}
        </Text>
        <View style={styles.priceRow}>
          <Text weight="semibold">{item.price ?? 'Price on request'}</Text>
          {item.badge ? (
            <Text
              variant="caption"
              tone="muted"
              style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}
            >
              {item.badge}
            </Text>
          ) : null}
        </View>
        {item.detail ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {item.detail}
          </Text>
        ) : null}
        {item.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2} style={styles.itemDesc}>
            {item.description}
          </Text>
        ) : null}
      </View>

      <View style={styles.itemMedia}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoBlank, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={styles.photoIcon}>{icon}</Text>
          </View>
        )}

        {/* The ADD button overlaps the photo's bottom edge, delivery-app style. */}
        {quantity === 0 ? (
          <Pressable
            onPress={() => onBump(1)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.name}`}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.surface,
                borderColor: colors.brand,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text weight="bold" tone="brand">
              ADD ＋
            </Text>
          </Pressable>
        ) : (
          <View
            style={[
              styles.addBtn,
              styles.stepper,
              { backgroundColor: colors.brand, borderColor: colors.brand },
            ]}
          >
            <Pressable
              onPress={() => onBump(-1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove one ${item.name}`}
            >
              <Text weight="bold" tone="inverse">
                −
              </Text>
            </Pressable>
            <Text weight="bold" tone="inverse">
              {quantity}
            </Text>
            <Pressable
              onPress={() => onBump(1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add one more ${item.name}`}
            >
              <Text weight="bold" tone="inverse">
                ＋
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const PHOTO = 118;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Nested folders indent under their parent so the tree reads at a glance.
  nested: { paddingLeft: spacing.md },
  item: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg },
  itemInfo: { flex: 1, gap: 4 },
  itemName: { fontSize: 17 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  itemDesc: { lineHeight: 18 },
  // Extra bottom room for the ADD button that hangs off the photo.
  itemMedia: { width: PHOTO, alignItems: 'center', paddingBottom: spacing.lg },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radius.md },
  photoBlank: { alignItems: 'center', justifyContent: 'center' },
  photoIcon: { fontSize: 32 },
  addBtn: {
    position: 'absolute',
    bottom: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 104,
  },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barInfo: { flex: 1 },
  barBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
});
