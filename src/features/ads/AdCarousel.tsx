/**
 * THE AD SLOT — the rotating card carousel on Home, under the category strip.
 * Each card is a tall POSTER: the offer's photo edge to edge, and nothing on it
 * but the store's name at the bottom (and "Sponsored" when it's paid for).
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
import { useCallback, useEffect, useRef } from 'react';
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
  // Narrow deal cards so the next one peeks in, like a stack of circulars.
  const cardW = Math.min(width - 2 * (PEEK + GAP), 300);
  // Portrait, like a poster on a wall: 4 wide to 5 tall.
  const cardH = Math.round(cardW * 1.25);
  const step = cardW + GAP;
  const n = items.length;
  const loop = n > 1;
  // Three copies so a neighbour always peeks in on both sides, even at the ends.
  const extended = loop ? [...items, ...items, ...items] : items;

  const ref = useRef<ScrollView>(null);
  const lastX = useRef(0);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

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
            // The poster shows only the name; a screen reader gets the offer too.
            accessibilityRole="button"
            accessibilityLabel={`${it.title}, ${it.businessName}`}
            style={({ pressed }) => [{ width: cardW }, pressed && styles.pressed]}
          >
            <View style={[styles.card, { height: cardH, backgroundColor: colors.surfaceAlt }]}>
              {/* A poster: the offer's photo fills the card (or the business's
                  gradient + emoji when there's no photo), and the only words on
                  it are the store's name at the bottom. */}
              {it.imageUrl ? (
                <Image source={{ uri: it.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <LinearGradient
                  colors={it.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFill, styles.fallback]}
                >
                  <Text style={styles.emoji}>{it.emoji}</Text>
                </LinearGradient>
              )}
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
                locations={[0.6, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              {/* Never quiet about it: a paid placement is labelled. */}
              {it.sponsored ? (
                <View style={styles.sponsoredPill}>
                  <Text variant="caption" weight="semibold" style={styles.onPoster}>
                    Sponsored
                  </Text>
                </View>
              ) : null}
              <Text variant="subheading" weight="bold" numberOfLines={1} style={[styles.name, styles.onPoster]}>
                {it.businessName}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: GAP, paddingHorizontal: PEEK + GAP },
  pressed: { opacity: 0.85 },
  card: { borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'flex-end' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 72, lineHeight: 84 },
  sponsoredPill: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  onPoster: { color: '#fff' },
  name: { margin: spacing.md, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
});
