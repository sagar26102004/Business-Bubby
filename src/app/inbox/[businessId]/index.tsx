/**
 * Business inbox — one conversation per customer. Any member with chat access
 * (assigned by the owner) can open a conversation and reply.
 *
 * Gated the same way the workspace's "Customer chats" tile is: chat is contact
 * ROUTING, not a grantable service, so the audience is the chat recipients plus
 * owner/managers. Without this a stranger reaching the URL saw an inbox rather
 * than a closed door — harmless on Supabase (RLS returns them no rows) but
 * wrong on any backend that trusts the client, and misleading either way.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { isManagerOrOwner } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, Card, EmptyView, ErrorView, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function BusinessInboxScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [threads, employees] = await Promise.all([
      repos.chat.listBusinessThreads(business.id),
      repos.employees.listByBusiness(business.id),
    ]);
    return { business, threads, employees };
  }, [businessId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const meEmployee = data.employees.find((e) => e.userId && e.userId === currentUser?.id);
  const chatAccessIds = new Set(data.business.chatRecipientIds ?? []);
  const canRead =
    isManagerOrOwner(data.business, meEmployee, currentUser) ||
    (meEmployee ? chatAccessIds.has(meEmployee.id) : false);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Inbox' }} />
        <EmptyView
          title="Members only"
          subtitle={`Only ${data.business.name}'s team can read its customer chats.`}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Inbox' }} />

      {data.threads.length === 0 ? (
        <EmptyView
          title="No messages yet"
          subtitle="When a customer chats this business, the conversation shows up here."
        />
      ) : (
        data.threads.map((t) => (
          <Card
            key={t.participantId}
            onPress={() => router.push(`/inbox/${businessId}/${t.participantId}`)}
            style={styles.card}
          >
            <View style={styles.row}>
              <Avatar name={t.participantName} size={44} />
              <View style={styles.info}>
                <View style={styles.titleRow}>
                  <Text weight="semibold">{t.participantName}</Text>
                  {t.lastAuthorType === 'customer' ? (
                    <Tag label="Awaiting reply" />
                  ) : null}
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {t.lastBody}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.count} message{t.count === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
