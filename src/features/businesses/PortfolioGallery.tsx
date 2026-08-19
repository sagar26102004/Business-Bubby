/**
 * Work showcase. The business's photos and videos ride an auto-rotating slider
 * (the same motion as the home screen's deals carousel) — one big frame at a
 * time, wrapping around. Tapping a frame opens the FULL-SCREEN viewer, which is
 * itself a pager: swipe left/right there to walk through the rest of the
 * showcase without going back.
 *
 * NO CAPTIONS. A showcase is pictures of work — the haircut, the mandap, the
 * FSSAI certificate on the wall — and a picture of work explains itself. The
 * editor stopped asking for titles and descriptions, and this stopped drawing
 * the space they used to sit in.
 *
 * Videos UPLOADED to us are files, so they play right here, muted in the strip
 * and with controls in the viewer. LEGACY items (the seeded ones) point at a
 * YouTube page instead of a video file — `isPlayableVideo` spots those and they
 * keep the old behaviour: a thumbnail that opens the watch link.
 */
import { useEffect, useRef, useState } from 'react';
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
import { useVideoPlayer, VideoView } from 'expo-video';
import type { PortfolioItem } from '@/domain/types';
import { isPlayableVideo } from '@/domain/showcase';
import { AutoCarousel, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const SLIDE_H = 210;

export function PortfolioGallery({ items }: { items: PortfolioItem[] }) {
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
            accessibilityLabel={item.kind === 'video' ? 'Watch video' : 'View photo'}
          >
            <SlideMedia item={item} />
          </Pressable>
        )}
      />

      {openAt !== null ? (
        <ShowcaseViewer items={items} startIndex={openAt} onClose={() => setOpenAt(null)} />
      ) : null}
    </View>
  );
}

/** One frame of the strip: the photo, or a video sitting on its first frame. */
function SlideMedia({ item }: { item: PortfolioItem }) {
  const colors = useColors();
  const playable = item.kind === 'video' && isPlayableVideo(item.url);
  const player = useVideoPlayer(playable ? item.url : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  return (
    <>
      {playable ? (
        <VideoView player={player} style={styles.slideImage} nativeControls={false} contentFit="cover" />
      ) : (
        <Image
          source={{ uri: item.thumbnailUrl ?? item.url }}
          style={[styles.slideImage, { backgroundColor: colors.surfaceAlt }]}
          resizeMode="cover"
        />
      )}
      {item.kind === 'video' ? (
        <View style={styles.playBadge}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
      ) : null}
    </>
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
  const currentIsLink = current?.kind === 'video' && !isPlayableVideo(current.url);

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
          {items.map((item, i) => (
            <View key={item.id} style={{ width, height }}>
              <ViewerPage
                item={item}
                active={i === index}
                width={width}
                height={height}
                onClose={onClose}
              />
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
          {currentIsLink ? (
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
            {items.length > 1 ? 'Swipe for more · tap to close' : 'Tap to close'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One full-screen page. An uploaded video plays with controls, and ONLY while
 * it's the page on screen — two videos playing at once is a bug you hear before
 * you see it. Leaving a page rewinds it, so swiping back starts it from the top.
 */
function ViewerPage({
  item,
  active,
  width,
  height,
  onClose,
}: {
  item: PortfolioItem;
  active: boolean;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const playable = item.kind === 'video' && isPlayableVideo(item.url);
  const player = useVideoPlayer(playable ? item.url : null, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (!playable) return;
    if (active) player.play();
    else {
      player.pause();
      player.currentTime = 0;
    }
  }, [active, playable, player]);

  if (playable) {
    return (
      <View style={styles.page}>
        <VideoView
          player={player}
          style={{ width, height: height * 0.62 }}
          contentFit="contain"
        />
      </View>
    );
  }

  return (
    <Pressable style={styles.page} onPress={onClose}>
      <Image
        source={{ uri: item.thumbnailUrl ?? item.url }}
        style={{ width, height: height * 0.62 }}
        resizeMode="contain"
      />
    </Pressable>
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
  watchBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  hint: { opacity: 0.55, marginTop: spacing.lg },
});
