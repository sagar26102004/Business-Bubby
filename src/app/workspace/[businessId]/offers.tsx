/**
 * Workspace › Offers — the business's own promotions, as a list.
 *
 * Two stats (Active — offers live right now; Views — how often customers saw
 * them, with today's count), tabs for Live now · Scheduled · Past / Expired,
 * and one card per offer: status + badge, the photo or reel, price with the
 * struck-through "was" and the saving, when it ends (or starts), its view
 * count, and Edit. Creating and editing — and pausing or promoting — happen on
 * the offer's own screen, `./offer` (`?offer=<id>` to edit).
 *
 * Views are real: counted once per viewer session on the business page and in
 * the deals feed (features/businesses/offerViews.ts → `offer_views`, migration
 * 0025). There is no "claimed" figure: offers don't record claims.
 *
 * Access-gated: the owner grants "Offers" per member on the Access screen.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { Offer, OfferViewStats } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { SuperAdminBanner } from '@/features/businesses/SuperAdminBanner';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { thumbUrl } from '@/lib/media';
import {
  BottomActionBar,
  Button,
  EmptyView,
  ErrorView,
  Icon,
  LoadingView,
  Screen,
  SegmentedControl,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import {
  offerEndsLabel,
  offerSavingPercent,
  offerStatus,
} from '@/features/businesses/offerUtils';

type Tab = 'live' | 'scheduled' | 'past';

const editorHref = (businessId: string, offerId?: string): Href =>
  (offerId
    ? `/workspace/${businessId}/offer?offer=${encodeURIComponent(offerId)}`
    : `/workspace/${businessId}/offer`) as Href;

const views = (n: number): string => `${n} ${n === 1 ? 'view' : 'views'}`;

export default function WorkspaceOffersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('live');

  const { data, loading, error, reload, refresh } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canUse = canAccessService(business, meEmployee, currentUser, 'offers');
    // Counts are a nice-to-have on this screen — never let them blank it.
    const stats: OfferViewStats[] = canUse
      ? await repos.businesses.listOfferViews(business.id).catch(() => [])
      : [];
    return { business, isMember, canUse, stats };
  }, [businessId, currentUser?.id]);

  // Coming back from the editor: show what was just saved.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) refresh();
      focusedOnce.current = true;
    }, [refresh]),
  );

  const business = data?.business;
  const offers = useMemo(
    () => [...(business?.offers ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [business?.offers],
  );
  const byTab = useMemo(() => {
    const now = Date.now();
    const out: Record<Tab, Offer[]> = { live: [], scheduled: [], past: [] };
    offers.forEach((o) => {
      const s = offerStatus(o, now);
      out[s === 'live' ? 'live' : s === 'scheduled' ? 'scheduled' : 'past'].push(o);
    });
    return out;
  }, [offers]);
  const statsById = useMemo(
    () => new Map((data?.stats ?? []).map((s) => [s.offerId, s])),
    [data?.stats],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !business) return <EmptyView title="Not found" />;

  if (!data.isMember || !data.canUse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Offers' }} />
        <EmptyView
          title={data.isMember ? 'No access' : 'Members only'}
          subtitle={
            data.isMember
              ? 'Ask the owner to grant you “Offers” on the Team & access screen.'
              : `You're not part of ${business.name}.`
          }
        />
      </Screen>
    );
  }

  // Only offers still on the business count — a deleted offer's views go with it.
  let totalViews = 0;
  let todayViews = 0;
  offers.forEach((o) => {
    const s = statsById.get(o.id);
    totalViews += s?.total ?? 0;
    todayViews += s?.today ?? 0;
  });

  const shown = byTab[tab];
  const liveWithoutReel = byTab.live.some((o) => !o.videoUrl);

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: 'Offers',
          headerRight: () => (
            <Button
              title="New Offer"
              icon="plus"
              size="sm"
              onPress={() => router.push(editorHref(business.id))}
            />
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {currentUser?.id !== business.ownerId && isSuperAdminUser(currentUser) ? (
          <SuperAdminBanner businessName={business.name} what="offers" />
        ) : null}

        <Text tone="muted">Manage your local discounts and instant deals.</Text>

        <View style={[styles.stats, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.stat}>
            <Text variant="caption" tone="muted" style={styles.eyebrow}>
              Active
            </Text>
            <View style={styles.statValueRow}>
              <Text variant="title" weight="bold">
                {byTab.live.length}
              </Text>
              {byTab.live.length > 0 ? (
                <View style={[styles.statDot, { backgroundColor: colors.success }]} />
              ) : null}
            </View>
            <Text variant="caption" tone="muted">
              Deals live now
            </Text>
          </View>
          <View style={[styles.statRule, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text variant="caption" tone="muted" style={styles.eyebrow}>
              Views
            </Text>
            <Text variant="title" weight="bold">
              {totalViews}
            </Text>
            <Text
              variant="caption"
              tone={todayViews > 0 ? 'success' : 'muted'}
              weight={todayViews > 0 ? 'semibold' : undefined}
            >
              {todayViews > 0 ? `↑ ${todayViews} today` : 'None yet today'}
            </Text>
          </View>
        </View>

        <SegmentedControl
          options={[
            { id: 'live', label: `Live now (${byTab.live.length})` },
            { id: 'scheduled', label: `Scheduled (${byTab.scheduled.length})` },
            { id: 'past', label: `Past / Expired (${byTab.past.length})` },
          ]}
          value={tab}
          onChange={setTab}
          fill
        />

        {shown.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            viewCount={statsById.get(offer.id)?.total ?? 0}
            onEdit={() => router.push(editorHref(business.id, offer.id))}
          />
        ))}

        {shown.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <Text weight="semibold">
              {tab === 'live'
                ? 'No live offers'
                : tab === 'scheduled'
                  ? 'Nothing scheduled'
                  : 'Nothing past or paused'}
            </Text>
            <Text variant="caption" tone="muted" style={styles.emptyText}>
              {tab === 'live'
                ? offers.length === 0
                  ? 'A good first one: a photo or short reel of something people already love, with a little off the price.'
                  : 'Create a new one, or edit a past one to run it again.'
                : tab === 'scheduled'
                  ? 'Pick a later start when you create an offer, and it waits here until then.'
                  : 'Offers you pause or that pass their end date land here. Edit one to run it again.'}
            </Text>
          </View>
        ) : null}

        {/* A real tip, not a made-up stat: reels get the full-screen slot. */}
        {liveWithoutReel ? (
          <View style={[styles.tip, { backgroundColor: colors.brandSoft, borderColor: colors.border }]}>
            <View style={[styles.tipIcon, { backgroundColor: colors.surface }]}>
              <Text>💡</Text>
            </View>
            <View style={styles.tipText}>
              <Text variant="caption" weight="bold" tone="brand" style={styles.eyebrow}>
                Workspace tip
              </Text>
              <Text variant="caption">
                Offers with a short upright <Text variant="caption" weight="bold">video reel</Text>{' '}
                play full-screen in Deals near you — a photo-only offer shows as a still.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <BottomActionBar
        primary={{
          title: 'Create New Offer',
          icon: 'plus',
          onPress: () => router.push(editorHref(business.id)),
        }}
      />
    </Screen>
  );
}

function OfferCard({
  offer,
  viewCount,
  onEdit,
}: {
  offer: Offer;
  viewCount: number;
  onEdit: () => void;
}) {
  const colors = useColors();
  const status = offerStatus(offer);
  const saving = offerSavingPercent(offer);
  const when = offerEndsLabel(offer);
  const thumb = offer.imageUrl ? thumbUrl(offer.imageUrl) : undefined;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTags}>
        {status === 'live' ? (
          <Tag label="Live on Deals Feed" tone="status" dot size="sm" />
        ) : status === 'scheduled' ? (
          <Tag label="Scheduled" tone="soft" dot size="sm" />
        ) : status === 'paused' ? (
          <Tag label="Paused" size="sm" />
        ) : (
          <Tag label="Expired" tone="danger" size="sm" />
        )}
        {offer.tag ? <Tag label={offer.tag} tone="warning" size="sm" /> : null}
      </View>

      <Pressable onPress={onEdit} style={styles.cardBody} accessibilityRole="button">
        <View style={[styles.thumb, { backgroundColor: colors.brandSoft }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <Text style={styles.thumbEmoji}>{offer.emoji ?? '🎉'}</Text>
          )}
          <View style={styles.thumbLabel}>
            <Text variant="caption" weight="semibold" style={styles.onDark}>
              {offer.videoUrl ? '▶ Reel' : thumb ? 'Photo Ad' : 'No media'}
            </Text>
          </View>
        </View>
        <View style={styles.cardInfo}>
          <Text weight="bold" numberOfLines={2}>
            {offer.title}
          </Text>
          {offer.price || offer.wasPrice ? (
            <View style={styles.priceRow}>
              {offer.price ? (
                <Text variant="heading" weight="bold" tone="brand">
                  {offer.price}
                </Text>
              ) : null}
              {offer.wasPrice ? (
                <Text tone="muted" style={styles.struck}>
                  {offer.wasPrice}
                </Text>
              ) : null}
              {saving !== undefined ? <Tag label={`${saving}% OFF`} tone="status" size="sm" /> : null}
            </View>
          ) : null}
          <View style={styles.whenRow}>
            <Icon name="clock" size={14} color={when.urgent ? colors.cta : colors.textMuted} />
            <Text variant="caption" tone={when.urgent ? 'cta' : 'muted'} style={styles.whenText}>
              {when.text}
            </Text>
          </View>
        </View>
      </Pressable>

      <View style={[styles.cardFoot, { borderTopColor: colors.border }]}>
        <View style={styles.footLeft}>
          <Icon name="eye" size={16} color={colors.textMuted} />
          <Text variant="caption" tone="muted">
            {views(viewCount)}
          </Text>
        </View>
        <Button title="Edit" icon="edit" variant="secondary" size="sm" onPress={onEdit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  stats: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  stat: { flex: 1, paddingHorizontal: spacing.md, gap: 2 },
  statRule: { width: 1, marginVertical: spacing.xs },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cardBody: { flexDirection: 'row', gap: spacing.md },
  thumb: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: { fontSize: 34, lineHeight: 42 },
  thumbLabel: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  onDark: { color: '#fff' },
  cardInfo: { flex: 1, gap: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  struck: { textDecorationLine: 'line-through' },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whenText: { flex: 1 },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  footLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: { textAlign: 'center', marginTop: spacing.xs },
  tip: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  tipIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, gap: 2 },
});
