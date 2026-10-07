/**
 * Alerts — everything that happened to me as a CUSTOMER that isn't a message:
 * my enrolments, orders, bookings, bills. Reached from the bell on Explore's
 * top bar (One Place redesign, 2026-10); it used to be the second segment of
 * the Chats tab.
 *
 * Messages never land here — a business's reply is an unread conversation in
 * Chats, and that thread IS the announcement. Alerts a person gets because
 * they run or work at a business belong to the Workspace (`isBusinessAlert`).
 *
 * An inbox, not a history: once an alert is opened (or marked read) it leaves
 * the list, so what's left is only what still needs you.
 */
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type { AppNotification } from '@/domain/types';
import { isBusinessAlert } from '@/domain/notifications';
import { isCustomerAlert, useMyBusinessIds } from '@/features/notifications/alertSides';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { CHAT_REFRESH_MS } from '@/lib/useAsync';
import { timeAgo } from '@/lib/timeAgo';
import { Card, EmptyView, Icon, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import { ON_HOLD } from '@/lib/onHold';

function kindIcon(kind: AppNotification['kind']): string {
  switch (kind) {
    case 'missed_call':
      return '📞';
    case 'order_requested':
    case 'order_update':
      return '📦';
    case 'bill_issued':
      return '🧾';
    case 'review_posted':
      return '⭐';
    case 'product_question':
    case 'product_reply':
      return '🏷️';
    case 'enroll_requested':
    case 'enroll_update':
      return '🎫';
    case 'payment_reported':
    case 'payment_update':
      return '💳';
    default:
      return '📅';
  }
}

export default function AlertsScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const recipientId = currentUser?.id ?? null;
  const myBusinessIds = useMyBusinessIds();

  const [alerts, setAlerts] = useState<AppNotification[]>([]);

  const load = useCallback(() => {
    // Guests have no notifications — a placeholder id errors against a real backend.
    if (!recipientId) {
      setAlerts([]);
      return;
    }
    repos.notifications
      .listForUser(recipientId)
      .then((list) =>
        setAlerts(list.filter((n) => !n.read && isCustomerAlert(n) && !isBusinessAlert(n, myBusinessIds))),
      )
      .catch(() => undefined);
  }, [repos, recipientId, myBusinessIds]);

  // Keep re-reading while focused, so a new alert shows up on the list you're
  // looking at.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, CHAT_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const openNotification = async (n: AppNotification) => {
    await repos.notifications.markRead(n.id);
    load();
    // Route by kind: orders/bills deep-link straight to the thing; a decision
    // on my booking → the business page. (Business-side kinds no longer reach
    // this list — see isBusinessAlert — but their routes stay harmless here.)
    if ((n.kind === 'order_requested' || n.kind === 'order_update') && n.orderId) {
      router.push(`/order/${n.orderId}`);
      return;
    }
    if (n.kind === 'bill_issued' && n.billId) {
      router.push(`/bill/${n.billId}`);
      return;
    }
    // A question or an answer on a stall item → that item's public thread.
    // ON HOLD (redesign 2026-10): stall — old stall-question alerts open the
    // listing instead of the (hidden) item thread.
    if (
      ON_HOLD.stalls &&
      (n.kind === 'product_question' || n.kind === 'product_reply') &&
      n.businessId
    ) {
      router.push(`/business/${n.businessId}`);
      return;
    }
    if (
      (n.kind === 'product_question' || n.kind === 'product_reply') &&
      n.businessId &&
      n.productId
    ) {
      router.push(`/product/${n.businessId}/${n.productId}`);
      return;
    }
    // An enrol request → the workspace Members section to accept it; the
    // customer's confirmation/decline → their Subscriptions tab.
    if (n.kind === 'enroll_requested' && n.businessId) {
      router.push(`/workspace/${n.businessId}/members`);
      return;
    }
    if (n.kind === 'enroll_update') {
      router.push('/subscriptions');
      return;
    }
    // A reported payment → the member's detail to approve it; the customer's
    // approval/decline → their Subscriptions tab.
    if (n.kind === 'payment_reported' && n.membershipId) {
      router.push(`/member/${n.membershipId}`);
      return;
    }
    if (n.kind === 'payment_update') {
      router.push('/subscriptions');
      return;
    }
    if (!n.businessId) return;
    if (n.kind === 'booking_requested') router.push(`/workspace/${n.businessId}`);
    else if (n.kind === 'booking_update') router.push(`/business/${n.businessId}`);
    else if (n.kind === 'missed_call') router.push(`/inbox/${n.businessId}`);
    else if (n.kind === 'review_posted') router.push(`/business/${n.businessId}`);
    else router.push(`/chat/${n.businessId}`);
  };

  const markAll = async () => {
    await Promise.all(alerts.map((n) => repos.notifications.markRead(n.id)));
    load();
  };

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              {alerts.length ? (
                <Text tone="accent" weight="semibold" onPress={markAll}>
                  Mark all read
                </Text>
              ) : null}
              {/* Too many pings? Silence whole families here. */}
              <Pressable
                onPress={() => router.push('/notification-settings')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Notification settings"
              >
                <Icon name="settings" size={20} color={colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />

      <FlatList
        data={alerts}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyView
            title="You’re all caught up"
            subtitle="Updates on your orders, bookings, enrolments and bills land here. Messages stay in Chats."
          />
        }
        renderItem={({ item }) => (
          <Card onPress={() => openNotification(item)} style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: colors.brand }]} />
              <View style={styles.info}>
                <Text weight="semibold">
                  {kindIcon(item.kind)} {item.title}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {item.body}
                </Text>
              </View>
              <Text variant="caption" tone="muted">
                {timeAgo(item.createdAt)}
              </Text>
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginRight: spacing.lg,
  },
  list: { padding: spacing.lg, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  info: { flex: 1 },
});
