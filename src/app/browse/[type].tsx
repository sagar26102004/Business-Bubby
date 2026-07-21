/**
 * Browse page — every customer category (intent) is its own URL
 * (/browse/food, /browse/home-services, /browse/rentals, …; the [type] param
 * carries the intent id). Filter chips ride in the query string (?sub=Cafe)
 * and the origin place as ?place=, so any filtered view is deep-linkable and
 * the back button exits cleanly.
 *
 * Chips are the category's own tags found on nearby listings — Food shows
 * Restaurant / Cafe / Bakery…, Rentals shows Car Rental / Flats & Rooms…
 * A business matches a chip by tag (or product category for stalls), so one
 * business appears under many chips — discovery follows what businesses
 * offer, not one box.
 */
import { useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getType } from '@/domain/catalog';
import { getIntent, intentMatches } from '@/domain/intents';
import { hasTag } from '@/domain/tags';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useResponsive } from '@/lib/useResponsive';
import { EmptyView, ErrorView, LoadingView, Tag } from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { SearchScanBar } from '@/features/search/SearchScanBar';
import { spacing, useColors } from '@/theme/theme';

interface Chip {
  id: string;
  label: string;
  icon?: string;
}

export default function BrowseIntentScreen() {
  const params = useLocalSearchParams<{ type: string; sub?: string; place?: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { cardColumns, gridMaxWidth, centered } = useResponsive();

  const intent = getIntent(params.type);
  const sub = params.sub || undefined;

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const activePlace = places?.find((p) => p.id === params.place) ?? places?.[0];
  const near = activePlace?.point;

  // One nearby fetch; intent membership and chip filtering happen here so a
  // business can sit in several categories and match several chips.
  const { data, loading, error, reload } = useAsync(
    async () => (intent ? repos.businesses.list({ near, sortByDistance: true }) : []),
    [intent?.id, near?.latitude, near?.longitude],
  );
  const all = useMemo(
    () => (intent ? (data ?? []).filter((b) => intentMatches(b, intent)) : []),
    [data, intent],
  );

  const chips = useMemo<Chip[]>(() => {
    if (!intent) return [];
    // Stalls have no tags of their own — their chips are the item categories
    // of the products inside them.
    const base: Chip[] =
      intent.id === 'stalls'
        ? (getType('item')?.subcategories ?? []).map((s) => ({
            id: s.id,
            label: s.name,
            icon: s.icon,
          }))
        : [];
    const present = new Set(
      all.flatMap((b) => b.tags ?? []).map((t) => t.trim().toLowerCase()),
    );
    // The category's tags carried by nearby listings, in curated order.
    const extra = intent.tags
      .filter((t) => present.has(t.toLowerCase()))
      .map((t) => ({ id: t, label: t }));
    return [...base, ...extra];
  }, [intent, all]);

  const active = chips.find((c) => c.id === sub);
  const businesses = active
    ? all.filter(
        (b) =>
          hasTag(b.tags, active.label) ||
          b.subcategoryId === active.id ||
          b.products?.some((p) => p.subcategoryId === active.id),
      )
    : all;

  if (!intent) {
    return <EmptyView title="Unknown category" subtitle="This category doesn’t exist." />;
  }
  if (error) return <ErrorView message={error.message} onRetry={reload} />;

  // Chip taps rewrite the URL (?sub=…) rather than local state.
  const chooseSub = (id?: string) => router.setParams({ sub: id ?? '' });

  return (
    <FlatList
      // Keyed to remount when the responsive column count changes.
      key={`cols-${cardColumns}`}
      data={businesses}
      keyExtractor={(b) => b.id}
      numColumns={cardColumns}
      columnWrapperStyle={cardColumns > 1 ? styles.column : undefined}
      renderItem={({ item }) => (
        <View style={cardColumns > 1 ? styles.gridItem : undefined}>
          <BusinessCard business={item} />
        </View>
      )}
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.list, centered(gridMaxWidth)]}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: `${intent.icon} ${intent.label}` }} />
          <SearchScanBar style={styles.searchRow} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            <Tag label="All" selected={!sub} onPress={() => chooseSub(undefined)} />
            {chips.map((c) => (
              <Tag
                key={c.id}
                label={c.label}
                icon={c.icon}
                selected={sub === c.id}
                onPress={() => chooseSub(sub === c.id ? undefined : c.id)}
              />
            ))}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <LoadingView label={`Finding ${intent.label.toLowerCase()}…`} />
        ) : (
          <EmptyView title="No results" subtitle="Try another filter or location." />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  // Multi-column grid on wide screens: gap between columns, each card fills its cell.
  column: { gap: spacing.md },
  gridItem: { flex: 1 },
  searchRow: { marginTop: spacing.md },
  chipScroll: { marginBottom: spacing.lg },
  chipRow: { gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.lg },
});
