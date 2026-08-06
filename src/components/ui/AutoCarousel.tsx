/**
 * Auto-rotating, circular carousel. One card sits centered with a sliver of the
 * previous and next peeking in at the edges; the list wraps around and advances
 * on a fixed interval until the viewer scrolls (each scroll pushes the next
 * tick back). Powers the work showcase and the reviews slider — the same motion
 * the home screen's deals carousel has.
 *
 * Looping trick: with 2+ items the cards render three times and the scroll
 * offset is silently re-centered onto the middle copy — a jump of exactly one
 * copy-width lands on identical pixels, so the correction is invisible.
 *
 * The carousel measures itself (`onLayout`), so callers don't have to know how
 * wide the column is — it works inside the centered web layout unchanged.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { spacing, useColors } from '@/theme/theme';

export interface AutoCarouselProps<T> {
  items: T[];
  /** Renders one card. `index` is the real index in `items`, never a copy's. */
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  /** Time between automatic advances. */
  intervalMs?: number;
  /** How much of each neighbouring card peeks in at the edge. */
  peek?: number;
  gap?: number;
  showDots?: boolean;
}

export function AutoCarousel<T>({
  items,
  renderItem,
  keyExtractor,
  intervalMs = 4500,
  peek = 20,
  gap = spacing.md,
  showDots = true,
}: AutoCarouselProps<T>) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [dot, setDot] = useState(0);

  const n = items.length;
  const cardW = Math.max(0, width - 2 * (peek + gap));
  const step = cardW + gap;
  const loop = n > 1 && step > 0;
  // Three copies so a neighbour always peeks in on both sides, even at the ends.
  const extended = loop ? [...items, ...items, ...items] : items;

  const ref = useRef<ScrollView>(null);
  const lastX = useRef(0);
  const needsCenter = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /** Park the scroll offset on the first card of the middle copy. */
  const center = useCallback(() => {
    if (!loop) return;
    ref.current?.scrollTo({ x: n * step, animated: false });
    lastX.current = n * step;
    setDot(0);
  }, [loop, n, step]);

  /** Snap index at the current offset, re-centered onto the middle copy. */
  const normalize = useCallback(() => {
    if (!loop) return 0;
    let i = Math.round(lastX.current / step);
    if (i < n || i >= 2 * n) {
      i = (((i % n) + n) % n) + n;
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
    }, intervalMs);
  }, [loop, normalize, step, intervalMs]);

  useEffect(() => {
    startTimer();
    return () => clearInterval(timer.current);
  }, [startTimer]);

  // A new item set (e.g. reviews filtered to 4★) starts from the first card.
  // Keyed on the item KEYS, not the array's identity: a parent re-render that
  // rebuilds the same list must not yank the carousel back mid-scroll.
  const signature = items.map(keyExtractor).join('|');
  useEffect(() => {
    needsCenter.current = true;
    center();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, center]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== width) setWidth(w);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    lastX.current = e.nativeEvent.contentOffset.x;
    if (step > 0) {
      const i = Math.round(lastX.current / step);
      setDot(((i % n) + n) % n);
    }
    startTimer();
  };

  // The first layout (and every content change) lands the offset on the middle
  // copy — scrollTo before the content exists would be dropped.
  const onContentSizeChange = () => {
    if (!needsCenter.current) return;
    needsCenter.current = false;
    center();
  };

  if (n === 0) return null;

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
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
          contentContainerStyle={{ gap, paddingHorizontal: peek + gap }}
        >
          {extended.map((item, idx) => {
            const real = idx % n;
            return (
              <View key={`${keyExtractor(item, real)}:${idx}`} style={{ width: cardW }}>
                {renderItem(item, real)}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* One dot per item (not per rendered copy). */}
      {showDots && loop ? (
        <View style={styles.dots}>
          {items.map((item, i) => (
            <View
              key={keyExtractor(item, i)}
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
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
