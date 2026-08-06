/**
 * Work showcase. The business's photos and videos ride an auto-rotating slider
 * (the same motion as the home screen's deals carousel) — one big frame at a
 * time, wrapping around. Tapping a frame opens the FULL-SCREEN viewer, which is
 * itself a pager: swipe left/right there to walk through the rest of the
 * showcase without going back.
 *
 * Videos can't play inline yet (media is URL-linked until uploads land), so a
 * video frame shows its thumbnail with a play badge and opens the watch link.
 */
import { useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import type { PortfolioItem } from '@/domain/types';
import { AutoCarousel, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const SLIDE_H = 210;

export function PortfolioGallery({ items }: { items: PortfolioItem[] }) {
  const colors = useColors();
  const [openAt, setOpenAt] = useState<number | null>(null);

  return (
    <View>
      <AutoCarousel
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item, index) => (
          <Pressable
            onPress={() => setOpenAt(index)}
            style={({ pressed }) => [styles.slide, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={item.title ?? (item.kind === 'video' ? 'Watch video' : 'View photo')}
          >
            <Image
              source={{ uri: item.thumbnailUrl ?? item.url }}
              style={[styles.slideImage, { backgroundColor: colors.surfaceAlt }]}
              resizeMode="cover"
            />
            {item.kind === 'video' ? (
              <View style={styles.playBadge}>
                <Text style={styles.playIcon}>▶</Text>
              </View>
            ) : null}
            {item.title ? (
              <View style={styles.caption}>
                <Text variant="label" weight="semibold" tone="inverse" numberOfLines={1}>
                  {item.title}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />

      {openAt !== null ? (
        <ShowcaseViewer items={items} startIndex={openAt} onClose={() => setOpenAt(null)} />
      ) : null}
    </View>
  );
}

/**
 * Full-screen pager over the whole showcase. Opens on the tapped item and
 * swipes horizontally through the rest; the counter tracks where you are.
 */
function ShowcaseViewer({
  items,
  startIndex,
  onClose,
}: {
  items: PortfolioItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);
  const ref = useRef<ScrollView>(null);
  const positioned = useRef(false);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const current = items[index];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          // scrollTo only sticks once the pages exist, so we place the start
          // frame on the first content-size callback.
          onContentSizeChange={() => {
            if (positioned.current) return;
            positioned.current = true;
            ref.current?.scrollTo({ x: startIndex * width, animated: false });
          }}
        >
          {items.map((item) => (
            <View key={item.id} style={{ width, height }}>
              <Pressable style={styles.page} onPress={onClose}>
                <Image
                  source={{ uri: item.thumbnailUrl ?? item.url }}
                  style={{ width, height: height * 0.62 }}
                  resizeMode="contain"
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {/* Overlay chrome — kept outside the pager so it never scrolls away. */}
        <Pressable onPress={onClose} style={styles.close} hitSlop={10} accessibilityLabel="Close">
          <Text weight="bold" tone="inverse">
            ✕
          </Text>
        </Pressable>

        <View style={styles.viewerFooter} pointerEvents="box-none">
          {items.length > 1 ? (
            <Text variant="caption" tone="inverse" style={styles.counter}>
              {index + 1} / {items.length}
            </Text>
          ) : null}
          {current?.title ? (
            <Text weight="semibold" tone="inverse" style={styles.viewerText}>
              {current.title}
            </Text>
          ) : null}
          {current?.description ? (
            <Text variant="label" tone="inverse" style={[styles.viewerText, styles.viewerDesc]}>
              {current.description}
            </Text>
          ) : null}
          {current?.kind === 'video' ? (
            <Pressable
              onPress={() => Linking.openURL(current.url).catch(() => {})}
              style={styles.watchBtn}
            >
              <Text variant="label" weight="bold" tone="inverse">
                ▶ Watch video
              </Text>
            </Pressable>
          ) : null}
          <Text variant="caption" tone="inverse" style={styles.hint}>
            {items.length > 1 ? 'Swipe for more · tap the photo to close' : 'Tap the photo to close'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  slide: { borderRadius: radius.lg, overflow: 'hidden' },
  pressed: { opacity: 0.9 },
  slideImage: { width: '100%', height: SLIDE_H },
  playBadge: {
    position: 'absolute',
    top: SLIDE_H / 2 - 24,
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#FFFFFF', fontSize: 18, marginLeft: 3 },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerFooter: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxl,
    alignItems: 'center',
  },
  counter: { opacity: 0.75, marginBottom: spacing.sm },
  viewerText: { textAlign: 'center' },
  viewerDesc: { opacity: 0.85, marginTop: spacing.xs },
  watchBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  hint: { opacity: 0.55, marginTop: spacing.lg },
});
