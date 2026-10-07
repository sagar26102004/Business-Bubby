/**
 * ONE PAGE OF THE DEALS FEED — a single offer, filling the screen.
 *
 * The Home carousel shows four cards in a strip and asks for a glance. This
 * asks for attention: one deal at a time, edge to edge, the way a reel does.
 * The same `AdPlacement` feeds both, so a business writes one offer and gets
 * both surfaces; what changes here is that a VIDEO, if the business filmed one,
 * plays instead of the photo sitting still.
 *
 * Layout follows the One Place "flash reels" mockup: the creative full-bleed
 * under a dark sage vignette; a deal pill (tag + countdown), the business line,
 * the offer, its price and saving and the business's tags bottom-left; a side
 * rail (business avatar, share, directions, call); then "View business" beside
 * the terracotta "Claim offer", and a peek at the next deal under them.
 * Left out on purpose, as in docs/redesign-one-place/NOTES.md: the verified
 * tick, bookmark counts and voucher codes — no data backs any of them.
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
import type { Business, Offer } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { openState } from '@/domain/hours';
import { formatMoney, parsePrice } from '@/lib/money';
import { Icon, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { AD_GRADIENTS } from './adGradients';

/**
 * The feed's own dark palette. The reel sits on someone's photo or video, not
 * on the app's linen paper, so its chrome is the mockup's inverse surface — a
 * near-black sage — with light text, whichever color scheme the app is in.
 */
export const REEL = {
  ground: '#28332C',
  glass: 'rgba(40,51,44,0.6)',
  glassLight: 'rgba(255,255,255,0.14)',
  border: 'rgba(192,201,193,0.3)',
  text: '#FFFFFF',
  muted: '#D9E6DB',
  mint: '#A1D1B4',
  amber: '#FFDDAF',
  star: '#FFBA44',
  flame: '#FD8367',
  onFlame: '#3D0600',
} as const;

export interface DealReelCardProps {
  placement: AdPlacement;
  /** This is the page on screen — the only one allowed to play. */
  active: boolean;
  muted: boolean;
  /** Exact page height, so one swipe moves exactly one deal. */
  height: number;
  /** Room the floating top bar takes, so the page's own labels clear it. */
  topInset: number;
  /** Room the system bar takes at the bottom. */
  bottomInset: number;
  /** Open the business behind the ad (counts as the tap the business bought). */
  onOpen: () => void;
  /** Start an order for this offer, when there's anything to order. */
  onOrder?: () => void;
  onShare: () => void;
  onCall: () => void;
  onDirections?: () => void;
  /** The deal after this one, for the "Next deal" peek. */
  next?: AdPlacement;
  onNext?: () => void;
}

export function DealReelCard({
  placement,
  active,
  muted,
  height,
  topInset,
  bottomInset,
  onOpen,
  onOrder,
  onShare,
  onCall,
  onDirections,
  next,
  onNext,
}: DealReelCardProps) {
  const colors = useColors();
  const { business, offer, campaign, distanceKm } = placement;
  const emoji = offer.emoji ?? getType(business.type)?.icon ?? '🏷️';
  const gradient = AD_GRADIENTS[business.type];
  const distanceLabel = formatDistance(distanceKm);
  const { open } = openState(business);
  const where = areaLabel(business);
  const saving = savingLabel(offer);
  const dealLine = [offer.tag, endsInLabel(offer.endsAt)].filter(Boolean).join(' · ');
  const tags = (business.tags ?? []).slice(0, 3);

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
          ground: tinted at the top under the bar, clear in the middle, the
          feed's dark sage under the copy. */}
      <LinearGradient
        colors={['rgba(40,51,44,0.7)', 'rgba(40,51,44,0)', 'rgba(40,51,44,0.6)', REEL.ground]}
        locations={[0, 0.22, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Never quiet about a paid placement. */}
      {campaign ? (
        <View style={[styles.sponsored, { top: topInset }]} pointerEvents="none">
          <Text variant="caption" weight="semibold" style={{ color: REEL.muted }}>
            Sponsored
          </Text>
        </View>
      ) : null}

      {/* ── The side rail ── the small, repeatable actions. */}
      <View style={[styles.rail, { bottom: bottomInset + (next ? 150 : 90) }]}>
        <Pressable onPress={onOpen} hitSlop={6} style={styles.avatar}>
          {business.coverImageUrl ? (
            <Image source={{ uri: business.coverImageUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarEmoji}>{getType(business.type)?.icon ?? '🏪'}</Text>
          )}
        </Pressable>
        <RailButton icon="share" label="Share" onPress={onShare} />
        {onDirections ? (
          <RailButton
            icon="directions"
            label={distanceLabel ?? 'Route'}
            onPress={onDirections}
            tint={REEL.mint}
          />
        ) : null}
        <RailButton icon="phone" label="Call" onPress={onCall} />
      </View>

      {/* ── The copy ── */}
      <View style={[styles.bottom, { paddingBottom: bottomInset + spacing.md }]}>
        <View style={styles.copy}>
          {dealLine ? (
            <View style={styles.dealPill}>
              <Icon name="bolt" size={14} color={REEL.onFlame} />
              <Text variant="caption" weight="bold" style={{ color: REEL.onFlame }}>
                {dealLine.toUpperCase()}
              </Text>
            </View>
          ) : null}

          <Pressable onPress={onOpen}>
            <Text variant="subheading" weight="bold" style={{ color: REEL.text }} numberOfLines={1}>
              {business.name}
            </Text>
          </Pressable>

          <View style={styles.meta}>
            {open !== undefined ? (
              <View style={styles.metaItem}>
                <View style={[styles.dot, { backgroundColor: open ? REEL.mint : REEL.flame }]} />
                <Text variant="caption" style={{ color: open ? REEL.mint : REEL.flame }}>
                  {open ? 'Open now' : 'Closed'}
                </Text>
              </View>
            ) : null}
            {distanceLabel || where ? (
              <Text variant="caption" style={{ color: REEL.muted }} numberOfLines={1}>
                {[distanceLabel && `${distanceLabel} away`, where].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {business.ratingCount ? (
              <Text variant="caption" weight="bold" style={{ color: REEL.star }}>
                ★ {(business.ratingAvg ?? 0).toFixed(1)} ({business.ratingCount})
              </Text>
            ) : null}
          </View>

          <Text variant="heading" weight="bold" style={{ color: REEL.text }} numberOfLines={2}>
            {offer.title}
          </Text>

          {offer.description ? (
            <Text variant="label" style={{ color: REEL.muted }} numberOfLines={2}>
              {offer.description}
            </Text>
          ) : null}

          {offer.price ? (
            <View style={styles.priceRow}>
              <Text weight="bold" style={styles.price}>
                {offer.price}
              </Text>
              {offer.wasPrice ? (
                <Text variant="body" style={styles.wasPrice}>
                  {offer.wasPrice}
                </Text>
              ) : null}
              {saving ? (
                <View style={styles.save}>
                  <Text variant="caption" weight="bold" style={{ color: REEL.mint }}>
                    Save {saving}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.map((t) => (
                <View key={t} style={styles.tagChip}>
                  <Text variant="caption" style={{ color: REEL.muted }}>
                    #{t.replace(/\s+/g, '')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Doors ── one secondary, one terracotta "go buy it". */}
        <View style={styles.actions}>
          <Pressable onPress={onOpen} style={[styles.cta, styles.ctaGhost, onOrder && styles.ctaNarrow]}>
            <Icon name="store" size={18} color={REEL.text} />
            <Text variant="label" weight="bold" style={{ color: REEL.text }}>
              View business
            </Text>
          </Pressable>
          {onOrder ? (
            <Pressable onPress={onOrder} style={[styles.cta, styles.ctaWide, { backgroundColor: colors.cta }]}>
              <Text variant="label" weight="bold" style={{ color: '#fff' }}>
                Claim offer
              </Text>
              <Icon name="arrowRight" size={18} color="#fff" />
            </Pressable>
          ) : null}
        </View>

        {/* ── Next deal ── the swipe-up affordance, and a tap does the swipe. */}
        {next ? (
          <Pressable onPress={onNext} style={styles.peek}>
            <View style={styles.peekThumb}>
              {next.offer.imageUrl ? (
                <Image source={{ uri: next.offer.imageUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.peekEmoji}>
                  {next.offer.emoji ?? getType(next.business.type)?.icon ?? '🏷️'}
                </Text>
              )}
            </View>
            <View style={styles.peekText}>
              <View style={styles.peekTop}>
                <View style={styles.nextBadge}>
                  <Text weight="bold" style={styles.nextBadgeText}>NEXT DEAL</Text>
                </View>
                <Text variant="caption" style={{ color: REEL.muted, flexShrink: 1 }} numberOfLines={1}>
                  {next.business.name}
                </Text>
              </View>
              <Text variant="caption" weight="bold" style={{ color: REEL.text }} numberOfLines={1}>
                {next.offer.title}
                {formatDistance(next.distanceKm) ? ` · ${formatDistance(next.distanceKm)}` : ''}
              </Text>
            </View>
            <Icon name="chevronDown" size={18} color={REEL.mint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function RailButton({
  icon,
  label,
  onPress,
  tint = REEL.text,
}: {
  icon: 'share' | 'directions' | 'phone';
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.railItem}>
      <View style={styles.railBtn}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <Text variant="caption" weight="bold" style={styles.railLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Where the business is, short: the street line, or only the area when the
 * owner asked for the exact address to stay private.
 */
function areaLabel(business: Business): string | undefined {
  const loc = business.location;
  if (!loc) return undefined;
  if (loc.hidePreciseLocation || loc.isHome) return loc.city ?? loc.region;
  return loc.addressLine ?? loc.city;
}

/** "₹101" off, when both prices read as money and the deal is cheaper. */
function savingLabel(offer: Offer): string | undefined {
  const now = parsePrice(offer.price);
  const was = parsePrice(offer.wasPrice);
  if (now === undefined || was === undefined || was <= now) return undefined;
  return formatMoney(was - now);
}

/** "Ends in 2h 45m" while it's close, "Ends in 3 days" further out. */
export function endsInLabel(endsAt?: string, now: number = Date.now()): string | undefined {
  if (!endsAt) return undefined;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `Ends in ${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Ends in ${hours}h ${mins % 60}m`;
  const days = Math.round(hours / 24);
  return `Ends in ${days} day${days === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  page: { width: '100%', backgroundColor: REEL.ground, overflow: 'hidden' },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  watermark: {
    position: 'absolute',
    alignSelf: 'center',
    top: '26%',
    fontSize: 140,
    opacity: 0.35,
  },
  sponsored: {
    position: 'absolute',
    right: spacing.md,
    backgroundColor: REEL.glass,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rail: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
    zIndex: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: REEL.mint,
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarEmoji: { fontSize: 24 },
  railItem: { alignItems: 'center', gap: 2 },
  railBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40,51,44,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  railLabel: { color: REEL.text, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  copy: { maxWidth: '80%', gap: spacing.xs },
  dealPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: REEL.flame,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginBottom: spacing.xs,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  price: { fontSize: 26, lineHeight: 32, color: REEL.amber },
  wasPrice: { color: REEL.muted, textDecorationLine: 'line-through' },
  save: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(161,209,180,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(161,209,180,0.4)',
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: REEL.glass,
    borderWidth: 1,
    borderColor: REEL.border,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cta: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  // The mockup's 2 : 3 split — the door that buys is the bigger one.
  ctaNarrow: { flex: 2 },
  ctaWide: { flex: 3 },
  ctaGhost: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  peek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 10,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  peekThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: REEL.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekEmoji: { fontSize: 20 },
  peekText: { flex: 1, minWidth: 0, gap: 1 },
  peekTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextBadge: {
    backgroundColor: 'rgba(161,62,40,0.6)',
    borderRadius: 4,
    paddingHorizontal: 5,
  },
  nextBadgeText: { fontSize: 10, lineHeight: 14, color: '#FFDAD2' },
});
