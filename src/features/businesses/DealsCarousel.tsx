/**
 * "Deals near you" carousel. One tall deal card sits centered with a sliver of
 * the previous and next cards peeking in at the edges; the list wraps around
 * (circular) and auto-advances. Tapping a card opens the business behind it.
 *
 * Looping trick: with 2+ deals the items render three times and the scroll
 * position is silently re-centered onto the middle copy — a jump of exactly
 * one copy-width lands on identical pixels, so the correction is invisible.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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

export interface DealCardItem {
  key: string;
  /** Shout label, e.g. "NEW COMBO", "40% OFF". */
  tag: string;
  /** What the deal is, e.g. "Flat white + banana bread". */
  title: string;
  description?: string;
  price?: string;
  wasPrice?: string;
  emoji: string;
  businessName: string;
  distanceLabel?: string;
  colors: [string, string];
  onPress: () => void;
}

/** How much of each neighbouring card peeks in at the screen edge. */
const PEEK = 24;
const GAP = spacing.md;
const ADVANCE_MS = 4200;

export function DealsCarousel({ items }: { items: DealCardItem[] }) {
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

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    lastX.current = e.nativeEvent.contentOffset.x;
    const i = Math.round(lastX.current / step);
    setDot(((i % n) + n) % n);
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
            <LinearGradient
              colors={it.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.card}
            >
              <Text style={styles.emoji}>{it.emoji}</Text>

              <View style={styles.tagPill}>
                <Text variant="caption" weight="bold" tone="inverse">
                  {it.tag}
                </Text>
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
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>

      {/* One dot per deal (not per rendered copy). */}
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
    padding: spacing.lg,
    overflow: 'hidden',
  },
  emoji: { position: 'absolute', top: 16, right: 18, fontSize: 84, opacity: 0.3 },
  tagPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
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
