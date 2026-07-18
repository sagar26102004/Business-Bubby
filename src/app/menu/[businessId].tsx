/**
 * The menu, the way a food app shows it: sections you can collapse, one card
 * per dish (veg/non-veg dot, name, price, description on the left; the photo
 * with an ADD button on the right), and a sticky bar at the bottom so "Place
 * order" is always one tap away — never a scroll to the end of a long menu.
 *
 * Picks go into the shared cart (features/orders/CartContext), so they survive
 * the trip to /cart/[businessId] and back here via its "Add" button.
 */
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MenuItem } from '@/domain/types';
import { foodSectionOrder, subcategoryPath } from '@/domain/foodMenu';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { EmptyView, ErrorView, LoadingView, Text } from '@/components/ui';
import { VegDot } from '@/features/businesses/FoodMenuEditor';
import { useCart } from '@/features/orders/CartContext';
import { totalLabel, totalOf } from '@/features/orders/orderUtils';
import { radius, spacing, useColors } from '@/theme/theme';

/**
 * One node of the menu tree: a category (top level) or a nested subcategory.
 * `items` are the dishes filed directly at this node; `children` are its
 * subcategory folders, which nest to any depth.
 */
interface MenuNode {
  key: string;
  name: string;
  items: MenuItem[];
  children: MenuNode[];
}

const nodeCount = (n: MenuNode): number =>
  n.items.length + n.children.reduce((sum, c) => sum + nodeCount(c), 0);

/**
 * Build the menu tree: top level is the categories (in the library's canonical
 * order, Appetizers → … → Beverages; uncategorised first), and each dish's
 * nested subcategory path becomes a chain of folders under its category. So
 * "South Indian › Dosa › Plain" nests three deep, and clicking a category
 * reveals its subcategory folders before any dishes.
 */
function buildMenuTree(menu: MenuItem[]): MenuNode[] {
  const roots: MenuNode[] = [];
  const rootByName = new Map<string, MenuNode>();
  const getRoot = (name: string) => {
    let root = rootByName.get(name);
    if (!root) {
      root = { key: name, name, items: [], children: [] };
      rootByName.set(name, root);
      roots.push(root);
    }
    return root;
  };
  for (const item of menu) {
    let node = getRoot(item.category ?? '');
    for (const seg of subcategoryPath(item.subcategory)) {
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = { key: `${node.key}›${seg}`, name: seg, items: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }
  return roots.sort((a, b) => {
    if (!a.name) return -1;
    if (!b.name) return 1;
    return foodSectionOrder(a.name) - foodSectionOrder(b.name);
  });
}

export default function MenuScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cart = useCart(businessId);

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  const tree = useMemo(() => buildMenuTree(business?.menu ?? []), [business]);
  // A node's key sits in `toggled` when its state differs from the default —
  // top-level categories start OPEN (a menu nobody unfolds is a menu nobody
  // reads), nested subcategories start CLOSED (tap a category, see its folders;
  // tap a folder, see its dishes).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;
  if (tree.length === 0) {
    return <EmptyView title="No menu yet" subtitle={`${business.name} hasn’t added their menu.`} />;
  }

  const total = totalOf(cart.lines.map((l) => ({ price: l.item.price, quantity: l.quantity })));

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: business.name }} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          // Clear the sticky bar so the last dish is never trapped under it.
          { paddingBottom: cart.itemCount > 0 ? 120 : spacing.xl },
        ]}
      >
        {tree.map((root) => (
          <MenuGroup
            key={root.key || 'ungrouped'}
            node={root}
            depth={0}
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
 * One node of the menu tree, rendered recursively. Top-level categories start
 * open and read as section headings; nested subcategories start collapsed and
 * read as indented dropdowns — tap to reveal their own folders and dishes. A
 * node's subcategory folders list before its own dishes.
 */
function MenuGroup({
  node,
  depth,
  toggled,
  onToggle,
  cart,
}: {
  node: MenuNode;
  depth: number;
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
            depth > 0 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
          ]}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          accessibilityLabel={`${node.name}, ${count} items`}
        >
          <Text variant={depth === 0 ? 'subheading' : 'body'} weight={depth === 0 ? 'bold' : 'semibold'}>
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
            <MenuGroup
              key={child.key}
              node={child}
              depth={depth + 1}
              toggled={toggled}
              onToggle={onToggle}
              cart={cart}
            />
          ))}
          {node.items.map((item, i) => (
            <DishCard
              key={`${item.name}-${i}`}
              item={item}
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

/** One dish: details left, photo + ADD button right. */
function DishCard({
  item,
  quantity,
  onBump,
  divider,
}: {
  item: MenuItem;
  quantity: number;
  onBump: (delta: number) => void;
  divider: boolean;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.dish,
        divider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.dishInfo}>
        <VegDot isVeg={item.isVeg} />
        <Text weight="semibold" style={styles.dishName}>
          {item.name}
        </Text>
        <Text weight="semibold">{item.price ?? 'Price on request'}</Text>
        {item.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2} style={styles.dishDesc}>
            {item.description}
          </Text>
        ) : null}
      </View>

      <View style={styles.dishMedia}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoBlank, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={styles.photoIcon}>🍽️</Text>
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
          <View style={[styles.addBtn, styles.stepper, { backgroundColor: colors.brand, borderColor: colors.brand }]}>
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
  // Nested subcategories indent under their parent so the tree reads at a glance.
  nested: { paddingLeft: spacing.md },
  dish: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg },
  dishInfo: { flex: 1, gap: 4 },
  dishName: { fontSize: 17 },
  dishDesc: { lineHeight: 18 },
  // Extra bottom room for the ADD button that hangs off the photo.
  dishMedia: { width: PHOTO, alignItems: 'center', paddingBottom: spacing.lg },
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
