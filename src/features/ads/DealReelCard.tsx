/**
 * ONE PAGE OF THE DEALS FEED — a single offer, filling the screen.
 *
 * The Home carousel shows four cards in a strip and asks for a glance. This
 * asks for attention: one deal at a time, edge to edge, the way a reel does.
 * The same `AdPlacement` feeds both, so a business writes one offer and gets
 * both surfaces; what changes here is that a VIDEO, if the business filmed one,
 * plays instead of the photo sitting still.
 *
 * Playback rules, learned from every feed that gets this wrong:
 *   - only the page actually on screen plays (`active`). Two videos playing at
 *     once is a bug you hear before you see.
 *   - leaving a page rewinds it, so scrolling back starts the ad from the top
 *     rather than at the three seconds where it was abandoned.
 *   - MUTED by default, and the toggle is the viewer's, held by the feed so it
 *     stays chosen as they scroll. Sound that starts by itself is the fastest
 *     way to make someone close the app — and on web, autoplay with sound is
 *     blocked outright, so it wouldn't even work.
 */
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { AdPlacement } from '@/data/repositories';
import { formatDistance, getType } from '@/domain/catalog';
import { Text } from '@/components/ui';
import { radius, spacing } from '@/theme/theme';
import { AD_GRADIENTS } from './adGradients';

export interface DealReelCardProps {
  placement: AdPlacement;
  /** This is the page on screen — the only one allowed to play. */
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  /** Exact page height, so one swipe moves exactly one deal. */
  height: number;
  /** Open the business behind the ad (counts as the tap the business bought). */
  onOpen: () => void;
  /** Start an order, when there's anything to order. */
  onOrder?: () => void;
  onShare: () => void;
}

export function DealReelCard({
  placement,
  active,
  muted,
  onToggleMute,
  height,
  onOpen,
  onOrder,
  onShare,
}: DealReelCardProps) {
  const { business, offer, campaign, distanceKm } = placement;
  const emoji = offer.emoji ?? getType(business.type)?.icon ?? '🏷️';
  const gradient = AD_GRADIENTS[business.type];
  const distanceLabel = formatDistance(distanceKm);

  // A player exists only for a page that actually has a video: the feed keeps a
  // few pages mounted either side of the visible one, and idle players are the
  // expensive part of a video feed.
  const player = useVideoPlayer(offer.videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!offer.videoUrl) return;
    if (active) player.play();
    else {
      player.pause();
      // Back to the start, so a second look is the whole ad again.
      player.currentTime = 0;
    }
  }, [active, player, offer.videoUrl]);

  useEffect(() => {
    if (offer.videoUrl) player.muted = muted;
  }, [muted, player, offer.videoUrl]);

  return (
    <View style={[styles.page, { height }]}>
      {/* ── The creative ── video, else photo, else the business's gradient. */}
      {offer.videoUrl ? (
        <VideoView
          player={player}
          // NOT StyleSheet.absoluteFill: on web the <video> is a replaced
          // element, and left/right/top/bottom leave it at its intrinsic size —
          // a 16:9 clip then sits letterboxed at the top of the page with
          // `contentFit` having nothing to work on. Explicit 100%/100% is what
          // gives cover something to fill.
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />
      ) : offer.imageUrl ? (
        <Image source={{ uri: offer.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.watermark}>{emoji}</Text>
        </>
      )}

      {/* Text sits on whatever the creative happens to be, so it needs its own
          ground: dark at the bottom where the copy is, clear in the middle. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
        locations={[0, 0.28, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* ── Labels ── */}
      <View style={styles.topRow} pointerEvents="none">
        {offer.tag ? (
          <View style={styles.tagPill}>
            <Text variant="caption" weight="bold" tone="inverse">
              {offer.tag}
            </Text>
          </View>
        ) : null}
        {/* Never quiet about a paid placement. */}
        {campaign ? (
          <View style={styles.sponsoredPill}>
            <Text variant="caption" weight="semibold" tone="inverse">
              Sponsored
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── The side rail ── the small, repeatable actions. */}
      <View style={styles.rail}>
        {offer.videoUrl ? (
          <Pressable onPress={onToggleMute} style={styles.railBtn} hitSlop={8}>
            <Text style={styles.railIcon}>{muted ? '🔇' : '🔊'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onShare} style={styles.railBtn} hitSlop={8}>
          <Text style={styles.railIcon}>📤</Text>
        </Pressable>
      </View>

      {/* ── The copy ── */}
      <View style={styles.body}>
        <Pressable onPress={onOpen}>
          <Text variant="caption" weight="semibold" tone="inverse" style={styles.business}>
            {emoji}  {business.name}
            {distanceLabel ? `  ·  📍 ${distanceLabel}` : ''}
          </Text>
        </Pressable>

        <Text variant="title" weight="bold" tone="inverse" numberOfLines={2}>
          {offer.title}
        </Text>

        {offer.description ? (
          <Text variant="label" tone="inverse" numberOfLines={2} style={styles.description}>
            {offer.description}
          </Text>
        ) : null}

        {offer.price ? (
          <View style={styles.priceRow}>
            <Text variant="heading" weight="bold" tone="inverse">
              {offer.price}
            </Text>
            {offer.wasPrice ? (
              <Text variant="body" tone="inverse" style={styles.wasPrice}>
                {offer.wasPrice}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable onPress={onOpen} style={[styles.cta, styles.ctaPrimary]}>
            <Text variant="label" weight="bold">
              View business
            </Text>
          </Pressable>
          {onOrder ? (
            <Pressable onPress={onOrder} style={[styles.cta, styles.ctaGhost]}>
              <Text variant="label" weight="bold" tone="inverse">
                🛒 Order
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  watermark: {
    position: 'absolute',
    alignSelf: 'center',
    top: '32%',
    fontSize: 140,
    opacity: 0.35,
  },
  topRow: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tagPill: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  sponsoredPill: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rail: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 190,
    gap: spacing.md,
    alignItems: 'center',
  },
  railBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  railIcon: { fontSize: 20 },
  body: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    gap: spacing.xs,
  },
  business: { opacity: 0.95, marginBottom: spacing.xs },
  description: { opacity: 0.88 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  wasPrice: { opacity: 0.75, textDecorationLine: 'line-through' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cta: {
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  ctaPrimary: { backgroundColor: '#fff' },
  ctaGhost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
});
