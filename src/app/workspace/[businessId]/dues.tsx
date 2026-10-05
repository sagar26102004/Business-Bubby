/**
 * Workspace › Members › "Who hasn't paid" — every active plan whose CURRENT
 * billing cycle is still open, most overdue first.
 *
 * The Members list is organised the way the business thinks about people: by
 * family, expandable, alphabetical. That is the wrong shape for the one question
 * an owner asks at the start of every month — who still owes me? — because the
 * answer is scattered across collapsed groups. So this screen flattens it: one
 * row per unpaid enrolment, the total owed at the top, and the two actions that
 * clear a row (approve what they reported, or record the cash) right on it.
 *
 * It reads the SAME `listForBusiness` the Members screen does and filters in
 * memory — the payment standing is already hydrated onto every membership, so
 * there is no second source of truth about who is overdue, and no new query.
 *
 * Standalone members are left out on purpose: nobody is billed for them
 * (`Membership.standalone`), so they can never owe anything.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Membership } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const cycleLabel = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** Everyone who owes for the cycle they're in — the ones this screen is about. */
const owes = (m: Membership) =>
  m.status === 'active' && !m.standalone && !!m.payment && m.payment.status !== 'paid';

export default function WorkspaceDuesScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const myName = currentUser?.name ?? 'Owner';

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, members] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.memberships.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    return {
      business,
      members,
      isMember: isBusinessTeamMember(business, meEmployee, currentUser),
      canAccess: canAccessService(business, meEmployee, currentUser, 'members'),
    };
  }, [businessId, currentUser?.id]);

  const [busyId, setBusyId] = useState<string | null>(null);
  // A sweep over every row at once — the start-of-month "they all paid at the
  // counter" case. Confirmed first, because it is a lot of money in one tap.
  const [confirmAll, setConfirmAll] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, members, isMember, canAccess } = data;
  if (!isMember || !canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Unpaid' }} />
        <EmptyView
          title="No access"
          subtitle="Only this business's team can see who has paid."
        />
      </Screen>
    );
  }

  // Most overdue first. A payment the customer already reported sits at the top
  // regardless, because approving it is one tap and clears a row for free.
  const unpaid = members
    .filter(owes)
    .sort(
      (a, b) =>
        Number(b.payment!.status === 'pending') - Number(a.payment!.status === 'pending') ||
        b.payment!.daysOverdue - a.payment!.daysOverdue,
    );
  const reported = unpaid.filter((m) => m.payment!.status === 'pending');
  const owing = unpaid.filter((m) => m.payment!.status === 'unpaid');
  const total = unpaid.reduce((sum, m) => sum + m.pricePerMonth, 0);
  const paidCount = members.filter((m) => !m.standalone && m.payment?.status === 'paid').length;

  /** Clear one row — approve what they reported, or record it as cash taken. */
  const clear = async (m: Membership) => {
    const pay = m.payment!;
    setBusyId(m.id);
    try {
      if (pay.status === 'pending' && pay.pendingPaymentId) {
        await repos.memberships.approvePayment(pay.pendingPaymentId, myName);
      } else {
        await repos.memberships.recordPayment({
          membershipId: m.id,
          periodStart: pay.periodStart,
          method: 'cash',
          byName: myName,
        });
      }
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (paymentId: string, id: string) => {
    setBusyId(id);
    try {
      await repos.memberships.rejectPayment(paymentId, myName);
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    setSweeping(true);
    try {
      for (const m of unpaid) {
        const pay = m.payment!;
        if (pay.status === 'pending' && pay.pendingPaymentId) {
          await repos.memberships.approvePayment(pay.pendingPaymentId, myName);
        } else {
          await repos.memberships.recordPayment({
            membershipId: m.id,
            periodStart: pay.periodStart,
            method: 'cash',
            byName: myName,
          });
        }
      }
      setConfirmAll(false);
      reload();
    } finally {
      setSweeping(false);
    }
  };

  const renderRow = (m: Membership) => {
    const pay = m.payment!;
    const busy = busyId === m.id;
    const displayName = m.enrolleeName ?? m.customerName;
    return (
      <Card key={m.id} style={styles.row} onPress={() => router.push(`/member/${m.id}`)}>
        <View style={styles.rowTop}>
          <Text weight="semibold" style={styles.flex}>
            {displayName}
          </Text>
          <Text weight="bold" tone="brand">
            {formatMoney(m.pricePerMonth)}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {m.enrolleeName ? `Under ${m.customerName} · ` : ''}
          {m.planName} · {cycleLabel(pay.periodStart)}
        </Text>
        <Text variant="caption" weight="semibold" tone={pay.status === 'pending' ? 'accent' : 'danger'}>
          {pay.status === 'pending'
            ? '⏳ They say they’ve paid — approve it'
            : pay.daysOverdue === 0
              ? '⚠ Due now'
              : `⚠ ${pay.daysOverdue} day${pay.daysOverdue === 1 ? '' : 's'} overdue`}
        </Text>

        <View style={styles.actions}>
          <Pressable onPress={() => !busy && clear(m)} hitSlop={6} disabled={busy}>
            <Text variant="caption" tone={busy ? 'muted' : 'success'} weight="semibold">
              {pay.status === 'pending' ? '✓ Approve' : '✓ Mark paid'}
            </Text>
          </Pressable>
          {pay.status === 'pending' && pay.pendingPaymentId ? (
            <Pressable
              onPress={() => !busy && reject(pay.pendingPaymentId!, m.id)}
              hitSlop={6}
              disabled={busy}
            >
              <Text variant="caption" tone={busy ? 'muted' : 'danger'} weight="semibold">
                Reject
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push(`/inbox/${business.id}/${m.customerId}`)}
            hitSlop={6}
          >
            <Text variant="caption" tone="accent" weight="semibold">
              💬 Remind
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Who hasn’t paid' }} />

      {unpaid.length === 0 ? (
        <>
          <Card style={[styles.totalCard, { backgroundColor: colors.successSoft, borderColor: colors.success }]}>
            <Text weight="bold" tone="success">
              ✓ Everyone has paid this month
            </Text>
            <Text variant="caption" tone="muted" style={styles.totalSub}>
              {paidCount === 0
                ? 'No billed plans are running yet.'
                : `${paidCount} plan${paidCount === 1 ? '' : 's'} settled for the current cycle.`}
            </Text>
          </Card>
          <Button
            title="Back to members"
            variant="secondary"
            onPress={() => router.replace(`/workspace/${business.id}/members`)}
            style={styles.back}
          />
        </>
      ) : (
        <>
          <Card style={[styles.totalCard, { borderColor: colors.danger, borderWidth: 1 }]}>
            <Text variant="title" weight="bold" tone="danger">
              {formatMoney(total)} outstanding
            </Text>
            <Text variant="caption" tone="muted" style={styles.totalSub}>
              {unpaid.length} of {unpaid.length + paidCount} plan
              {unpaid.length + paidCount === 1 ? '' : 's'} unpaid
              {reported.length > 0 ? ` · ${reported.length} awaiting your approval` : ''}
            </Text>
          </Card>

          {confirmAll ? (
            <Card style={[styles.totalCard, { borderColor: colors.brand, borderWidth: 1 }]}>
              <Text weight="semibold">
                Mark all {unpaid.length} as paid?
              </Text>
              <Text variant="caption" tone="muted" style={styles.totalSub}>
                This records {formatMoney(total)} as collected for the current cycle and tells
                every one of them it’s settled. Only do it if the money is actually in.
              </Text>
              <View style={styles.rowBtns}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setConfirmAll(false)}
                  style={styles.flex}
                />
                <Button
                  title="Yes, all paid"
                  onPress={clearAll}
                  loading={sweeping}
                  style={styles.flex}
                />
              </View>
            </Card>
          ) : (
            <Button
              title={`✓ Mark all ${unpaid.length} as paid`}
              variant="secondary"
              onPress={() => setConfirmAll(true)}
              style={styles.markAll}
            />
          )}

          {reported.length > 0 ? (
            <>
              <Text weight="semibold" style={styles.sectionHead}>
                ⏳ Reported — approve ({reported.length})
              </Text>
              {reported.map(renderRow)}
            </>
          ) : null}

          {owing.length > 0 ? (
            <>
              <Text weight="semibold" style={styles.sectionHead}>
                ⚠ Still to collect ({owing.length})
              </Text>
              {owing.map(renderRow)}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  totalCard: { marginBottom: spacing.md, borderRadius: radius.md },
  totalSub: { marginTop: spacing.xs },
  markAll: { marginBottom: spacing.md },
  sectionHead: { marginTop: spacing.md, marginBottom: spacing.sm },
  row: { marginBottom: spacing.sm },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  rowBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  back: { marginTop: spacing.sm },
});
