/**
 * Chat tab — the customer's DM list (one conversation per business, like
 * Instagram DMs), with Alerts alongside it behind a segment toggle.
 *
 * The two segments never overlap: anything from the chat family (a business's
 * reply to me, a customer writing to a business I answer for) belongs to
 * **Chats** and shows there as an unread conversation; **Alerts** is
 * everything else — bookings, orders, bills, calls, reviews. A message used to
 * be announced twice, once as a thread and again as an alert; now the thread
 * IS the announcement.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import type { AppNotification } from '@/domain/types';
import type { CustomerThreadSummary } from '@/data/repositories';
import { categoryOfKind } from '@/domain/notifications';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { CHAT_REFRESH_MS } from '@/lib/useAsync';
import { Avatar, Card, EmptyView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { ON_HOLD } from '@/lib/onHold';

/** Chat alerts are shown as conversations, so they never reach the alert list. */
const isChatAlert = (n: AppNotification) => categoryOfKind(n.kind) === 'chats';

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

/**
 * One row in the Chats list. It is either a conversation of my own (a customer
 * thread) or a conversation someone started with a business I answer for —
 * that one lives in the business inbox and has no row of its own here, so its
 * unread chat alert makes one.
 */
type ChatRow = {
  key: string;
  name: string;
  preview: string;
  /** "You: " prefix — only for a thread whose last word was mine. */
  fromMe: boolean;
  at: string;
  /** The chat alerts this row stands for; opening it clears them. */
  unreadIds: string[];
  href: string;
};

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

  // Refresh whenever the tab regains focus, and keep re-reading while it IS
  // focused — a reply or a new alert has to show up on the list you're looking
  // at, not only after you leave the tab and come back.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, CHAT_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  /** Everything that is NOT a message — this is the Alerts list. */
  const alerts = useMemo(() => items.filter((n) => !isChatAlert(n)), [items]);
  /** The chat family, which drives the unread state of the Chats list. */
  const chatAlerts = useMemo(() => items.filter(isChatAlert), [items]);

  const rows = useMemo<ChatRow[]>(() => {
    const used = new Set<string>();
    const mine: ChatRow[] = threads.map((t) => {
      const unread = chatAlerts.filter(
        (n) => n.kind === 'chat_reply' && n.businessId === t.businessId,
      );
      unread.forEach((n) => used.add(n.id));
      const newest = unread.reduce((at, n) => (n.createdAt > at ? n.createdAt : at), t.lastAt);
      return {
        key: `thread:${t.businessId}`,
        name: t.businessName,
        preview: unread.length ? unread[0].body : t.lastBody,
        fromMe: unread.length === 0 && t.lastAuthorType === 'customer',
        at: newest,
        unreadIds: unread.map((n) => n.id),
        href: `/chat/${t.businessId}`,
      };
    });

    // A customer wrote to a business I answer for: that thread lives in the
    // business inbox, not in my DMs, so give it a row here keyed by the pair.
    const inbox = new Map<string, ChatRow>();
    for (const n of chatAlerts) {
      if (used.has(n.id) || !n.businessId) continue;
      const key = `inbox:${n.businessId}:${n.participantId ?? ''}`;
      const row = inbox.get(key);
      if (row) {
        row.unreadIds.push(n.id);
        if (n.createdAt > row.at) {
          row.at = n.createdAt;
          row.preview = n.body;
        }
        continue;
      }
      inbox.set(key, {
        key,
        name: n.title,
        preview: n.body,
        fromMe: false,
        at: n.createdAt,
        unreadIds: [n.id],
        href:
          n.kind === 'chat_message' && n.participantId
            ? `/inbox/${n.businessId}/${n.participantId}`
            : n.kind === 'chat_message'
              ? `/inbox/${n.businessId}`
              : `/chat/${n.businessId}`,
      });
    }

    return [...mine, ...inbox.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [threads, chatAlerts]);

  const openRow = async (row: ChatRow) => {
    if (row.unreadIds.length) {
      await Promise.all(row.unreadIds.map((id) => repos.notifications.markRead(id)));
      load();
    }
    router.push(row.href as never);
  };

  const openNotification = async (n: AppNotification) => {
    await repos.notifications.markRead(n.id);
    load();
    // Route by kind: orders/bills deep-link straight to the thing; a new
    // request → the workspace; a decision on my booking → the business page; a
    // missed call → the business inbox.
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

  // Clears the ALERTS only — conversations are cleared by opening them, and a
  // button sitting over the alert list must never mark chats read behind you.
  const markAll = async () => {
    await Promise.all(alerts.map((n) => repos.notifications.markRead(n.id)));
    load();
  };

  const chatUnread = chatAlerts.length;
  const alertUnread = alerts.length;

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
                    {alertUnread ? (
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
        {segmentButton('chats', 'Chats', chatUnread || undefined)}
        {segmentButton('alerts', 'Alerts', alertUnread || undefined)}
      </View>

      {segment === 'chats' ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyView
              title="No chats yet"
              subtitle="Message a business from its page and your conversation will show up here."
            />
          }
          renderItem={({ item }) => {
            const unread = item.unreadIds.length > 0;
            return (
              <Card onPress={() => openRow(item)} style={styles.card}>
                <View style={styles.row}>
                  <Avatar name={item.name} size={44} />
                  <View style={styles.info}>
                    <Text weight="semibold">{item.name}</Text>
                    <Text
                      variant="caption"
                      tone={unread ? 'default' : 'muted'}
                      weight={unread ? 'semibold' : 'regular'}
                      numberOfLines={1}
                    >
                      {item.fromMe ? 'You: ' : ''}
                      {item.preview}
                    </Text>
                  </View>
                  <View style={styles.meta}>
                    <Text variant="caption" tone="muted">
                      {timeAgo(item.at)}
                    </Text>
                    {unread ? (
                      <View style={[styles.dot, { backgroundColor: colors.brand }]} />
                    ) : null}
                  </View>
                </View>
              </Card>
            );
          }}
        />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyView
              title="You’re all caught up"
              subtitle="Bookings, orders and bills land here. Messages stay in Chats."
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
  meta: { alignItems: 'flex-end', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSpacer: { width: 8 },
  info: { flex: 1 },
});
