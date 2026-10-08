/**
 * DEALS NEAR YOU — the full-screen, swipe-up feed of everything on offer around
 * the customer. Reached from "See all" beside the Home ad carousel.
 *
 * WHY THIS EXISTS. The Home slot is four cards under a category strip; it's a
 * glance, and it's all the room there is on a page that also has to do search,
 * categories and the nearby list. This is where a customer who WANTS deals goes
 * to browse them properly: one at a time, edge to edge, swiping up — and where
 * a business's video ad actually plays instead of sitting still.
 *
 * LAYOUT follows the One Place "flash reels" mockup: the feed fills the whole
 * window and the chrome FLOATS over it — back, a two-way pill ("Near you" /
 * "Ending soon"), sound and filters — with a "1 / 12 deals nearby" counter
 * under it. Each page is a `DealReelCard`.
 *
 * THE CONTROLS, all applied to one fetch:
 *   MODE       — "Near you" is everything in range, nearest first as the
 *                repository returns it; "Ending soon" keeps only offers with
 *                an end date and puts the closest deadline first.
 *   RANGE      — the customer's own radius, in km, from 1 km all the way to
 *                "Anywhere" (in the filter panel). It goes to the repository
 *                (`listPlacements(near, { radiusKm })`), because widening the
 *                range must fetch further, not just filter what's on hand.
 *                Nothing caps it at a neighborhood: ads are no longer sold by
 *                radius (domain/ads.ts) so a wider look costs the advertiser
 *                nothing.
 *   CATEGORY   — the same INTENT_CATEGORIES as Home, matched with
 *                `intentMatches`, so "Food" means the same thing on both.
 *   REELS ONLY — narrows to offers with a video. Only offered when a video is
 *                actually in range: a filter that always empties the screen is
 *                worse than no filter.
 *
 * COUNTING. A page reaching the screen is an impression, and the ad's tap is
 * the CTA, exactly as on Home — same `recordImpression` / `recordTap`, so a
 * business's numbers mean one thing across both surfaces. The viewer's DISTANCE
 * rides along with the impression, because that's what decides whether the view
 * counts toward what the advertiser bought. Both are fire-and-forget: a counter
 * must never delay or break browsing.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { AdPlacement } from '@/data/repositories';
import type { Business, SavedPlace } from '@/domain/types';
import { INTENT_CATEGORIES, intentMatches } from '@/domain/intents';
import { ANY_RANGE_KM, DEFAULT_FEED_RANGE_KM, FEED_RANGES_KM, formatRangeKm } from '@/domain/ads';
import { liveOffers } from '@/domain/offers';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { shareText } from '@/lib/share';
import { Icon, Text } from '@/components/ui';
import { DealReelCard, REEL } from '@/features/ads/DealReelCard';
import { radius, spacing } from '@/theme/theme';
import { isDemoViewer, isListedPublicly } from '@/lib/onHold';

/**
 * The ranges on offer live in domain/ads.ts beside the plans, so "views within
 * 5 km" and "show me 5 km" stay the same units — and so the ladder's top end
 * ("Anywhere") is one number the whole app agrees on.
 */
const RANGES_KM = [...FEED_RANGES_KM, ANY_RANGE_KM];

type Mode = 'near' | 'ending';

/** Height of the floating bar below the status bar. */
const BAR_HEIGHT = 56;

export default function DealsScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss('/');
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  // Home hands over the place being browsed and (optionally) the category that
  // was selected there, so "See all" continues what the customer was doing
  // rather than resetting them to everything.
  const { place: placeId, intent } = useLocalSearchParams<{ place?: string; intent?: string }>();

  const [mode, setMode] = useState<Mode>('near');
  const [rangeKm, setRangeKm] = useState<number>(DEFAULT_FEED_RANGE_KM);
  const [categoryId, setCategoryId] = useState<string | null>(intent ?? null);
  const [reelsOnly, setReelsOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Held by the screen, not the card, so a viewer who unmutes one ad keeps
  // sound for the rest of the session's scrolling.
  const [muted, setMuted] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<AdPlacement>>(null);

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const place: SavedPlace | undefined = useMemo(
    () => (places ?? []).find((p) => p.id === placeId) ?? places?.[0],
    [places, placeId],
  );
  const near = place?.point;

  const { data, loading, error, reload } = useAsync(
    () =>
      repos.ads
        .listPlacements(near, { radiusKm: rangeKm })
        .then((ps) => ps.filter((p) => isListedPublicly(p.business))),
    [near?.latitude, near?.longitude, rangeKm, isDemoViewer()],
  );

  const all = useMemo(() => data ?? [], [data]);
  /** Is a reel filter worth offering? Only if there's a video in range. */
  const hasReels = useMemo(() => all.some((p) => !!p.offer.videoUrl), [all]);

  const items = useMemo(() => {
    const category = INTENT_CATEGORIES.find((c) => c.id === categoryId);
    const picked = all.filter((p) => {
      if (reelsOnly && !p.offer.videoUrl) return false;
      if (category && !intentMatches(p.business, category)) return false;
      if (mode === 'ending' && !p.offer.endsAt) return false;
      return true;
    });
    if (mode === 'ending') {
      picked.sort((a, b) => (a.offer.endsAt ?? '').localeCompare(b.offer.endsAt ?? ''));
    }
    return picked;
  }, [all, categoryId, reelsOnly, mode]);

  /** Categories that actually have something in range — no dead chips. */
  const categories = useMemo(() => {
    const pool = reelsOnly ? all.filter((p) => p.offer.videoUrl) : all;
    return INTENT_CATEGORIES.filter((c) => pool.some((p) => intentMatches(p.business, c)));
  }, [all, reelsOnly]);

  // Impressions are counted once per campaign per visit: scrolling up and down
  // the same three ads is one viewing, not thirty.
  const counted = useRef(new Set<string>());
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (!first || first.index == null) return;
    setActiveIndex(first.index);
    const placement = first.item as AdPlacement;
    const campaignId = placement.campaign?.id;
    if (campaignId && !counted.current.has(campaignId)) {
      counted.current.add(campaignId);
      // The viewer's distance decides whether this view counts toward what the
      // business bought (domain/ads.ts), so it travels with the impression.
      void repos.ads.recordImpression(campaignId, placement.distanceKm);
    }
  }).current;

  const open = useCallback(
    (p: AdPlacement) => {
      if (p.campaign) void repos.ads.recordTap(p.campaign.id);
      router.push(`/business/${p.business.id}`);
    },
    [repos, router],
  );

  const share = useCallback((p: AdPlacement) => {
    const price = p.offer.price ? ` — ${p.offer.price}` : '';
    void shareText(
      `${p.offer.title}${price}\nat ${p.business.name} on One Place`,
      p.offer.title,
    );
  }, []);

  // Changing what's listed starts the feed from the top again.
  const resetTo = useCallback(() => {
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // The feed owns the whole window; the bar floats over it. One page is one
  // window, so one swipe is one deal.
  const pageHeight = Math.max(height, 480);
  // On a desktop browser a full-bleed video feed would be a wall of pixels;
  // 9:16 inside the window is what the ad was filmed for.
  const pageWidth = Platform.OS === 'web' ? Math.min(width, Math.round(pageHeight * 0.56)) : width;
  const topInset = insets.top + BAR_HEIGHT + spacing.sm;

  const rangeLabel = formatRangeKm(rangeKm);
  const nearLabel = rangeKm >= ANY_RANGE_KM ? 'Anywhere' : `Near you · ${rangeLabel}`;
  const activeHasVideo = !!items[activeIndex]?.offer.videoUrl;
  const filtering = categoryId !== null || reelsOnly || rangeKm !== DEFAULT_FEED_RANGE_KM;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.column, { width: pageWidth }]}>
        {/* ── The feed ──
            The shared Loading/Error/Empty views are built for the app's paper
            pages and would print near-black text onto this one, so the three
            states are spelled out here in the feed's own palette. */}
        {loading && !data ? (
          <View style={styles.state}>
            <ActivityIndicator color={REEL.mint} />
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text variant="subheading" weight="bold" style={styles.stateTitle}>
              Couldn’t load deals
            </Text>
            <Text style={styles.stateBody}>{error.message}</Text>
            <Pressable onPress={reload} style={[styles.chip, styles.chipOn, styles.retry]}>
              <Text variant="label" weight="bold" style={styles.chipTextOn}>
                Try again
              </Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.state}>
            <Text variant="subheading" weight="bold" style={styles.stateTitle}>
              {mode === 'ending'
                ? 'Nothing ending soon'
                : reelsOnly
                  ? 'No video ads in range'
                  : 'No deals in range'}
            </Text>
            <Text style={styles.stateBody}>
              {mode === 'ending'
                ? 'None of the deals in range has an end date. Switch back to “Near you” to see them all.'
                : rangeKm < ANY_RANGE_KM
                  ? `Nothing on offer within ${rangeLabel}. Widen the range in filters to look further out — it goes all the way to “Anywhere”.`
                  : 'Nothing on offer around you just yet. Businesses nearby post deals as they run them.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(p) => `${p.business.id}:${p.offer.id}`}
            pagingEnabled
            snapToInterval={pageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            // Keep only the neighbours mounted: every extra page with a video is
            // another player held open.
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            getItemLayout={(_, index) => ({
              length: pageHeight,
              offset: pageHeight * index,
              index,
            })}
            style={styles.list}
            renderItem={({ item, index }) => (
              <DealReelCard
                placement={item}
                active={index === activeIndex}
                muted={muted}
                height={pageHeight}
                topInset={topInset + 36}
                bottomInset={insets.bottom}
                onOpen={() => open(item)}
                onOrder={
                  canOrderFrom(item.business)
                    ? () =>
                        router.push({
                          pathname: '/order/new/[businessId]',
                          // The reel IS an offer — the order screen opens with
                          // that bundle picked, not an empty catalog.
                          params: { businessId: item.business.id, offer: item.offer.id },
                        })
                    : undefined
                }
                onShare={() => share(item)}
                onCall={() => router.push(`/call/${item.business.id}`)}
                onDirections={
                  canRoute(item.business)
                    ? () => router.push(`/directions/${item.business.id}`)
                    : undefined
                }
                next={items[index + 1]}
                onNext={() => listRef.current?.scrollToIndex({ index: index + 1, animated: true })}
              />
            )}
          />
        )}

        {/* ── Floating chrome ── */}
        <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
          <Pressable onPress={dismiss} hitSlop={8} style={styles.roundBtn}>
            <Icon name="arrowLeft" size={20} color={REEL.text} />
          </Pressable>

          <View style={styles.modes}>
            <ModePill
              label={nearLabel}
              live
              on={mode === 'near'}
              onPress={() => {
                setMode('near');
                resetTo();
              }}
            />
            <ModePill
              label="Ending soon"
              on={mode === 'ending'}
              onPress={() => {
                setMode('ending');
                resetTo();
              }}
            />
          </View>

          {activeHasVideo ? (
            <Pressable onPress={() => setMuted((m) => !m)} hitSlop={6} style={styles.roundBtn}>
              <Icon name={muted ? 'volumeOff' : 'volume'} size={20} color={REEL.text} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setFiltersOpen((v) => !v)}
            hitSlop={6}
            style={[styles.roundBtn, (filtersOpen || filtering) && styles.roundBtnOn]}
          >
            <Icon name="tune" size={20} color={REEL.text} />
          </Pressable>
        </View>

        {/* ── Filters ── open only when asked for, so the feed keeps the screen. */}
        {filtersOpen ? (
          <View style={[styles.panel, { top: insets.top + BAR_HEIGHT + spacing.sm }]}>
            <Text variant="caption" weight="bold" style={styles.panelLabel}>
              DISTANCE
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {RANGES_KM.map((km) => (
                <Chip
                  key={km}
                  label={km >= ANY_RANGE_KM ? '🌍 Anywhere' : `${km} km`}
                  on={km === rangeKm}
                  onPress={() => {
                    setRangeKm(km);
                    resetTo();
                  }}
                />
              ))}
            </ScrollView>

            {categories.length > 0 || hasReels ? (
              <>
                <Text variant="caption" weight="bold" style={styles.panelLabel}>
                  WHAT
                </Text>
                {/* The same intents as Home, kept to the ones that actually
                    match something in range. */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <Chip
                    label="✨ All"
                    on={categoryId === null}
                    onPress={() => {
                      setCategoryId(null);
                      resetTo();
                    }}
                  />
                  {hasReels ? (
                    <Chip
                      label="🎬 Reels"
                      on={reelsOnly}
                      onPress={() => {
                        setReelsOnly((v) => !v);
                        resetTo();
                      }}
                    />
                  ) : null}
                  {categories.map((c) => (
                    <Chip
                      key={c.id}
                      label={`${c.icon} ${c.label}`}
                      on={categoryId === c.id}
                      onPress={() => {
                        setCategoryId(categoryId === c.id ? null : c.id);
                        resetTo();
                      }}
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </View>
        ) : items.length > 0 ? (
          <View style={[styles.counter, { top: insets.top + BAR_HEIGHT + spacing.sm }]} pointerEvents="none">
            <Text variant="caption" weight="bold" style={{ color: REEL.mint }}>
              {Math.min(activeIndex + 1, items.length)}
            </Text>
            <Text variant="caption" weight="bold" style={{ color: REEL.muted }}>
              {' / '}
              {items.length} {items.length === 1 ? 'deal' : 'deals'}{' '}
              {mode === 'ending' ? 'ending soon' : rangeKm >= ANY_RANGE_KM ? 'in range' : 'nearby'}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ModePill({
  label,
  on,
  live,
  onPress,
}: {
  label: string;
  on: boolean;
  live?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.mode, on && styles.modeOn]}>
      {live && on ? <View style={styles.liveDot} /> : null}
      <Text variant="caption" weight="bold" numberOfLines={1} style={{ color: on ? REEL.text : REEL.muted }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text variant="caption" weight="bold" style={on ? styles.chipTextOn : styles.chipText}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Is there anything on this business a customer could put in an order?
 * Plans are excluded on purpose — they are enrolled in, not ordered.
 */
function canOrderFrom(business: Business): boolean {
  return (
    (business.menu?.length ?? 0) +
      (business.products?.length ?? 0) +
      (business.services?.length ?? 0) +
      // An offer is orderable in its own right, even when what it bundles
      // (rentals, say) isn't picked item by item.
      liveOffers(business).length >
    0
  );
}

/**
 * A route is only offered to a place the owner lets people find — a business
 * run from home, or one hiding its exact address, has no Route button on its
 * own page either.
 */
function canRoute(business: Business): boolean {
  const loc = business.location;
  return !!loc?.point && !loc.isHome && !loc.hidePreciseLocation;
}

const styles = StyleSheet.create({
  // The feed is dark end to end: the chrome has to belong to the video, not to
  // the app's paper pages.
  screen: { flex: 1, backgroundColor: REEL.ground, alignItems: 'center' },
  column: { flex: 1, overflow: 'hidden' },
  list: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: REEL.glass,
    borderWidth: 1,
    borderColor: REEL.border,
  },
  roundBtnOn: { backgroundColor: '#2D5A43', borderColor: REEL.mint },
  modes: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(40,51,44,0.7)',
    borderWidth: 1,
    borderColor: REEL.border,
  },
  mode: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  modeOn: { backgroundColor: '#2D5A43' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: REEL.mint },
  counter: {
    position: 'absolute',
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: REEL.glass,
    borderWidth: 1,
    borderColor: REEL.border,
  },
  panel: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(40,51,44,0.94)',
    borderWidth: 1,
    borderColor: REEL.border,
  },
  panelLabel: { color: REEL.muted, letterSpacing: 0.6 },
  chipRow: { gap: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: REEL.glassLight,
    borderWidth: 1,
    borderColor: REEL.border,
  },
  chipOn: { backgroundColor: REEL.mint, borderColor: REEL.mint },
  chipText: { color: REEL.text },
  chipTextOn: { color: '#002112' },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  stateTitle: { color: REEL.text },
  stateBody: { color: REEL.muted, textAlign: 'center' },
  retry: { marginTop: spacing.md, paddingVertical: spacing.sm },
});
