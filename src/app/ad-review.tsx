/**
 * Ad review — the platform's side of the revenue line. Super-admin only.
 *
 * Businesses request ad slots from Workspace › Offers › Promote; nothing they
 * ask for shows on Home until it's approved here. That gate is real, not
 * cosmetic: the insert policy in migration 0014 pins new campaigns to
 * `pending`, and only `is_super_admin()` may write any other status.
 *
 * Two decisions per request:
 *   1. approve or reject — is this a real offer from a real shop?
 *   2. paid or not — money is settled off-app (the app has no gateway), so
 *      this is a hand-marked record of what's actually been collected, the
 *      same way bills and memberships already work.
 *
 * Approving starts the clock, so a request left sitting here costs the business
 * nothing — the run it paid for begins the moment it goes live.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { AdCampaign, Business } from '@/domain/types';
import {
  campaignGoal,
  campaignNearViews,
  campaignPlanSummary,
  campaignStatusLabel,
  campaignTapRate,
  formatAdAmount,
  getAdPlan,
  isCampaignRunning,
} from '@/domain/ads';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

type Filter = 'pending' | 'live' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Waiting' },
  { id: 'live', label: 'Live' },
  { id: 'all', label: 'All' },
];

export default function AdReviewScreen() {
  const { currentUser, authLoading } = useAuth();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const dismiss = useDismiss('/admin');

  const isAdmin = isSuperAdminUser(currentUser);
  const [filter, setFilter] = useState<Filter>('pending');
  // Rejection reasons, kept per campaign so typing in one row doesn't bleed
  // into another.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    if (!isAdmin) return { campaigns: [] as AdCampaign[], businesses: new Map<string, Business>() };
    const campaigns = await repos.ads.listAll();
    // The card shows the actual creative, so each campaign's business is needed
    // to resolve the offer it points at. Unique ids only — several campaigns
    // from one shop is the normal case.
    const ids = Array.from(new Set(campaigns.map((c) => c.businessId)));
    const loaded = await Promise.all(ids.map((id) => repos.businesses.getById(id)));
    const businesses = new Map<string, Business>();
    loaded.forEach((b) => {
      if (b) businesses.set(b.id, b);
    });
    return { campaigns, businesses };
  }, [isAdmin]);

  const shown = useMemo(() => {
    const all = data?.campaigns ?? [];
    if (filter === 'pending') return all.filter((c) => c.status === 'pending');
    if (filter === 'live') return all.filter((c) => isCampaignRunning(c));
    return all;
  }, [data?.campaigns, filter]);

  const counts = useMemo(() => {
    const all = data?.campaigns ?? [];
    return {
      pending: all.filter((c) => c.status === 'pending').length,
      live: all.filter((c) => isCampaignRunning(c)).length,
      all: all.length,
      /** Money requested but not yet marked received. */
      owed: all
        .filter((c) => !c.paid && (c.status === 'active' || c.status === 'pending'))
        .reduce((sum, c) => sum + c.amount, 0),
    };
  }, [data?.campaigns]);

  if (authLoading || loading) return <LoadingView />;

  if (!isAdmin) {
    return (
      <Screen scroll>
        <View style={styles.denied}>
          <Text style={styles.deniedIcon}>🛡️</Text>
          <Text variant="heading" weight="bold">
            Admins only
          </Text>
          <Text tone="muted" style={styles.deniedSub}>
            Ad requests are reviewed by platform super-admins.
          </Text>
          <Button title="Back" variant="secondary" onPress={dismiss} />
        </View>
      </Screen>
    );
  }

  if (error) return <ErrorView message={error.message} onRetry={reload} />;

  /** Run one review action, keeping the row disabled until it lands. */
  const act = async (campaign: AdCampaign, run: () => Promise<unknown>) => {
    setBusyId(campaign.id);
    try {
      await run();
      reload();
    } catch (err) {
      showAlert('Could not do that', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = (campaign: AdCampaign) => {
    const note = notes[campaign.id]?.trim();
    if (!note) {
      showAlert(
        'Say why',
        'A rejection goes to the business as a notification — give them a reason they can act on.',
      );
      return;
    }
    void act(campaign, () => repos.ads.reject(campaign.id, note));
  };

  return (
    <Screen scroll>
      <Text variant="heading" weight="bold" style={styles.h1}>
        📣 Ad review
      </Text>

      <Card style={styles.card}>
        <View style={styles.summary}>
          <View style={styles.stat}>
            <Text variant="title" weight="bold">
              {counts.pending}
            </Text>
            <Text variant="caption" tone="muted">
              waiting
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="title" weight="bold">
              {counts.live}
            </Text>
            <Text variant="caption" tone="muted">
              live now
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="title" weight="bold" tone={counts.owed > 0 ? 'brand' : undefined}>
              {formatAdAmount(counts.owed)}
            </Text>
            <Text variant="caption" tone="muted">
              uncollected
            </Text>
          </View>
        </View>
      </Card>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Tag
            key={f.id}
            label={`${f.label} (${counts[f.id]})`}
            selected={filter === f.id}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </View>

      {shown.length === 0 ? (
        <EmptyView
          title={filter === 'pending' ? 'Nothing waiting' : 'No campaigns'}
          subtitle={
            filter === 'pending'
              ? 'Every request has been dealt with.'
              : 'Businesses promote an offer from Workspace › Offers.'
          }
        />
      ) : null}

      {shown.map((campaign) => {
        const business = data?.businesses.get(campaign.businessId);
        const offer = (business?.offers ?? []).find((o) => o.id === campaign.offerId);
        const plan = getAdPlan(campaign.planId);
        const rate = campaignTapRate(campaign);
        const running = isCampaignRunning(campaign);
        const busy = busyId === campaign.id;

        return (
          <Card key={campaign.id} style={styles.card}>
            <View style={styles.head}>
              <Text variant="heading">{offer?.emoji ?? '📣'}</Text>
              <View style={styles.headBody}>
                <Text weight="semibold">{offer?.title ?? 'Offer no longer listed'}</Text>
                <Text variant="caption" tone="muted">
                  {campaign.businessName} · asked by {campaign.requestedByName}
                </Text>
              </View>
              <Tag label={campaign.paid ? 'Paid' : 'Unpaid'} tone={campaign.paid ? 'brand' : undefined} />
            </View>

            <Text
              variant="caption"
              tone={running ? 'success' : campaign.status === 'rejected' ? 'danger' : 'muted'}
              style={styles.status}
            >
              {campaignStatusLabel(campaign)}
            </Text>

            <Text variant="caption" tone="muted" style={styles.detail}>
              {plan?.label ?? campaign.planId} · {campaignPlanSummary(campaign)} ·{' '}
              {formatAdAmount(campaign.amount)}
            </Text>

            {/* An offer that's since been paused or deleted can't run — say so
                here rather than approving an ad that would never appear. */}
            {!offer ? (
              <Text variant="caption" tone="danger" style={styles.detail}>
                The offer behind this request is gone. Approving it would show nothing.
              </Text>
            ) : null}

            {campaign.status === 'active' || campaign.impressions > 0 ? (
              <View style={[styles.stats, { borderTopColor: colors.border }]}>
                <View style={styles.stat}>
                  <Text weight="bold">{campaign.impressions}</Text>
                  <Text variant="caption" tone="muted">
                    views
                  </Text>
                </View>
                {/* Delivery against the promise — the number that decides
                    whether this run is still owed extra days. */}
                {campaignGoal(campaign) ? (
                  <View style={styles.stat}>
                    <Text weight="bold">
                      {campaignNearViews(campaign)}/{campaignGoal(campaign)?.views}
                    </Text>
                    <Text variant="caption" tone="muted">
                      within {campaignGoal(campaign)?.withinKm} km
                    </Text>
                  </View>
                ) : null}
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
              </View>
            ) : null}

            {campaign.reviewNote ? (
              <Text variant="caption" tone="muted" style={styles.detail}>
                Your note: “{campaign.reviewNote}”
              </Text>
            ) : null}

            {campaign.status === 'pending' ? (
              <>
                <View style={styles.noteField}>
                  <Input
                    placeholder="Reason, if you're turning it down"
                    value={notes[campaign.id] ?? ''}
                    onChangeText={(t) => setNotes((prev) => ({ ...prev, [campaign.id]: t }))}
                  />
                </View>
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button
                      title={busy ? '…' : 'Approve'}
                      onPress={() => act(campaign, () => repos.ads.approve(campaign.id))}
                      disabled={busy}
                    />
                  </View>
                  <View style={styles.action}>
                    <Button
                      title="Reject"
                      variant="ghost"
                      onPress={() => reject(campaign)}
                      disabled={busy}
                    />
                  </View>
                </View>
              </>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.action}>
                <Button
                  title={campaign.paid ? 'Mark unpaid' : 'Mark paid'}
                  variant="secondary"
                  onPress={() => act(campaign, () => repos.ads.setPaid(campaign.id, !campaign.paid))}
                  disabled={busy}
                />
              </View>
              {running ? (
                <View style={styles.action}>
                  <Button
                    title="Stop"
                    variant="ghost"
                    onPress={() => act(campaign, () => repos.ads.stop(campaign.id))}
                    disabled={busy}
                  />
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { marginBottom: spacing.xs },
  card: { marginBottom: spacing.md },
  summary: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  filters: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headBody: { flex: 1 },
  status: { marginTop: spacing.sm },
  detail: { marginTop: spacing.xs },
  stats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noteField: { marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  denied: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  deniedIcon: { fontSize: 46 },
  deniedSub: { textAlign: 'center' },
});
