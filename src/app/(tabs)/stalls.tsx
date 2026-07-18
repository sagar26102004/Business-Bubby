/**
 * Stalls — everything people around you are selling, as a picture-first grid.
 *
 * Selling your own stuff is its own world (not a business), so it gets its own
 * pill next to Explore and My Business. This screen flattens every nearby
 * personal stall into its individual PRODUCTS: each tile is one item — photo
 * filling the block, price on the photo, name + description underneath. Tapping
 * one opens the stall it belongs to.
 */
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useRouter } from 'expo-router';
import { formatDistance, getSubcategory } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { EmptyView, ErrorView, LoadingView, Text } from '@/components/ui';
import { ProductTile, type StallProduct } from '@/features/businesses/ProductTile';
import { SearchScanBar } from '@/features/search/SearchScanBar';
import { ModePills } from '@/features/shell/ModePills';
import { spacing, useColors } from '@/theme/theme';

export default function StallsScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const near = places?.[0]?.point;

  const { data, loading, error, reload } = useAsync(
    () => repos.businesses.list({ near, sortByDistance: true }),
    [near?.latitude, near?.longitude],
  );

  // Every product inside every nearby stall, nearest stall first — a plain
  // picture-first feed of what people are selling, no categories to wade through.
  const products = useMemo<StallProduct[]>(() => {
    const stalls = (data ?? []).filter((b) => b.type === 'item');
    return stalls.flatMap((b) =>
      (b.products ?? [])
        .filter((p) => p.id)
        .map((p) => ({
          key: `${b.id}:${p.id}`,
          name: p.name,
          price: p.price,
          description: p.description,
          imageUrl: p.images?.[0],
          sold: p.sold,
          emoji: getSubcategory('item', p.subcategoryId)?.icon ?? '🏷️',
          sellerName: b.name,
          distanceLabel: formatDistance(b.distanceKm),
          onPress: () => router.push(`/product/${b.id}/${p.id}`),
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) return <ErrorView message={error.message} onRetry={reload} />;

  const header = (
    <View>
      <LinearGradient
        colors={[colors.accent, colors.accentSoft, colors.background]}
        locations={[0, 0.62, 1]}
        style={[styles.sheet, { paddingTop: insets.top + spacing.lg }]}
      >
        <ModePills active="stalls" />
        <View style={styles.searchRow}>
          <SearchScanBar />
        </View>
      </LinearGradient>

      <View style={styles.titleRow}>
        <Text variant="subheading" weight="bold">
          🏷️ On sale near you
        </Text>
        <Pressable onPress={() => router.push('/register?type=item')}>
          <Text variant="label" weight="semibold" tone="accent">
            ＋ Sell something
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Tabs.Screen options={{ headerShown: false }} />
      <FlatList
        data={products}
        keyExtractor={(p) => p.key}
        renderItem={({ item }) => <ProductTile item={item} />}
        numColumns={2}
        columnWrapperStyle={styles.column}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? (
            <LoadingView label="Finding things for sale…" />
          ) : (
            <EmptyView
              title="Nothing on sale here yet"
              subtitle="Be the first — list something from your own stall."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  // The gradient bleeds to the screen edges and adds its own padding back.
  sheet: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchRow: { marginTop: spacing.md },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  column: { gap: spacing.md, marginTop: spacing.md },
});
