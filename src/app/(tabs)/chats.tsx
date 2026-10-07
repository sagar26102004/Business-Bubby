/**
 * Chat tab — the customer's DM list (one conversation per business, like
 * Instagram DMs).
 *
 * This tab is the CUSTOMER side only. Alerts a person gets because they run or
 * work at a business — a new order, a customer's message, a missed call to the
 * shop — belong to the Workspace (unread business messages badge the Workspace
 * tab, and are read in the business inbox). See `isBusinessAlert`.
 *
 * A business's reply to me shows here as an unread conversation — the thread
 * IS the announcement. Everything else that happened to me as a customer (my
 * enrolments, orders, bookings, bills) is under the bell on Explore
 * (`app/alerts.tsx`); it used to be a second segment of this tab.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { AppNotification } from '@/domain/types';
import type { CustomerThreadSummary } from '@/data/repositories';
import { categoryOfKind, isBusinessAlert } from '@/domain/notifications';
import { useMyBusinessIds } from '@/features/notifications/alertSides';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { CHAT_REFRESH_MS } from '@/lib/useAsync';
import { timeAgo } from '@/lib/timeAgo';
import { Avatar, Card, EmptyView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

/** The chat family of alerts — they drive the unread state of each conversation. */
const isChatAlert = (n: AppNotification) => categoryOfKind(n.kind) === 'chats';

/** One row in the Chats list — a conversation I started with a business. */
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
  const myBusinessIds = useMyBusinessIds();

  const [threads, setThreads] = useState<CustomerThreadSummary[]>([]);
  const [chatAlerts, setChatAlerts] = useState<AppNotification[]>([]);

  const load = useCallback(() => {
    repos.chat.listCustomerThreads(participantId).then(setThreads);
    // Only the unread chat alerts matter here: they mark conversations unread.
    repos.notifications
      .listForUser(participantId)
      .then((list) =>
        setChatAlerts(list.filter((n) => !n.read && isChatAlert(n) && !isBusinessAlert(n, myBusinessIds))),
      );
  }, [repos, participantId, myBusinessIds]);

  // Refresh whenever the tab regains focus, and keep re-reading while it IS
  // focused — a reply has to show up on the list you're looking
  // at, not only after you leave the tab and come back.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, CHAT_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );


  const rows = useMemo<ChatRow[]>(() => {
    const mine: ChatRow[] = threads.map((t) => {
      const unread = chatAlerts.filter(
        (n) => n.kind === 'chat_reply' && n.businessId === t.businessId,
      );
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

    return mine.sort((a, b) => b.at.localeCompare(a.at));
  }, [threads, chatAlerts]);

  const openRow = async (row: ChatRow) => {
    if (row.unreadIds.length) {
      await Promise.all(row.unreadIds.map((id) => repos.notifications.markRead(id)));
      load();
    }
    router.push(row.href as never);
  };

  return (
    <Screen padded={false}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { alignItems: 'flex-end', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  info: { flex: 1 },
});
