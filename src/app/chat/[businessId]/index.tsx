/**
 * Customer chat with a business — a single conversation. The customer just
 * drops a message; whoever the owner has given chat access replies, and each
 * reply is attributed as "‹member› from ‹business›".
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ChatMessage } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { ChatThread } from '@/features/chat/ChatThread';
import { getType } from '@/domain/catalog';
import { spacing, useColors } from '@/theme/theme';

export default function CustomerChatScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const participantId = currentUser?.id ?? 'guest';
  const authorName = currentUser?.name ?? 'Guest';

  const { data, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  const business = data;
  const type = getType(business.type);

  // Business replies show "‹member› from ‹business›"; my own messages have no label.
  const labelFor = (message: ChatMessage, mine: boolean) =>
    mine ? undefined : `${message.authorName} from ${business.name}`;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: business.name }} />
      <View style={[styles.banner, { borderBottomColor: colors.border }]}>
        <Avatar name={business.name} uri={undefined} size={32} />
        <View style={styles.info}>
          <Text weight="semibold">{business.name}</Text>
          <Text variant="caption" tone="muted">
            {type ? `${type.icon} ${type.singular}` : 'Chat'} · usually replies within a day
          </Text>
        </View>
      </View>

      <ChatThread
        businessId={businessId}
        participantId={participantId}
        me={{ type: 'customer', name: authorName }}
        labelFor={labelFor}
        placeholder={`Message ${business.name}…`}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: { flex: 1 },
});
