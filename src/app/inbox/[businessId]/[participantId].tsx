/**
 * Inbox conversation — the business side of a customer chat. The logged-in
 * member replies; their reply is attributed to them (so teammates and the owner
 * can see who answered). To the customer it's still one business conversation.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ChatMessage } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { ChatThread } from '@/features/chat/ChatThread';
import { spacing, useColors } from '@/theme/theme';

export default function InboxConversationScreen() {
  const { businessId, participantId } = useLocalSearchParams<{
    businessId: string;
    participantId: string;
  }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const myName = currentUser?.name ?? 'Business';

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    // A guest who chatted while logged out has an anonymous account: a real id
    // but no name on their profile. Fall back to "Guest" rather than showing a
    // blank header or a raw uuid.
    let participantName = 'Guest';
    if (participantId !== 'guest') {
      const user = await repos.users.getById(participantId);
      participantName = user?.name?.trim() || 'Guest';
    }
    return { business, participantName };
  }, [businessId, participantId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  // Business replies show which member answered; customer messages need no label.
  const labelFor = (message: ChatMessage, mine: boolean) =>
    mine ? message.authorName : undefined;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: data.participantName }} />
      <View style={[styles.banner, { borderBottomColor: colors.border }]}>
        <Avatar name={data.participantName} size={32} />
        <View style={styles.info}>
          <Text weight="semibold">{data.participantName}</Text>
          <Text variant="caption" tone="muted">
            Replying as {myName} · {data.business.name}
          </Text>
        </View>
      </View>

      <ChatThread
        businessId={businessId}
        participantId={participantId}
        me={{ type: 'business', name: myName }}
        labelFor={labelFor}
        placeholder={`Reply to ${data.participantName}…`}
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
