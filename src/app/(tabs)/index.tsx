/**
 * Home (no app-bar) — a quiet, flat top sheet in the neighborhood style:
 *  - The product pills on top: Explore (this side) ⇄ Stalls ⇄ My Business.
 *  - Location row (saved-place dropdown + Map), then the search bar.
 *  - A CATEGORY STRIP (For You + every intent from domain/intents.ts) that
 *    filters this same screen inline — no navigation. The active category is
 *    underlined.
 *  - Picking a category swaps the AD SLOT (the rotating card carousel, filtered
 *    to that category), reveals its SUBCATEGORY TILES (the category's tags as
 *    emoji tiles → tap opens /browse/[intent]?sub=Tag), and filters the nearby
 *    business list below.
 *
 * The ad slot is the platform's revenue line (domain/ads.ts): sponsored cards
 * from businesses that bought a campaign, then any live offer from a shop close
 * by. What goes in it is decided by AdRepository.listPlacements, not here — see
 * data/adPlacements.ts.
 *
 * The header used to be a blue gradient block. It's now a plain white sheet
 * closed by a hairline: the content below (photos, deals, cards) supplies the
 * color, and the chrome stays out of its way.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PlaceKind, SavedPlace } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { INTENT_CATEGORIES, intentMatches, tagEmoji, type IntentCategory } from '@/domain/intents';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useResponsive } from '@/lib/useResponsive';
import { Card, EmptyView, ErrorView, Icon, LoadingView, Text } from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { SearchScanBar } from '@/features/search/SearchScanBar';
import { AdCarousel, type AdCardItem } from '@/features/ads/AdCarousel';
import { AD_GRADIENTS } from '@/features/ads/adGradients';
import { ModePills } from '@/features/shell/ModePills';
import { radius, spacing, useColors } from '@/theme/theme';

const placeIcon = (kind: PlaceKind) =>
  kind === 'current' ? '📍' : kind === 'home' ? '🏠' : kind === 'work' ? '💼' : '⭐';

export default function BrowseScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isGuest } = useAuth();
  const { cardColumns, gridMaxWidth, centered } = useResponsive();

  const [activePlaceId, setActivePlaceId] = useState<string | undefined>();
  const [placesOpen, setPlacesOpen] = useState(false);
  // Once the header's search bar scrolls under the status bar, a copy of it
  // pins to the top so search is always one tap away.
  const searchY = useRef(0);
  const [searchStuck, setSearchStuck] = useState(false);
  // null = "For You" (everything). Otherwise the strip filters Home inline.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: IntentCategory | undefined = INTENT_CATEGORIES.find((c) => c.id === selectedId);

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const activePlace = places?.find((p) => p.id === activePlaceId) ?? places?.[0];
  const near = activePlace?.point;

  const { data, loading, error, reload } = useAsync(
    () => repos.businesses.list({ near, sortByDistance: true }),
    [near?.latitude, near?.longitude],
  );

  // Home stays mounted across tab switches and account changes, so its initial
  // fetch goes stale: a business registered afterwards — even by another
  // account in the same session — wouldn't appear. Refetch on focus (skipping
  // the first, already covered by useAsync) so the nearby list stays current.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) reload();
      else focusedOnce.current = true;
    }, [reload]),
  );

  const selectPlace = (place: SavedPlace) => {
    setPlacesOpen(false);
    if (place.kind !== 'current' && isGuest) {
      router.push('/sign-in');
      return;
    }
    setActivePlaceId(place.id);
  };

  // The nearby list, narrowed to the selected category.
  const businesses = useMemo(() => {
    const all = data ?? [];
    return selected ? all.filter((b) => intentMatches(b, selected)) : all;
  }, [data, selected]);

  // What's in the ad slot: sponsored campaigns first, then live offers from
  // shops close by. The reach rules live in the repository (data/adPlacements),
  // so this screen only has to decide the CATEGORY filter and the card look.
  const { data: placements } = useAsync(
    () => repos.ads.listPlacements(near),
    [near?.latitude, near?.longitude],
  );

  const ads: AdCardItem[] = useMemo(() => {
    const inCategory = (placements ?? []).filter(
      (p) => !selected || intentMatches(p.business, selected),
    );

    const fromOffers: AdCardItem[] = inCategory.map((p) => ({
      key: `${p.business.id}:${p.offer.id}`,
      tag: p.offer.tag ?? 'OFFER',
      title: p.offer.title,
      description: p.offer.description,
      price: p.offer.price,
      wasPrice: p.offer.wasPrice,
      emoji: p.offer.emoji ?? getType(p.business.type)?.icon ?? '🏷️',
      imageUrl: p.offer.imageUrl,
      businessName: p.business.name,
      distanceLabel: formatDistance(p.distanceKm),
      colors: AD_GRADIENTS[p.business.type],
      sponsored: !!p.campaign,
      onPress: () => {
        // Fire-and-forget: a failed counter must never delay the navigation the
        // customer actually asked for.
        if (p.campaign) void repos.ads.recordTap(p.campaign.id);
        router.push(`/business/${p.business.id}`);
      },
    }));

    // Seeded demo data only — nothing in the app creates a Deal any more (see
    // domain/types.ts). Kept last so real offers always lead.
    const fromDeals: AdCardItem[] = businesses.flatMap((b) =>
      (b.deals ?? []).map((d) => ({
        key: `deal:${d.id}`,
        tag: d.tag,
        title: d.title,
        description: d.description,
        price: d.price,
        wasPrice: d.wasPrice,
        emoji: d.emoji ?? getType(b.type)?.icon ?? '🏷️',
        businessName: b.name,
        distanceLabel: formatDistance(b.distanceKm),
        colors: AD_GRADIENTS[b.type],
        onPress: () => router.push(`/business/${b.id}`),
      })),
    );

    return [...fromOffers, ...fromDeals];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, businesses, selected]);

  /** Campaign id behind an ad card, so a view can be counted against it. */
  const campaignIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of placements ?? []) {
      if (p.campaign) map.set(`${p.business.id}:${p.offer.id}`, p.campaign.id);
    }
    return map;
  }, [placements]);

  const countImpression = useCallback(
    (key: string) => {
      const campaignId = campaignIdByKey.get(key);
      if (campaignId) void repos.ads.recordImpression(campaignId);
    },
    [campaignIdByKey, repos],
  );

  // Subcategory tiles for the selected category — its tags found on nearby
  // listings (stalls: the item categories instead), Flipkart-grid style.
  const subTiles = useMemo(() => {
    if (!selected) return [];
    if (selected.id === 'stalls') {
      return (getType('item')?.subcategories ?? []).map((s) => ({
        id: s.id,
        label: s.name,
        emoji: s.icon ?? selected.icon,
      }));
    }
    const present = new Set(
      businesses.flatMap((b) => b.tags ?? []).map((t) => t.trim().toLowerCase()),
    );
    return selected.tags
      .filter((t) => present.has(t.toLowerCase()))
      .slice(0, 12)
      .map((t) => ({ id: t, label: t, emoji: tagEmoji(t, selected.icon) }));
  }, [selected, businesses]);

  // Sticky-search trigger: the header bar's own offset, minus the safe area the
  // pinned copy occupies (a few px of hysteresis so it can't flicker).
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const threshold = Math.max(searchY.current - insets.top, 1);
    setSearchStuck((stuck) => (stuck ? y > threshold - 8 : y > threshold + 8));
  };

  const openSubcategory = (sub: string) => {
    router.push({
      pathname: '/browse/[type]',
      params: { type: selected!.id, sub, ...(activePlace ? { place: activePlace.id } : {}) },
    });
  };

  const header = useMemo(
    () => (
      <View>
        <View
          style={[
            styles.sheet,
            {
              paddingTop: insets.top + spacing.md,
              backgroundColor: colors.headerTint,
              borderBottomColor: colors.border,
            },
          ]}
        >
          {/* Three products, one app — the top switcher. */}
          <ModePills active="explore" />

          {/* Location row — the place you're browsing, stated plainly. */}
          <View style={styles.locationRow}>
            <Pressable
              onPress={() => setPlacesOpen((v) => !v)}
              style={styles.locationBtn}
              hitSlop={6}
            >
              <Icon name="pin" size={17} color={colors.brand} filled />
              <Text variant="subheading" weight="bold" numberOfLines={1} style={styles.locationText}>
                {activePlace ? activePlace.label : 'Near you'}
              </Text>
              <View style={placesOpen ? styles.chevOpen : undefined}>
                <Icon name="chevronDown" size={17} color={colors.textMuted} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/map')}
              style={[styles.iconBtn, { backgroundColor: colors.surfaceAlt }]}
              hitSlop={6}
            >
              <Icon name="map" size={19} color={colors.text} />
            </Pressable>
          </View>

          {/* Dropdown panel */}
          {placesOpen ? (
            <Card style={styles.dropdown} padded={false}>
              {(places ?? []).map((p, i) => {
                const active = activePlace?.id === p.id;
                const locked = p.kind !== 'current' && isGuest;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => selectPlace(p)}
                    style={[
                      styles.placeRow,
                      i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                    ]}
                  >
                    <Text weight={active ? 'semibold' : 'regular'}>
                      {placeIcon(p.kind)}  {p.label}
                      {locked ? '  🔒' : ''}
                    </Text>
                    {active ? <Text tone="brand" weight="semibold">✓</Text> : null}
                  </Pressable>
                );
              })}
            </Card>
          ) : null}

          {/* Search pill (→ /search) + QR scan button */}
          <View
            style={styles.searchRow}
            onLayout={(e) => {
              searchY.current = e.nativeEvent.layout.y;
            }}
          >
            <SearchScanBar />
          </View>

          {/* Category strip — filters THIS screen inline, Flipkart-style. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.stripScroll}
            contentContainerStyle={styles.stripRow}
          >
            {[
              { id: null as string | null, label: 'For You', icon: '✨', color: colors.brand },
              ...INTENT_CATEGORIES,
            ].map((c) => {
              const active = selectedId === c.id;
              return (
                <Pressable
                  key={c.id ?? 'foryou'}
                  onPress={() => setSelectedId(c.id)}
                  style={styles.stripItem}
                >
                  {/* Each category owns a color (domain/intents.ts) — the tile
                      wears it, so the strip is the colorful part of the page. */}
                  <View
                    style={[
                      styles.stripIconBox,
                      { backgroundColor: c.color + (active ? '3D' : '1F') },
                      active && { borderColor: c.color, borderWidth: 2 },
                    ]}
                  >
                    <Text style={styles.stripEmoji}>{c.icon}</Text>
                  </View>
                  <Text
                    variant="caption"
                    weight={active ? 'bold' : 'medium'}
                    numberOfLines={1}
                    style={[styles.stripLabel, active && { color: c.color }]}
                  >
                    {c.label}
                  </Text>
                  <View
                    style={[
                      styles.stripUnderline,
                      { backgroundColor: c.color, opacity: active ? 1 : 0 },
                    ]}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Subcategory tiles — one row, right under the strip, above the ad */}
        {selected && subTiles.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tilesScroll}
            contentContainerStyle={styles.tilesRow}
          >
            {subTiles.map((t) => (
              <Pressable key={t.id} onPress={() => openSubcategory(t.id)} style={styles.tile}>
                <View style={[styles.tileBox, { backgroundColor: selected.color + '1C' }]}>
                  <Text style={styles.tileEmoji}>{t.emoji}</Text>
                </View>
                <Text variant="caption" weight="medium" numberOfLines={1} style={styles.tileLabel}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* The ad slot — offers near you, scoped to the picked category */}
        {ads.length > 0 ? (
          <View style={styles.dealsSection}>
            <View style={styles.dealsHeadingRow}>
              <Text variant="subheading" weight="bold" style={styles.dealsHeading}>
                🔥 {selected ? `${selected.label} deals` : 'Deals near you'}
              </Text>
              {/* Four cards is a glance. The feed is where someone who WANTS
                  deals browses them — full-screen, swipe-up, videos playing.
                  It carries the place and category over so "See all" continues
                  what's on screen rather than resetting it. */}
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/deals',
                    params: {
                      ...(activePlace ? { place: activePlace.id } : {}),
                      ...(selectedId ? { intent: selectedId } : {}),
                    },
                  })
                }
                hitSlop={8}
              >
                <Text variant="label" weight="semibold" tone="brand">
                  See all →
                </Text>
              </Pressable>
            </View>
            {/* Bleeds to the screen edges so neighbouring cards peek in. */}
            <View style={styles.dealsBleed}>
              <AdCarousel items={ads} onImpression={countImpression} />
            </View>
          </View>
        ) : null}

        {selected ? (
          <Text variant="subheading" weight="bold" style={styles.listHeading}>
            {selected.icon} {selected.label} near you
          </Text>
        ) : null}
      </View>
    ),
    [
      places,
      activePlace,
      placesOpen,
      colors,
      isGuest,
      insets.top,
      router,
      ads,
      countImpression,
      selectedId,
      subTiles,
    ],
  );

  if (error) return <ErrorView message={error.message} onRetry={reload} />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
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
        ListHeaderComponent={header}
        style={styles.screen}
        contentContainerStyle={[styles.list, centered(gridMaxWidth)]}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={
          loading ? (
            <LoadingView label="Finding businesses…" />
          ) : (
            <EmptyView
              title="No results"
              subtitle={
                selected
                  ? `Nothing under ${selected.label} near this location yet.`
                  : 'Try a different search, category, or location.'
              }
            />
          )
        }
      />

      {/* Pinned search — appears once the header's bar scrolls away. */}
      {searchStuck ? (
        <View
          style={[
            styles.stickySearch,
            {
              paddingTop: insets.top + spacing.sm,
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <SearchScanBar />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  // Multi-column nearby grid on wide screens.
  column: { gap: spacing.md },
  gridItem: { flex: 1 },
  // The header sheet bleeds to the screen edges and adds its own padding.
  sheet: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  // Borderless: the location is a heading you can tap, not a form control.
  locationBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  locationText: { flexShrink: 1 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: { marginTop: spacing.sm },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchRow: { marginTop: spacing.md },
  stickySearch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Category strip
  stripScroll: { marginTop: spacing.lg, marginHorizontal: -spacing.lg },
  stripRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  stripItem: { alignItems: 'center', width: 68 },
  stripIconBox: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripEmoji: { fontSize: 22 },
  stripLabel: { marginTop: spacing.xs, maxWidth: 68 },
  stripUnderline: { height: 3, width: 28, borderRadius: 2, marginTop: 3 },
  // Deals
  dealsSection: { marginBottom: spacing.md },
  dealsHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  dealsHeading: { marginBottom: spacing.md },
  // Escape the list's horizontal padding so peeking cards reach the edges.
  dealsBleed: { marginHorizontal: -spacing.lg },
  // Subcategory tiles
  tilesScroll: { marginHorizontal: -spacing.lg, marginBottom: spacing.md },
  tilesRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  tile: { alignItems: 'center', width: 76 },
  tileBox: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileEmoji: { fontSize: 30 },
  tileLabel: { marginTop: spacing.xs, maxWidth: 76 },
  listHeading: { marginBottom: spacing.md },
});
