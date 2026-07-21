/**
 * Business inbox — one conversation per customer. Any member with chat access
 * (assigned by the owner) can open a conversation and reply. Also the dev/
 * testing surface for reading a business's chats.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, Card, EmptyView, ErrorView, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function BusinessInboxScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const threads = await repos.chat.listBusinessThreads(business.id);
    return { business, threads };
  }, [businessId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

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
