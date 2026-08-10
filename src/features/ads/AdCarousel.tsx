/**
 * THE AD SLOT — the rotating card carousel on Home, under the category strip.
 *
 * One tall card sits centered with a sliver of the previous and next peeking in
 * at the edges; the list wraps around (circular) and auto-advances. Tapping a
 * card opens the business behind it. This is the inventory a business pays for
 * (see domain/ads.ts), so two things matter beyond the motion:
 *
 *   - a SPONSORED card says so, plainly. An ad that hides that it's an ad costs
 *     more trust than the placement is worth.
 *   - a card that reaches the middle counts as SEEN (`onImpression`), which is
 *     the number the business is shown for its money.
 *
 * Looping trick: with 2+ cards the items render three times and the scroll
 * position is silently re-centered onto the middle copy — a jump of exactly one
 * copy-width lands on identical pixels, so the correction is invisible.
 *
 * (Was features/businesses/DealsCarousel.tsx, when the slot could only show the
 * seeded `Deal` array and nothing in the app could create one.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface AdCardItem {
  key: string;
  /** Shout label, e.g. "NEW COMBO", "40% OFF". */
  tag: string;
  /** What the offer is, e.g. "Flat white + banana bread". */
  title: string;
  description?: string;
  price?: string;
  wasPrice?: string;
  emoji: string;
  /** Photo behind the card. Without one it falls back to `colors` + `emoji`. */
  imageUrl?: string;
  businessName: string;
  distanceLabel?: string;
  /** Gradient for the fallback card, and the scrim tint over a photo. */
  colors: [string, string];
  /** A business paid for this placement — say so on the card. */
  sponsored?: boolean;
  onPress: () => void;
}

/** How much of each neighbouring card peeks in at the screen edge. */
const PEEK = 24;
const GAP = spacing.md;
const ADVANCE_MS = 4200;

export interface AdCarouselProps {
  items: AdCardItem[];
  /**
   * Fired the first time a card settles in the middle — i.e. when it has
   * actually been looked at, not merely rendered off-screen in a copy. Called
   * at most once per key per mount, so a card the user scrolls back past
   * doesn't inflate the count.
   */
  onImpression?: (key: string) => void;
}

export function AdCarousel({ items, onImpression }: AdCarouselProps) {
  const { width } = useWindowDimensions();
  const colors = useColors();
  const cardW = width - 2 * (PEEK + GAP);
  const step = cardW + GAP;
  const n = items.length;
  const loop = n > 1;
  // Three copies so a neighbour always peeks in on both sides, even at the ends.
  const extended = loop ? [...items, ...items, ...items] : items;

  const ref = useRef<ScrollView>(null);
  const lastX = useRef(0);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [dot, setDot] = useState(0);

  /** Snap index at the current offset, re-centered onto the middle copy. */
  const normalize = useCallback(() => {
    if (!loop) return 0;
    let i = Math.round(lastX.current / step);
    if (i < n || i >= 2 * n) {
      i = ((i % n) + n) % n + n;
      ref.current?.scrollTo({ x: i * step, animated: false });
      lastX.current = i * step;
    }
    return i;
  }, [loop, n, step]);

  /** (Re)start auto-advance; every scroll event pushes the next tick back. */
  const startTimer = useCallback(() => {
    if (!loop) return;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      const i = normalize();
      ref.current?.scrollTo({ x: (i + 1) * step, animated: true });
    }, ADVANCE_MS);
  }, [loop, normalize, step]);

  useEffect(() => {
    startTimer();
    return () => clearInterval(timer.current);
  }, [startTimer]);

  // Keys already counted this mount, so scrolling back and forth over the same
  // card reports one view rather than ten.
  const counted = useRef(new Set<string>());
  const count = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || !onImpression) return;
      if (counted.current.has(item.key)) return;
      counted.current.add(item.key);
      onImpression(item.key);
    },
    [items, onImpression],
  );

  // The first card is on screen from the moment the slot renders — nothing has
  // to scroll for it to be seen, so it's counted on mount.
  useEffect(() => {
    counted.current = new Set<string>();
    if (items.length > 0) count(0);
    // Re-arm when the ad list itself changes (a new category, a new location).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    lastX.current = e.nativeEvent.contentOffset.x;
    const i = Math.round(lastX.current / step);
    const at = ((i % n) + n) % n;
    setDot(at);
    count(at);
    startTimer();
  };

  // Center on the middle copy once the (extended) content has laid out.
  const onContentSizeChange = () => {
    if (!loop || initialized.current) return;
    initialized.current = true;
    ref.current?.scrollTo({ x: n * step, animated: false });
    lastX.current = n * step;
  };

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={step}
        disableIntervalMomentum
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={normalize}
        onContentSizeChange={onContentSizeChange}
        contentContainerStyle={styles.row}
      >
        {extended.map((it, idx) => (
          <Pressable
            key={`${it.key}:${idx}`}
            onPress={it.onPress}
            style={({ pressed }) => [{ width: cardW }, pressed && styles.pressed]}
          >
            <View style={styles.card}>
              {/* With a photo the card is the photo, darkened just enough at the
                  bottom for the text to hold. Without one it's the old look:
                  the business's color as a gradient, emoji watermarked in. */}
              {it.imageUrl ? (
                <>
                  <Image source={{ uri: it.imageUrl }} style={styles.photo} resizeMode="cover" />
                  <LinearGradient
                    colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.8)']}
                    style={styles.photo}
                  />
                </>
              ) : (
                <>
                  <LinearGradient
                    colors={it.colors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.photo}
                  />
                  <Text style={styles.emoji}>{it.emoji}</Text>
                </>
              )}

              <View style={styles.content}>
                <View style={styles.topRow}>
                  <View style={styles.tagPill}>
                    <Text variant="caption" weight="bold" tone="inverse">
                      {it.tag}
                    </Text>
                  </View>
                  {/* Never quiet about it: a paid placement is labelled. */}
                  {it.sponsored ? (
                    <View style={styles.sponsoredPill}>
                      <Text variant="caption" weight="semibold" tone="inverse">
                        Sponsored
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.body}>
                  <Text variant="heading" weight="bold" tone="inverse" numberOfLines={3}>
                    {it.title}
                  </Text>
                  {it.description ? (
                    <Text variant="label" tone="inverse" numberOfLines={2} style={styles.desc}>
                      {it.description}
                    </Text>
                  ) : null}
                  {it.price ? (
                    <View style={styles.priceRow}>
                      <Text variant="title" weight="bold" tone="inverse">
                        {it.price}
                      </Text>
                      {it.wasPrice ? (
                        <Text variant="body" tone="inverse" style={styles.wasPrice}>
                          {it.wasPrice}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                <View style={styles.footer}>
                  <Text
                    variant="label"
                    weight="semibold"
                    tone="inverse"
                    numberOfLines={1}
                    style={styles.bizName}
                  >
                    {it.businessName}
                  </Text>
                  {it.distanceLabel ? (
                    <Text variant="caption" tone="inverse" style={styles.distance}>
                      📍 {it.distanceLabel}
                    </Text>
                  ) : null}
                  <Text variant="caption" weight="semibold" tone="inverse">
                    View →
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* One dot per ad (not per rendered copy). */}
      {loop ? (
        <View style={styles.dots}>
          {items.map((it, i) => (
            <View
              key={it.key}
              style={[
                styles.dot,
                { backgroundColor: colors.textMuted, opacity: i === dot ? 1 : 0.3 },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: GAP, paddingHorizontal: PEEK + GAP },
  pressed: { opacity: 0.92 },
  card: {
    height: 280,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  // Both the photo and its scrim fill the card behind the content.
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, padding: spacing.lg },
  emoji: { position: 'absolute', top: 16, right: 18, fontSize: 84, opacity: 0.3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tagPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  sponsoredPill: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  body: { flex: 1, justifyContent: 'flex-end', paddingBottom: spacing.sm },
  desc: { opacity: 0.85, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 2 },
  wasPrice: { opacity: 0.75, textDecorationLine: 'line-through' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.4)',
    paddingTop: spacing.sm,
  },
  bizName: { flexShrink: 1 },
  distance: { opacity: 0.9, flexGrow: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
