/**
 * Promote — where a business buys the Home ad slot.
 *
 * The pitch has to be concrete or nobody buys: this screen says what the offer
 * already reaches for free (FREE_REACH_KM), what each plan PROMISES — a number
 * of views from people inside a given band — and what that works out at per
 * view. Then, for every campaign already bought, it shows how many people
 * actually saw it and from how far away. That last part is the reason a
 * business buys a SECOND one, and it's the honest answer to "did I get what I
 * paid for?": the promise and the delivery sit side by side.
 *
 * A request lands as `pending` and shows nothing until a platform admin
 * approves it (the app has no payment gateway — money is settled off-app; see
 * domain/ads.ts). The repository and the RLS policies both enforce that, so
 * this screen can be honest about the wait rather than pretending it's instant.
 *
 * Access-gated on the same "Offers" permission as the offers editor: whoever
 * builds the offers is who decides to promote one.
 */
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { AdCampaign, Offer } from '@/domain/types';
import {
  AD_PLANS,
  FREE_REACH_KM,
  adCostPerView,
  campaignGoal,
  campaignNearViews,
  campaignStatusLabel,
  campaignTapRate,
  campaignViewBands,
  formatAdAmount,
  getAdPlan,
  isCampaignInMakeGood,
  isCampaignRunning,
} from '@/domain/ads';
import { liveOffers } from '@/domain/offers';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function PromoteScreen() {
  const { businessId, offer: offerParam } = useLocalSearchParams<{
    businessId: string;
    offer?: string;
  }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, campaigns] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.ads.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    return {
      business,
      campaigns,
      isMember: isBusinessTeamMember(business, meEmployee, currentUser),
      canUse: canAccessService(business, meEmployee, currentUser, 'offers'),
    };
  }, [businessId, currentUser?.id]);

  const [offerId, setOfferId] = useState<string | undefined>(offerParam);
  const [planId, setPlanId] = useState<string>(
    AD_PLANS.find((p) => p.popular)?.id ?? AD_PLANS[0].id,
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const business = data?.business;
  const offers: Offer[] = useMemo(() => (business ? liveOffers(business) : []), [business]);
  const chosen = offers.find((o) => o.id === offerId);
  const plan = getAdPlan(planId);

  // Offers already spoken for, so the buttons can say why rather than throwing
  // the repository's error at someone who did nothing wrong.
  const busyOfferIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.campaigns ?? []) {
      if (c.status === 'pending' || isCampaignRunning(c)) set.add(c.offerId);
    }
    return set;
  }, [data?.campaigns]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !business) return <EmptyView title="Not found" />;

  if (!data.isMember || !data.canUse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Promote' }} />
        <EmptyView
          title={data.isMember ? 'No access' : 'Members only'}
          subtitle={
            data.isMember
              ? 'Ask the owner to grant you “Offers” on the Access & permissions screen.'
              : `You're not part of ${business.name}.`
          }
        />
      </Screen>
    );
  }

  const submit = async () => {
    if (!chosen) {
      setFormError('Pick which offer you want to promote.');
      return;
    }
    if (!plan) {
      setFormError('Pick how far and how long you want it to run.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await repos.ads.request({
        businessId: business.id,
        offerId: chosen.id,
        planId: plan.id,
        requestedById: currentUser?.id ?? '',
        requestedByName: currentUser?.name ?? 'A team member',
      });
      setOfferId(undefined);
      reload();
      Alert.alert(
        'Request sent',
        `We'll review it shortly. Once it's approved, “${chosen.title}” runs for ${plan.days} days and keeps going until at least ${plan.views} people within ${plan.withinKm} km have seen it.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not send that request.');
    } finally {
      setBusy(false);
    }
  };

  const confirmStop = (campaign: AdCampaign) =>
    Alert.alert('Stop this ad?', 'It comes off the Home screen straight away.', [
      { text: 'Keep running', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          try {
            await repos.ads.stop(campaign.id);
            reload();
          } catch (err) {
            Alert.alert('Could not stop it', err instanceof Error ? err.message : 'Try again.');
          }
        },
      },
    ]);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Promote' }} />

      <Text variant="title" weight="bold">
        📣 Promote an offer
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Your live offers already show on the Home screen to people within {FREE_REACH_KM} km.
        Promoting one puts it in front of everyone else's, carries it as far as anyone is
        looking, and promises you a set number of views from people close enough to actually
        come in — we keep it running until they've landed.
      </Text>

      {/* ── 1. Which offer ── */}
      {offers.length === 0 ? (
        <Card style={styles.card}>
          <Text weight="semibold">No live offers to promote</Text>
          <Text variant="caption" tone="muted" style={styles.hint}>
            Build one first in Workspace › Offers — an ad is just an offer with reach behind it.
          </Text>
          <View style={styles.cta}>
            <Button
              title="Go to Offers"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/workspace/[businessId]/offers',
                  params: { businessId: business.id },
                })
              }
            />
          </View>
        </Card>
      ) : (
        <>
          <Text variant="label" weight="semibold" style={styles.sectionLabel}>
            1. Which offer?
          </Text>
          {offers.map((offer) => {
            const taken = busyOfferIds.has(offer.id);
            const active = offerId === offer.id;
            return (
              <Pressable
                key={offer.id}
                onPress={() => {
                  if (taken) return;
                  setFormError(null);
                  setOfferId(active ? undefined : offer.id);
                }}
                style={[
                  styles.pick,
                  {
                    borderColor: active ? colors.brand : colors.border,
                    backgroundColor: colors.surface,
                  },
                  taken && styles.taken,
                ]}
              >
                <Text variant="heading">{offer.emoji ?? '🎉'}</Text>
                <View style={styles.pickBody}>
                  <Text weight="semibold">{offer.title}</Text>
                  <Text variant="caption" tone="muted">
                    {taken
                      ? 'Already promoted'
                      : offer.price
                        ? `${offer.price}${offer.wasPrice ? ` · was ${offer.wasPrice}` : ''}`
                        : 'No price set'}
                  </Text>
                </View>
                {active ? (
                  <Text tone="brand" weight="bold">
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {/* ── 2. How many people, how close ── */}
          <Text variant="label" weight="semibold" style={styles.sectionLabel}>
            2. How many people should see it?
          </Text>
          <Text variant="caption" tone="muted" style={styles.sectionHint}>
            Every plan shows your card to anyone who looks, however far away. What you're buying
            is views from people NEAR you — someone 1 km away might walk in this afternoon,
            someone 100 km away won't — so the tighter the circle, the dearer the view.
          </Text>
          {AD_PLANS.map((p) => {
            const active = planId === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPlanId(p.id)}
                style={[
                  styles.pick,
                  {
                    borderColor: active ? colors.brand : colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <Text variant="heading">{p.icon}</Text>
                <View style={styles.pickBody}>
                  <View style={styles.planHead}>
                    <Text weight="semibold">{p.label}</Text>
                    {p.popular ? <Tag label="Most picked" tone="brand" /> : null}
                  </View>
                  <Text variant="caption" weight="semibold">
                    At least {p.views} views from within {p.withinKm} km
                  </Text>
                  <Text variant="caption" tone="muted">
                    {p.days} days · {p.description}
                  </Text>
                </View>
                <View style={styles.planPrice}>
                  <Text weight="bold" tone={active ? 'brand' : undefined}>
                    {formatAdAmount(p.amount)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {adCostPerView(p)}/view
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {/* ── 3. Send it ── */}
          {plan ? (
            <Card style={styles.summary}>
              <Text variant="caption" tone="muted">
                {chosen ? `“${chosen.title}”` : 'Your offer'} would run for {plan.days} days,
                marked “Sponsored” and ahead of the free offers — and if fewer than {plan.views}{' '}
                people within {plan.withinKm} km have seen it by then, it keeps running until
                they have.
              </Text>
              <Text variant="caption" tone="muted" style={styles.hint}>
                Nothing is charged in the app. We'll review the request and get in touch about
                payment; the {plan.days} days start the day it goes live, not today.
              </Text>
            </Card>
          ) : null}

          {formError ? (
            <Text variant="caption" tone="danger" style={styles.hint}>
              {formError}
            </Text>
          ) : null}

          <Button
            title={busy ? 'Sending…' : `Request this ad · ${plan ? formatAdAmount(plan.amount) : ''}`}
            onPress={submit}
            disabled={busy}
          />
        </>
      )}

      {/* ── What's already been bought ── */}
      {(data.campaigns ?? []).length > 0 ? (
        <>
          <Text variant="label" weight="semibold" style={styles.sectionLabel}>
            Your ads
          </Text>
          {data.campaigns.map((campaign) => {
            const offer = (business.offers ?? []).find((o) => o.id === campaign.offerId);
            const rate = campaignTapRate(campaign);
            const running = isCampaignRunning(campaign);
            return (
              <Card key={campaign.id} style={styles.card}>
                <Text weight="semibold">{offer?.title ?? 'Offer no longer listed'}</Text>
                <Text
                  variant="caption"
                  tone={running ? 'success' : campaign.status === 'rejected' ? 'danger' : 'muted'}
                >
                  {campaignStatusLabel(campaign)}
                </Text>
                {campaign.reviewNote ? (
                  <Text variant="caption" tone="muted" style={styles.hint}>
                    “{campaign.reviewNote}”
                  </Text>
                ) : null}

                <View style={[styles.stats, { borderTopColor: colors.border }]}>
                  <View style={styles.stat}>
                    <Text weight="bold">{campaign.impressions}</Text>
                    <Text variant="caption" tone="muted">
                      views
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text weight="bold">{campaign.taps}</Text>
                    <Text variant="caption" tone="muted">
                      opened
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text weight="bold">{rate === undefined ? '—' : `${rate}%`}</Text>
                    <Text variant="caption" tone="muted">
                      tap rate
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text weight="bold">{formatAdAmount(campaign.amount)}</Text>
                    <Text variant="caption" tone={campaign.paid ? 'success' : 'muted'}>
                      {campaign.paid ? 'paid' : 'unpaid'}
                    </Text>
                  </View>
                </View>

                {/* What was promised, and how much of it has landed. */}
                <CampaignPromise campaign={campaign} />

                {/* Who actually saw it — the whole audience, by distance. */}
                <CampaignAudience campaign={campaign} />

                {running || campaign.status === 'pending' ? (
                  <View style={styles.cta}>
                    <Button
                      title={campaign.status === 'pending' ? 'Cancel request' : 'Stop this ad'}
                      variant="ghost"
                      onPress={() => confirmStop(campaign)}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

/**
 * THE PROMISE, and how much of it has landed. Only view-priced campaigns have
 * one — a legacy campaign bought a radius and was never told a number, so
 * showing it a progress bar against nothing would be inventing a promise after
 * the fact.
 */
function CampaignPromise({ campaign }: { campaign: AdCampaign }) {
  const colors = useColors();
  const goal = campaignGoal(campaign);
  if (!goal) return null;

  const delivered = campaignNearViews(campaign);
  const met = delivered >= goal.views;
  const pct = Math.min(100, Math.round((delivered / goal.views) * 100));

  return (
    <View style={[styles.promise, { borderTopColor: colors.border }]}>
      <View style={styles.promiseHead}>
        <Text variant="caption" weight="semibold">
          {delivered} of {goal.views} views from within {goal.withinKm} km
        </Text>
        <Text variant="caption" tone={met ? 'success' : 'muted'}>
          {met ? '✓ delivered' : `${goal.views - delivered} to go`}
        </Text>
      </View>
      <View style={[styles.bar, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%`, backgroundColor: met ? colors.success : colors.brand },
          ]}
        />
      </View>
      {isCampaignInMakeGood(campaign) ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Its {campaign.days} days are up, so it's running on extra days at no charge until the
          views you were promised have landed.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * WHO SAW IT. The same views broken down by how far the viewer was standing —
 * because 400 views means one thing at 2 km and quite another at 90, and a
 * business deciding whether to buy again deserves to see which it got.
 */
function CampaignAudience({ campaign }: { campaign: AdCampaign }) {
  const colors = useColors();
  const bands = campaignViewBands(campaign);
  if (bands.length === 0) return null;
  const most = Math.max(...bands.map((b) => b.views));

  return (
    <View style={[styles.audience, { borderTopColor: colors.border }]}>
      <Text variant="caption" weight="semibold" style={styles.hint}>
        Who saw it
      </Text>
      {bands.map((band) => (
        <View key={band.key} style={styles.bandRow}>
          <Text variant="caption" tone="muted" style={styles.bandLabel}>
            {band.label}
          </Text>
          <View style={[styles.bar, styles.bandBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round((band.views / most) * 100)}%`, backgroundColor: colors.brand },
              ]}
            />
          </View>
          <Text variant="caption" weight="semibold" style={styles.bandCount}>
            {band.views}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  sectionLabel: { marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { marginBottom: spacing.md },
  hint: { marginTop: spacing.xs },
  cta: { marginTop: spacing.md },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  taken: { opacity: 0.5 },
  pickBody: { flex: 1 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planPrice: { alignItems: 'flex-end' },
  sectionHint: { marginBottom: spacing.md },
  promise: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  promiseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  audience: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  bandLabel: { width: 96 },
  bandBar: { flex: 1 },
  bandCount: { width: 40, textAlign: 'right' },
  summary: { marginTop: spacing.md, marginBottom: spacing.md },
  stats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: 'center' },
});
