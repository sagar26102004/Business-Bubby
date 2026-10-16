/**
 * Browse page — every customer category (intent) is its own URL
 * (/browse/food, /browse/home-services, /browse/rentals, …; the [type] param
 * carries the intent id). Filter chips ride in the query string (?sub=Cafe)
 * and the origin place as ?place=, so any filtered view is deep-linkable and
 * the back button exits cleanly.
 *
 * Paged (useNearbyFeed): 20 cards, then 10 more per scroll, ranked in the
 * database — never the whole directory.
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
import { ON_HOLD, isListedPublicly } from '@/lib/onHold';
import type { ListingType } from '@/domain/types';
import { useNearbyFeed } from '@/features/businesses/useNearbyFeed';

interface Chip {
  id: string;
  label: string;
  icon?: string;
  count?: number;
}

/** ON HOLD (redesign 2026-10): stall — stall listings are hidden from public lists. */
const EXCLUDE_TYPES: ListingType[] = ON_HOLD.stalls ? ['item'] : [];

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

  // ON HOLD (redesign 2026-10): stall — Stalls' chips look inside `products`,
  // so that one category still reads full listings and filters here. (Its
  // listings are hidden from public lists while on hold, so this is small.)
  const isStalls = intent?.id === 'stalls';
  const stallRead = useAsync(
    async () =>
      isStalls
        ? (await repos.businesses.list({ near, sortByDistance: true, type: 'item' })).filter(isListedPublicly)
        : [],
    [isStalls, near?.latitude, near?.longitude],
    { enabled: isStalls },
  );

  // Every other category: paged in the database (useNearbyFeed), nearest first,
  // no distance cut-off — someone who opened Rentals will travel for one. A
  // chip narrows the feed to its one tag; the chips themselves (and their
  // counts) come from one summary call over the category's tags.
  const feed = useNearbyFeed(
    {
      near,
      minCount: 0,
      excludeTypes: EXCLUDE_TYPES,
      intent: intent ? (sub ? { tags: [sub] } : intent) : undefined,
      sort: 'nearest',
      seed: 0,
    },
    ['browse', intent?.id, sub, near ? `${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : 'none'],
    { enabled: !!intent && !isStalls },
  );
  const { data: chipCounts } = useAsync(
    () =>
      intent && !isStalls
        ? repos.businesses.nearbySummary(
            { near, minCount: 0, excludeTypes: EXCLUDE_TYPES },
            intent.tags.map((t) => ({ id: t, label: t, icon: '', color: '', tags: [t] })),
          )
        : Promise.resolve(undefined),
    [intent?.id, isStalls],
    { key: ['browse-chips', intent?.id], enabled: !!intent && !isStalls },
  );

  const stallsAll = useMemo(
    () => (intent && isStalls ? (stallRead.data ?? []).filter((b) => intentMatches(b, intent)) : []),
    [stallRead.data, intent, isStalls],
  );

  const chips = useMemo<Chip[]>(() => {
    if (!intent) return [];
    if (isStalls) {
      // Stalls have no tags of their own — their chips are the item categories
      // of the products inside them.
      return (getType('item')?.subcategories ?? []).map((s) => ({ id: s.id, label: s.name, icon: s.icon }));
    }
    // The category's tags carried by any listing, in curated order.
    return intent.tags
      .filter((t) => (chipCounts?.counts[t] ?? 0) > 0)
      .map((t) => ({ id: t, label: t, count: chipCounts?.counts[t] }));
  }, [intent, isStalls, chipCounts]);

  const active = chips.find((c) => c.id === sub);
  const businesses = isStalls
    ? active
      ? stallsAll.filter(
          (b) =>
            hasTag(b.tags, active.label) ||
            b.subcategoryId === active.id ||
            b.products?.some((p) => p.subcategoryId === active.id),
        )
      : stallsAll
    : feed.items;
  const loading = isStalls ? stallRead.loading : feed.loading;
  const error = isStalls ? stallRead.error : feed.error;
  const reload = isStalls ? stallRead.reload : feed.reload;

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
      onEndReached={isStalls ? undefined : feed.loadMore}
      // Ask for the next page while about two screens are still left to read.
      onEndReachedThreshold={2}
      ListFooterComponent={!isStalls && feed.loadingMore ? <LoadingView label="Loading more…" /> : null}
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
                count={c.count}
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
