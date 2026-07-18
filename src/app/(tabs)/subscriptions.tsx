/**
 * Subscriptions tab — the recurring plans businesses enrolled this user into:
 * gym membership, yoga batch, tuition, a school-bus seat… ONLY a business can
 * create one (workspace → Members), so this list is exactly "what I'm
 * subscribed to around town".
 *
 * Top card = this month's total, tap → a popup with the line-by-line
 * breakdown; ‹ › pages back through previous months (MembershipRepository
 * .monthlySpend, newest first).
 */
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Membership } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
import {
  Button,
  Card,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const monthLabel = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
};
const renewsSoon = (m: Membership) =>
  new Date(m.expiresAt).getTime() - Date.now() < 7 * 24 * 3600 * 1000;

export default function SubscriptionsScreen() {
  const { currentUser, isGuest } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [monthIndex, setMonthIndex] = useState(0);

  const { data, loading, error, reload } = useAsync(async () => {
    if (!currentUser) return { subs: [], months: [] };
    const [subs, months] = await Promise.all([
      repos.memberships.listForCustomer(currentUser.id),
      repos.memberships.monthlySpend(currentUser.id),
    ]);
    return { subs, months };
  }, [currentUser?.id]);

  // Refresh when the tab regains focus (a business may have enrolled you).
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(
    useCallback(() => {
      reloadRef.current();
    }, []),
  );

  if (isGuest) {
    return (
      <Screen scroll>
        <View style={styles.guest}>
          <Text style={styles.guestEmoji}>🎫</Text>
          <Text variant="subheading" weight="semibold" style={styles.center}>
            Your subscriptions live here
          </Text>
          <Text tone="muted" style={[styles.center, styles.guestSub]}>
            When a gym, class, tuition or bus service adds you as a member, the plan — price,
            renewal and expiry — shows up on this screen.
          </Text>
          <Button title="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={styles.cta} />
        </View>
      </Screen>
    );
  }
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <LoadingView label="Loading your subscriptions…" />;

  const { subs, months } = data;
  const currentMonth = months[0];
  const month = months[Math.min(monthIndex, Math.max(months.length - 1, 0))];

  // Group plans under the business that runs them.
  const byBusiness = new Map<string, Membership[]>();
  subs.forEach((s) => {
    const list = byBusiness.get(s.businessId) ?? [];
    list.push(s);
    byBusiness.set(s.businessId, list);
  });

  const openBreakdown = () => {
    setMonthIndex(0);
    setBreakdownOpen(true);
  };

  return (
    <Screen scroll>
      {subs.length === 0 && !loading ? (
        <View style={styles.guest}>
          <Text style={styles.guestEmoji}>🎫</Text>
          <Text variant="subheading" weight="semibold" style={styles.center}>
            No subscriptions yet
          </Text>
          <Text tone="muted" style={[styles.center, styles.guestSub]}>
            When a business — a gym, a yoga class, a tutor, the school bus — adds you as a
            member, your plan appears here with its price, renewal and expiry.
          </Text>
        </View>
      ) : (
        <>
          {/* This month's total — tap for the month-by-month breakdown */}
          <Card onPress={openBreakdown} style={styles.totalCard}>
            <Text variant="caption" tone="muted" weight="semibold">
              THIS MONTH ON SUBSCRIPTIONS
            </Text>
            <Text variant="title" weight="bold" style={styles.totalAmount}>
              {formatMoney(currentMonth?.total ?? 0)}/month
            </Text>
            <Text variant="caption" tone="muted">
              {subs.length} plan{subs.length === 1 ? '' : 's'} across {byBusiness.size} business
              {byBusiness.size === 1 ? '' : 'es'} · View breakdown ›
            </Text>
          </Card>

          {[...byBusiness.values()].map((list) => (
            <View key={list[0].businessId} style={styles.group}>
              <Text variant="subheading" weight="bold" style={styles.groupTitle}>
                {list[0].businessName}
              </Text>
              {list.map((s) => (
                <Card
                  key={s.id}
                  onPress={() => router.push(`/business/${s.businessId}`)}
                  style={styles.subCard}
                >
                  <View style={styles.subTop}>
                    <Text weight="semibold" style={styles.planName}>
                      {s.planName}
                    </Text>
                    <Text weight="semibold" tone="brand">
                      {formatMoney(s.pricePerMonth)}/mo
                    </Text>
                  </View>
                  <Text variant="caption" tone="muted" style={styles.subDates}>
                    Subscribed {dateLabel(s.startedAt)} · Last renewed {dateLabel(s.renewedAt)}
                  </Text>
                  <View style={styles.subBottom}>
                    <Tag label={renewsSoon(s) ? '⏳ Renews soon' : '🟢 Active'} />
                    <Text variant="caption" tone="muted">
                      Renews {dateLabel(s.expiresAt)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          ))}
        </>
      )}

      {/* Month-by-month breakdown popup */}
      <Modal
        visible={breakdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBreakdownOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setBreakdownOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.monthNav}>
              <Text
                weight="bold"
                tone={monthIndex < months.length - 1 ? 'brand' : 'muted'}
                onPress={() => setMonthIndex((i) => Math.min(i + 1, months.length - 1))}
                style={styles.navBtn}
              >
                ‹
              </Text>
              <Text weight="semibold">{month ? monthLabel(month.month) : ''}</Text>
              <Text
                weight="bold"
                tone={monthIndex > 0 ? 'brand' : 'muted'}
                onPress={() => setMonthIndex((i) => Math.max(i - 1, 0))}
                style={styles.navBtn}
              >
                ›
              </Text>
            </View>

            {month?.lines.map((l, i) => (
              <View
                key={`${l.businessName}-${l.planName}-${i}`}
                style={[
                  styles.lineRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <View style={styles.lineInfo}>
                  <Text>{l.planName}</Text>
                  <Text variant="caption" tone="muted">
                    {l.businessName}
                  </Text>
                </View>
                <Text weight="medium">{formatMoney(l.amount)}</Text>
              </View>
            ))}

            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text weight="bold">Total</Text>
              <Text weight="bold" tone="brand">
                {formatMoney(month?.total ?? 0)}
              </Text>
            </View>
            <Button title="Close" variant="secondary" onPress={() => setBreakdownOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  guest: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.lg },
  guestEmoji: { fontSize: 44, marginBottom: spacing.md },
  center: { textAlign: 'center' },
  guestSub: { marginTop: spacing.sm },
  cta: { marginTop: spacing.lg, alignSelf: 'stretch' },
  totalCard: { marginBottom: spacing.xl },
  totalAmount: { marginVertical: spacing.xs },
  group: { marginBottom: spacing.lg },
  groupTitle: { marginBottom: spacing.md },
  subCard: { marginBottom: spacing.sm },
  subTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  planName: { flex: 1 },
  subDates: { marginTop: spacing.xs },
  subBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: { alignSelf: 'stretch', borderRadius: radius.lg, padding: spacing.lg },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: { fontSize: 22, paddingHorizontal: spacing.lg },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  lineInfo: { flex: 1 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
});
