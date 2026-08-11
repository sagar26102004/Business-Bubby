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
 * THE THREE CONTROLS, all applied to one fetch:
 *   RANGE      — the customer's own radius, in km. It goes to the repository
 *                (`listPlacements(near, { radiusKm })`), because widening the
 *                range must fetch further, not just filter what's on hand.
 *   CATEGORY   — the same INTENT_CATEGORIES as Home, matched with
 *                `intentMatches`, so "Food" means the same thing on both.
 *   REELS ONLY — narrows to offers with a video. Only offered when a video is
 *                actually in range: a filter that always empties the screen is
 *                worse than no filter.
 *
 * COUNTING. A page reaching the screen is an impression, and the ad's tap is
 * the CTA, exactly as on Home — same `recordImpression` / `recordTap`, so a
 * business's numbers mean one thing across both surfaces. Both are
 * fire-and-forget: a counter must never delay or break browsing.
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
import type { AdPlacement } from '@/data/repositories';
import type { Business, SavedPlace } from '@/domain/types';
import { INTENT_CATEGORIES, intentMatches } from '@/domain/intents';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { shareText } from '@/lib/share';
import { Icon, Text } from '@/components/ui';
import { DealReelCard } from '@/features/ads/DealReelCard';
import { radius, spacing } from '@/theme/theme';

/**
 * The ranges on offer. Small steps where people actually walk, then a couple of
 * big ones for a thin neighborhood — the same ladder the ad plans are priced
 * on, so "my ad reaches 6 km" and "show me 5 km" are comparable numbers.
 */
const RANGES_KM = [1, 2, 5, 10, 25] as const;
const DEFAULT_RANGE_KM = 5;

export default function DealsScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  // Home hands over the place being browsed and (optionally) the category that
  // was selected there, so "See all" continues what the customer was doing
  // rather than resetting them to everything.
  const { place: placeId, intent } = useLocalSearchParams<{ place?: string; intent?: string }>();

  const [rangeKm, setRangeKm] = useState<number>(DEFAULT_RANGE_KM);
  const [categoryId, setCategoryId] = useState<string | null>(intent ?? null);
  const [reelsOnly, setReelsOnly] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  // Held by the screen, not the card, so a viewer who unmutes one ad keeps
  // sound for the rest of the session's scrolling.
  const [muted, setMuted] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);

  const { data: places } = useAsync(() => repos.places.listPlaces(), []);
  const place: SavedPlace | undefined = useMemo(
    () => (places ?? []).find((p) => p.id === placeId) ?? places?.[0],
    [places, placeId],
  );
  const near = place?.point;

  const { data, loading, error, reload } = useAsync(
    () => repos.ads.listPlacements(near, { radiusKm: rangeKm }),
    [near?.latitude, near?.longitude, rangeKm],
  );

  const all = useMemo(() => data ?? [], [data]);
  /** Is a reel filter worth offering? Only if there's a video in range. */
  const hasReels = useMemo(() => all.some((p) => !!p.offer.videoUrl), [all]);

  const items = useMemo(() => {
    const category = INTENT_CATEGORIES.find((c) => c.id === categoryId);
    return all.filter((p) => {
      if (reelsOnly && !p.offer.videoUrl) return false;
      if (category && !intentMatches(p.business, category)) return false;
      return true;
    });
  }, [all, categoryId, reelsOnly]);

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
      void repos.ads.recordImpression(campaignId);
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
      `${p.offer.title}${price}\nat ${p.business.name} on Localo`,
      p.offer.title,
    );
  }, []);

  // A page is exactly the window minus the filter rows, so one swipe is one
  // deal. The estimate only holds for the very first frame, before onLayout.
  const pageHeight = Math.max(height - (headerHeight ?? insets.top + 52), 320);
  // On a desktop browser a full-bleed video feed would be a wall of pixels;
  // 9:16 inside the window is what the ad was filmed for.
  const pageWidth = Platform.OS === 'web' ? Math.min(width, Math.round(pageHeight * 0.62)) : width;

  const rangeLabel = `${rangeKm} km`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Everything above the feed is measured rather than guessed: the rows
          come and go (the range panel opens, the category strip only exists
          when something matches), and a page that isn't exactly the leftover
          height stops one swipe meaning one deal. */}
      <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
      {/* ── Top bar: back, range, reels ── */}
      <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrowLeft" size={20} color="#fff" />
        </Pressable>

        <Text variant="label" weight="bold" tone="inverse" style={styles.barTitle}>
          Deals near you
        </Text>

        <Pressable
          onPress={() => setRangeOpen((v) => !v)}
          style={[styles.pill, rangeOpen && styles.pillOn]}
          hitSlop={6}
        >
          <Text variant="caption" weight="bold" tone="inverse">
            📍 {rangeLabel} ▾
          </Text>
        </Pressable>

        {hasReels ? (
          <Pressable
            onPress={() => setReelsOnly((v) => !v)}
            style={[styles.pill, reelsOnly && styles.pillOn]}
            hitSlop={6}
          >
            <Text variant="caption" weight="bold" tone="inverse">
              🎬 Reels
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Range row — open only when asked for, so the feed keeps the screen. */}
      {rangeOpen ? (
        <View style={styles.rangeRow}>
          {RANGES_KM.map((km) => (
            <Pressable
              key={km}
              onPress={() => setRangeKm(km)}
              style={[styles.pill, km === rangeKm && styles.pillOn]}
            >
              <Text variant="caption" weight="bold" tone="inverse">
                {km} km
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* ── Category chips ── the same intents as Home, kept to the ones that
          actually match something in range. */}
      {categories.length > 0 ? (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            <Pressable
              onPress={() => setCategoryId(null)}
              style={[styles.pill, categoryId === null && styles.pillOn]}
            >
              <Text variant="caption" weight="bold" tone="inverse">
                ✨ All
              </Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                style={[styles.pill, categoryId === c.id && styles.pillOn]}
              >
                <Text variant="caption" weight="bold" tone="inverse">
                  {c.icon} {c.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      </View>

      {/* ── The feed ──
          The shared Loading/Error/Empty views are built for the app's white
          pages and would print near-black text onto this one, so the three
          states are spelled out here in the feed's own palette. */}
      {loading && !data ? (
        <View style={styles.state}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : error ? (
        <View style={styles.state}>
          <Text variant="subheading" weight="bold" tone="inverse">
            Couldn’t load deals
          </Text>
          <Text tone="inverse" style={styles.stateBody}>
            {error.message}
          </Text>
          <Pressable onPress={reload} style={[styles.pill, styles.pillOn, styles.retry]}>
            <Text variant="label" weight="bold" tone="inverse">
              Try again
            </Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.state}>
          <Text variant="subheading" weight="bold" tone="inverse">
            {reelsOnly ? 'No video ads in range' : 'No deals in range'}
          </Text>
          <Text tone="inverse" style={styles.stateBody}>
            {rangeKm < RANGES_KM[RANGES_KM.length - 1]
              ? `Nothing on offer within ${rangeLabel}. Widen the range to look further out.`
              : 'Nothing on offer around you just yet. Businesses nearby post deals as they run them.'}
          </Text>
        </View>
      ) : (
        <FlatList
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
          contentContainerStyle={
            pageWidth < width ? { width: pageWidth, alignSelf: 'center' } : undefined
          }
          renderItem={({ item, index }) => (
            <DealReelCard
              placement={item}
              active={index === activeIndex}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              height={pageHeight}
              onOpen={() => open(item)}
              onOrder={
                canOrderFrom(item.business) ? () => router.push(`/order/new/${item.business.id}`) : undefined
              }
              onShare={() => share(item)}
            />
          )}
        />
      )}
    </View>
  );
}

/** Is there anything on this business a customer could put in an order? */
function canOrderFrom(business: Business): boolean {
  return (
    (business.menu?.length ?? 0) +
      (business.products?.length ?? 0) +
      (business.services?.length ?? 0) >
    0
  );
}

const styles = StyleSheet.create({
  // The feed is dark end to end: the chrome has to belong to the video, not to
  // the app's paper-white pages.
  screen: { flex: 1, backgroundColor: '#000' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  barTitle: { flex: 1 },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pillOn: { backgroundColor: 'rgba(255,255,255,0.42)' },
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  categoryRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { flex: 1 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  stateBody: { opacity: 0.8, textAlign: 'center' },
  retry: { marginTop: spacing.md, paddingVertical: spacing.sm },
});
