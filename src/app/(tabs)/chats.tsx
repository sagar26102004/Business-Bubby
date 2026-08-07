/**
 * Chat tab — the customer's DM list (one conversation per business, like
 * Instagram DMs), with Alerts folded in behind a segment toggle so replies,
 * bookings and order updates live on the same screen.
 */
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import type { AppNotification } from '@/domain/types';
import type { CustomerThreadSummary } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Avatar, Card, EmptyView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

function kindIcon(kind: AppNotification['kind']): string {
  switch (kind) {
    case 'chat_reply':
      return '💬';
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Segment = 'chats' | 'alerts';

export default function ChatsScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const participantId = currentUser?.id ?? 'guest';

  const [segment, setSegment] = useState<Segment>('chats');
  const [threads, setThreads] = useState<CustomerThreadSummary[]>([]);
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(() => {
    repos.chat.listCustomerThreads(participantId).then(setThreads);
    // Alerts is an inbox, not a history: once an alert is opened (or marked
    // read) it leaves the list, so what's left is only what still needs you.
    repos.notifications
      .listForUser(participantId)
      .then((list) => setItems(list.filter((n) => !n.read)));
  }, [repos, participantId]);

  // Refresh whenever the tab regains focus.
  useFocusEffect(useCallback(() => load(), [load]));

  const openNotification = async (n: AppNotification) => {
    await repos.notifications.markRead(n.id);
    load();
    // Route by kind: orders/bills deep-link straight to the thing; chat → the
    // chat; new request → the workspace; a decision on my booking → the
    // business page; a missed call → the business inbox.
    if ((n.kind === 'order_requested' || n.kind === 'order_update') && n.orderId) {
      router.push(`/order/${n.orderId}`);
      return;
    }
    if (n.kind === 'bill_issued' && n.billId) {
      router.push(`/bill/${n.billId}`);
      return;
    }
    // A question or an answer on a stall item → that item's public thread.
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
    await repos.notifications.markAllRead(participantId);
    load();
  };

  const hasUnread = items.some((n) => !n.read);
  const unreadCount = items.filter((n) => !n.read).length;

  const segmentButton = (value: Segment, label: string, badge?: number) => {
    const active = segment === value;
    return (
      <Pressable
        onPress={() => setSegment(value)}
        style={[
          styles.segment,
          { backgroundColor: active ? colors.brand : 'transparent' },
        ]}
      >
        <Text weight="semibold" style={{ color: active ? '#fff' : colors.textMuted }}>
          {label}
        </Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: active ? '#fff' : colors.brand }]}>
            <Text variant="caption" weight="semibold" style={{ color: active ? colors.brand : '#fff' }}>
              {badge}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen padded={false}>
      {/* "Mark all read" lives in the navigator header so the top bar matches
          the other tabs (centered title, same surface). */}
      <Tabs.Screen
        options={{
          headerRight:
            segment === 'alerts'
              ? () => (
                  <View style={styles.headerActions}>
                    {hasUnread ? (
                      <Text tone="accent" weight="semibold" onPress={markAll}>
                        Mark all read
                      </Text>
                    ) : null}
                    {/* Too many pings? Silence whole families here. */}
                    <Text
                      style={styles.headerIcon}
                      onPress={() => router.push('/notification-settings')}
                    >
                      🔕
                    </Text>
                  </View>
                )
              : undefined,
        }}
      />

      <View style={[styles.segments, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        {segmentButton('chats', 'Chats')}
        {segmentButton('alerts', 'Alerts', unreadCount || undefined)}
      </View>

      {segment === 'chats' ? (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.businessId}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyView
              title="No chats yet"
              subtitle="Message a business from its page and your conversation will show up here."
            />
          }
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/chat/${item.businessId}`)} style={styles.card}>
              <View style={styles.row}>
                <Avatar name={item.businessName} size={44} />
                <View style={styles.info}>
                  <Text weight="semibold">{item.businessName}</Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {item.lastAuthorType === 'customer' ? 'You: ' : ''}
                    {item.lastBody}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {timeAgo(item.lastAt)}
                </Text>
              </View>
            </Card>
          )}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyView
              title="You’re all caught up"
              subtitle="New alerts land here and leave once you’ve opened them."
            />
          }
          renderItem={({ item }) => (
            <Card onPress={() => openNotification(item)} style={styles.card}>
              <View style={styles.row}>
                {!item.read ? (
                  <View style={[styles.dot, { backgroundColor: colors.brand }]} />
                ) : (
                  <View style={styles.dotSpacer} />
                )}
                <View style={styles.info}>
                  <Text weight={item.read ? 'regular' : 'semibold'}>
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
      )}
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
  headerIcon: { fontSize: 18 },
  segments: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  list: { padding: spacing.lg, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSpacer: { width: 8 },
  info: { flex: 1 },
});
