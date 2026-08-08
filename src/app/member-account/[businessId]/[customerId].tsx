/**
 * Member account overview — every enrolment filed under ONE paying account at
 * a business. Reached from the "📋 Details" button on a parent card in the
 * workspace Members section. Lists each child/plan with its price and this
 * cycle's payment standing, and offers the same per-member actions (open full
 * details, stop, make separate, re-enroll). Members only.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Membership } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
import { Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function MemberAccountScreen() {
  const { businessId, customerId } = useLocalSearchParams<{ businessId: string; customerId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, active, cancelled] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.memberships.listForBusiness(business.id),
      repos.memberships.listCancelledForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canAccess = canAccessService(business, meEmployee, currentUser, 'members');
    const mine = [...active, ...cancelled].filter((m) => m.customerId === customerId);
    return { business, isMember, canAccess, items: mine };
  }, [businessId, customerId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { isMember, canAccess, items } = data;
  if (!isMember || !canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Member' }} />
        <EmptyView title="No access" subtitle="Only this business's team can open member details." />
      </Screen>
    );
  }
  if (items.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Member' }} />
        <EmptyView title="Nothing here" subtitle="This account has no enrolments." />
      </Screen>
    );
  }

  const accountName = items[0].customerName;
  const memberSince = (iso: string) => new Date(iso).toDateString().slice(4);

  // Active plans first, cancelled ones after, each alphabetical by who it's for.
  const sorted = [...items].sort((a, b) => {
    const byStatus = Number(a.status === 'cancelled') - Number(b.status === 'cancelled');
    if (byStatus !== 0) return byStatus;
    return (a.enrolleeName ?? a.customerName).localeCompare(b.enrolleeName ?? b.customerName);
  });
  const activeTotal = items
    .filter((m) => m.status === 'active' && !m.standalone)
    .reduce((sum, m) => sum + m.pricePerMonth, 0);

  const stop = async (id: string) => {
    await repos.memberships.cancel(id);
    reload();
  };
  const reenroll = async (id: string) => {
    await repos.memberships.reenroll(id);
    reload();
  };
  const detach = async (id: string) => {
    await repos.memberships.detach(id);
    reload();
  };

  const payLine = (m: Membership): { text: string; tone: 'success' | 'accent' | 'danger' } | null => {
    const pay = m.payment;
    if (!pay) return null;
    if (pay.status === 'paid') return { text: '✓ Paid this month', tone: 'success' };
    if (pay.status === 'pending') return { text: '⏳ Payment reported — approve', tone: 'accent' };
    return {
      text: `⚠ Unpaid · ${pay.daysOverdue === 0 ? 'due now' : `${pay.daysOverdue} day${pay.daysOverdue === 1 ? '' : 's'} overdue`}`,
      tone: 'danger',
    };
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: accountName }} />

      <Text variant="title" weight="bold">
        {accountName}
      </Text>
      <Text tone="muted" style={styles.sub}>
        {items.length} enrolment{items.length === 1 ? '' : 's'}
        {activeTotal > 0 ? ` · ${formatMoney(activeTotal)}/mo` : ''}
      </Text>

      {sorted.map((m) => {
        const displayName = m.enrolleeName ?? m.customerName;
        const isChild = !!m.enrolleeName && !m.standalone;
        const cancelled = m.status === 'cancelled';
        const pay = payLine(m);
        return (
          <Card
            key={m.id}
            onPress={() => router.push(`/member/${m.id}`)}
            style={StyleSheet.flatten([styles.card, cancelled && styles.cancelled])}
          >
            <View style={styles.topRow}>
              <Text weight="semibold" style={styles.flex}>
                {displayName}
              </Text>
              {cancelled ? (
                <Text variant="caption" tone="danger" weight="semibold">
                  Unsubscribed
                </Text>
              ) : m.standalone ? (
                <Text variant="caption" tone="muted">
                  Not billed
                </Text>
              ) : (
                <Text weight="semibold" tone="brand">
                  {formatMoney(m.pricePerMonth)}/mo
                </Text>
              )}
            </View>
            <Text variant="caption" tone="muted">
              {m.planName} · since {memberSince(m.startedAt)}
              {cancelled && m.endedAt ? ` · stopped ${memberSince(m.endedAt)}` : ''}
            </Text>

            {pay ? (
              <View style={[styles.payPill, { backgroundColor: colors.surfaceAlt }]}>
                <Text variant="caption" weight="semibold" tone={pay.tone}>
                  {pay.text}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={() => router.push(`/member/${m.id}`)} hitSlop={6}>
                <Text variant="caption" tone="accent" weight="semibold">
                  📋 Details
                </Text>
              </Pressable>
              {cancelled ? (
                <Pressable onPress={() => reenroll(m.id)} hitSlop={6}>
                  <Text variant="caption" tone="accent" weight="semibold">
                    ♻️ Re-enroll
                  </Text>
                </Pressable>
              ) : (
                <>
                  {isChild ? (
                    <Pressable onPress={() => detach(m.id)} hitSlop={6}>
                      <Text variant="caption" tone="accent" weight="semibold">
                        ⤴ Make separate
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => stop(m.id)} hitSlop={6}>
                    <Text variant="caption" tone="danger" weight="semibold">
                      Stop
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  cancelled: { opacity: 0.6 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  payPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
});
