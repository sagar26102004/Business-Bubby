/**
 * Explore (One Place redesign — docs/redesign-one-place/explore.png). A flat
 * linen top sheet, then the feed:
 *  - Brand row: my avatar (→ Account, which no longer has a bottom-bar button),
 *    "One Place" + the place you're browsing, then Map, Alerts (the bell, with
 *    my unread customer alerts — moved here from Chats) and Deals.
 *  - Location dropdown (saved places) + a "within N km" pill that states how far
 *    the list actually reaches, then the search pill.
 *  - INTENT CHIPS with live counts (All + every category that has listings
 *    here) — they filter this screen inline, no navigation.
 *  - With a category picked, a row of that category's tags (→ /browse/[intent]?sub=).
 *  - "Neighborhood deals near you" — the AD SLOT (domain/ads.ts), filtered to
 *    the picked category; what goes in it is decided by AdRepository.
 *  - "Near you now" — the listing cards, sorted Popular or Nearest.
 *
 * The list is bounded by COUNT, not distance: the HOME_NEARBY_COUNT listings
 * closest to the active place. Search and the category pages stay unbounded —
 * see the constant's note for why.
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
import { useRouter } from 'expo-router';
import type { PlaceKind, SavedPlace } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { INTENT_CATEGORIES, intentMatches, tagEmoji, type IntentCategory } from '@/domain/intents';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useResponsive } from '@/lib/useResponsive';
import {
  Avatar,
  Card,
  EmptyView,
  ErrorView,
  Icon,
  LoadingView,
  SectionHeader,
  SegmentedControl,
  Tag,
  Text,
} from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { useTabBadges } from '@/features/notifications/alertSides';
import { SearchScanBar } from '@/features/search/SearchScanBar';
import { AdCarousel, type AdCardItem } from '@/features/ads/AdCarousel';
import { AD_GRADIENTS } from '@/features/ads/adGradients';
import { radius, spacing, useColors } from '@/theme/theme';
import { isListedPublicly } from '@/lib/onHold';

/**
 * How much Home shows: the N nearest listings, nearest first.
 *
 * This used to be a 20 km ring, and a ring is the wrong shape for the job. It
 * asks "how far is too far?" when the question people actually have is "what is
 * around me?" — so the same number that keeps a dense market from padding the
 * scroll leaves a thin town staring at "No results" with a perfectly good shop
 * 22 km up the road. A COUNT adapts on its own: it fills the screen wherever
 * you stand, and quietly reaches further where things are sparse.
 *
 * Deliberately NOT applied to search or the category pages: someone who typed
 * "bullet rental" or opened Rentals is looking for a specific thing and would
 * rather travel for it than be told there are no results. The ad slot has its
 * own reach rules (domain/ads.ts) and the deals feed lets the customer pick a
 * range up to Anywhere — this constant governs the Home list only.
 *
 * With no `near` point yet (a device still waiting on GPS) there is no distance
 * to rank by, so this is simply the newest 100 rather than an empty screen.
 */
const HOME_NEARBY_COUNT = 100;

const placeIcon = (kind: PlaceKind) =>
  kind === 'current' ? '📍' : kind === 'home' ? '🏠' : kind === 'work' ? '💼' : '⭐';

export default function BrowseScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isGuest, currentUser } = useAuth();
  const { alerts: unreadAlerts } = useTabBadges();
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
  const [sort, setSort] = useState<'popular' | 'nearest'>('nearest');

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const activePlace = places?.find((p) => p.id === activePlaceId) ?? places?.[0];
  const near = activePlace?.point;

  const { data, loading, error, reload } = useAsync(
    // ON HOLD (redesign 2026-10): stall — stall listings are hidden from public lists.
    () =>
      repos.businesses
        .list({ near, sortByDistance: true, limit: HOME_NEARBY_COUNT })
        .then((l) => l.filter(isListedPublicly)),
    [near?.latitude, near?.longitude],
  );

  // (Home stays mounted across tab switches and account changes, so its initial
  // fetch would go stale — `useAsync` now refetches on focus for every screen,
  // quietly, so a business registered since is already in the list.)

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
    const inCategory = selected ? all.filter((b) => intentMatches(b, selected)) : all;
    if (sort === 'nearest') return inCategory; // already nearest-first
    // Popular = a rating weighted by how many people gave it, so one 5★ review
    // doesn't outrank a hundred 4.7s.
    const score = (b: (typeof all)[number]) =>
      (b.ratingAvg ?? 0) * Math.log10(1 + (b.ratingCount ?? 0));
    return [...inCategory].sort((a, b) => score(b) - score(a));
  }, [data, selected, sort]);

  // How many nearby listings each category holds — the counts on the chips.
  const intentCounts = useMemo(() => {
    const all = data ?? [];
    return new Map(INTENT_CATEGORIES.map((c) => [c.id, all.filter((b) => intentMatches(b, c)).length]));
  }, [data]);

  // "Within N km": how far the list actually reaches, from the furthest result.
  const reachKm = useMemo(() => {
    const far = Math.max(0, ...(data ?? []).map((b) => b.distanceKm ?? 0));
    return far > 0 ? Math.max(1, Math.ceil(far)) : undefined;
  }, [data]);

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

  /**
   * Campaign behind an ad card, so a view can be counted against it — with how
   * far away the viewer is, which is what decides whether the view counts
   * toward the promise the business bought (domain/ads.ts).
   */
  const campaignByKey = useMemo(() => {
    const map = new Map<string, { id: string; distanceKm?: number }>();
    for (const p of placements ?? []) {
      if (p.campaign) {
        map.set(`${p.business.id}:${p.offer.id}`, { id: p.campaign.id, distanceKm: p.distanceKm });
      }
    }
    return map;
  }, [placements]);

  const countImpression = useCallback(
    (key: string) => {
      const seen = campaignByKey.get(key);
      if (seen) void repos.ads.recordImpression(seen.id, seen.distanceKm);
    },
    [campaignByKey, repos],
  );

  // A picked category's own tags that nearby listings carry — its trending row.
  // (ON HOLD (redesign 2026-10): stall — the Stalls category's item-subcategory
  // chips used to be built here.)
  const subTiles = useMemo(() => {
    if (!selected) return [];
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
          {/* Brand row */}
          <View style={styles.brandRow}>
            <Pressable
              onPress={() => router.push('/account')}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Account and profile"
              style={({ pressed }) => [
                styles.avatarBtn,
                { backgroundColor: colors.brandSoft, borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              {currentUser && !isGuest ? (
                <Avatar name={currentUser.name} uri={currentUser.avatarUrl} size={38} />
              ) : (
                <Icon name="user" size={22} color={colors.brand} />
              )}
            </Pressable>
            <View style={styles.flex}>
              <Text variant="subheading" weight="bold">
                One Place
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                ● {activePlace ? activePlace.label : 'Near you'} · local hub
              </Text>
            </View>
            <HeaderIcon icon="map" label="Map of businesses" onPress={() => router.push('/map')} />
            <HeaderIcon
              icon="bell"
              label="Alerts"
              badge={unreadAlerts}
              onPress={() => router.push(isGuest ? '/sign-in' : '/alerts')}
            />
            <HeaderIcon icon="ticket" label="Deals near you" onPress={() => router.push('/deals')} />
          </View>

          {/* Location row — the place you're browsing, and how far the list reaches. */}
          <View style={styles.locationRow}>
            <Pressable
              onPress={() => setPlacesOpen((v) => !v)}
              style={styles.locationBtn}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Change location"
            >
              <Icon name="pin" size={17} color={colors.cta} />
              <Text variant="label" weight="bold" numberOfLines={1} style={styles.locationText}>
                {activePlace ? activePlace.label : 'Near you'}
              </Text>
              <View style={placesOpen ? styles.chevOpen : undefined}>
                <Icon name="chevronDown" size={16} color={colors.textMuted} />
              </View>
            </Pressable>
            {reachKm ? <Tag label={`Within ${reachKm} km`} tone="status" size="sm" /> : null}
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
                    {active ? <Icon name="check" size={18} color={colors.brand} /> : null}
                  </Pressable>
                );
              })}
            </Card>
          ) : null}

          {/* Search pill (→ /search) */}
          <View
            style={styles.searchRow}
            onLayout={(e) => {
              searchY.current = e.nativeEvent.layout.y;
            }}
          >
            <SearchScanBar />
          </View>
        </View>

        {/* Intent chips — filter THIS screen inline, with live counts. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.chipRow}
        >
          <Tag
            label="All"
            count={data?.length ?? 0}
            selected={selectedId === null}
            onPress={() => setSelectedId(null)}
          />
          {INTENT_CATEGORIES.filter((c) => (intentCounts.get(c.id) ?? 0) > 0 || c.id === selectedId).map(
            (c) => (
              <Tag
                key={c.id}
                icon={c.icon}
                label={c.label}
                count={intentCounts.get(c.id) ?? 0}
                selected={selectedId === c.id}
                onPress={() => setSelectedId(selectedId === c.id ? null : c.id)}
              />
            ),
          )}
        </ScrollView>

        {/* The picked category's own tags. */}
        {selected && subTiles.length > 0 ? (
          <View style={styles.trendRow}>
            <Text variant="caption" weight="bold" tone="muted">
              {`In ${selected.label}:`}
            </Text>
            {subTiles.map((t) => (
              <Tag
                key={t.id}
                label={`${t.emoji} ${t.label}`}
                tone="soft"
                size="sm"
                onPress={() => openSubcategory(t.id)}
              />
            ))}
          </View>
        ) : null}

        {/* The ad slot — offers near you, scoped to the picked category */}
        {ads.length > 0 ? (
          <View>
            <SectionHeader
              emoji="🔥"
              title={selected ? `${selected.label} deals near you` : 'Neighborhood deals near you'}
              actionLabel="View all"
              onAction={() =>
                router.push({
                  pathname: '/deals',
                  params: {
                    ...(activePlace ? { place: activePlace.id } : {}),
                    ...(selectedId ? { intent: selectedId } : {}),
                  },
                })
              }
            />
            {/* Bleeds to the screen edges so neighbouring cards peek in. */}
            <View style={styles.bleed}>
              <AdCarousel items={ads} onImpression={countImpression} />
            </View>
          </View>
        ) : null}

        <SectionHeader
          title={selected ? `${selected.label} near you` : 'Near you now'}
          subtitle="Neighborhood providers around you, open and active"
          right={
            <SegmentedControl
              fill={false}
              value={sort}
              onChange={setSort}
              options={[
                { id: 'popular', label: 'Popular' },
                { id: 'nearest', label: 'Nearest' },
              ]}
            />
          }
        />
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
      selected,
      subTiles,
      intentCounts,
      reachKm,
      currentUser,
      unreadAlerts,
      data,
      sort,
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
              // Nothing is filtered out by distance any more, so an empty Home
              // really does mean "nothing listed" — except when a category chip
              // is narrowing it, which is worth saying.
              subtitle={
                selected
                  ? `Nothing under ${selected.label} near this location yet.`
                  : 'Nothing listed near this location yet. Try another location, or search — search looks everywhere.'
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

/** A round white icon button in the header sheet. */
function HeaderIcon({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: 'map' | 'ticket' | 'bell';
  label: string;
  /** Unread count — drawn as a terracotta dot, the count goes to screen readers. */
  badge?: number;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icon name={icon} size={18} color={colors.text} />
      {badge ? (
        <View style={[styles.badgeDot, { backgroundColor: colors.cta, borderColor: colors.surface }]} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  // Multi-column nearby grid on wide screens.
  column: { gap: spacing.md },
  gridItem: { flex: 1 },
  // The header sheet bleeds to the screen edges and adds its own padding.
  sheet: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  locationBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  locationText: { flexShrink: 1 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
  // Escape the list's horizontal padding so rows reach the screen edges.
  bleed: { marginHorizontal: -spacing.lg },
  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.lg },
  trendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.md,
  },
});
