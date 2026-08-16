/**
 * Inbox conversation — the business side of a customer chat. The logged-in
 * member replies; their reply is attributed to them (so teammates and the owner
 * can see who answered). To the customer it's still one business conversation.
 *
 * Gated like the inbox list it's opened from: chat recipients plus
 * owner/managers. The URL is guessable, so the check has to live here too.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ChatMessage } from '@/domain/types';
import { isManagerOrOwner } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
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
    const employees = await repos.employees.listByBusiness(business.id);
    return { business, participantName, employees };
  }, [businessId, participantId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  const meEmployee = data.employees.find((e) => e.userId && e.userId === currentUser?.id);
  const chatAccessIds = new Set(data.business.chatRecipientIds ?? []);
  const canReply =
    isManagerOrOwner(data.business, meEmployee, currentUser) ||
    (meEmployee ? chatAccessIds.has(meEmployee.id) : false);

  if (!canReply) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Chat' }} />
        <EmptyView
          title="Members only"
          subtitle={`Only ${data.business.name}'s team can read its customer chats.`}
        />
      </Screen>
    );
  }

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
