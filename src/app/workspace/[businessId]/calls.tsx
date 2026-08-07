/**
 * Workspace › Call log — every voice call this business received in the last
 * 7 days: answered, missed and declined alike, newest first. Sits beside the
 * customer chats because it answers the same question ("who tried to reach
 * us?") — and a missed call taps straight through to that customer's inbox
 * thread so someone can follow it up.
 *
 * Visible to the people who actually handle contact: owner/managers, chat
 * recipients and call handlers.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Call } from '@/domain/types';
import { isManagerOrOwner } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Card, EmptyView, ErrorView, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** How far back the log reaches. */
const WINDOW_DAYS = 7;

type Outcome = 'answered' | 'missed' | 'declined' | 'live';

function outcomeOf(call: Call): Outcome {
  if (call.status === 'ringing' || call.status === 'active') return 'live';
  if (call.status === 'declined') return 'declined';
  if (call.status === 'missed') return 'missed';
  // Ended: it only counts as answered if someone on the business side picked up.
  return call.answeredAt ? 'answered' : 'missed';
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  answered: 'Answered',
  missed: 'Missed',
  declined: 'Declined',
  live: 'On the line',
};

const OUTCOME_ICON: Record<Outcome, string> = {
  answered: '📞',
  missed: '📵',
  declined: '🚫',
  live: '🟢',
};

/** "3m 12s" for an answered call; empty when it never connected. */
function durationLabel(call: Call): string {
  if (!call.answeredAt || !call.endedAt) return '';
  const secs = Math.max(
    0,
    Math.round((new Date(call.endedAt).getTime() - new Date(call.answeredAt).getTime()) / 1000),
  );
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** "Today · 4:05 pm", "Yesterday · 9:12 am", "Mon 4 Aug · 9:12 am". */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(at)) / 86_400_000);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

/** Business-side people who actually picked up. */
function answeredBy(call: Call): string {
  return call.participants
    .filter((p) => p.side === 'business' && (p.state === 'joined' || p.state === 'left') && p.joinedAt)
    .map((p) => p.name)
    .join(', ');
}

/** Business-side people who were rung — for a missed call, everyone who rang. */
function rangLabel(call: Call): string {
  const names = call.participants.filter((p) => p.side === 'business').map((p) => p.name);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(' & ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

export default function WorkspaceCallsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isOwner = currentUser?.id === business.ownerId;
    const isMember = isOwner || !!meEmployee;
    // Same audience as the chats tile: whoever handles the business's contact.
    const canManageAll = isManagerOrOwner(business, meEmployee, currentUser?.id);
    const hasChatAccess = isOwner || (meEmployee ? (business.chatRecipientIds ?? []).includes(meEmployee.id) : false);
    const takesCalls = isOwner
      ? business.ownerHandlesCalls !== false
      : meEmployee
        ? (business.callHandlerIds ?? []).includes(meEmployee.id)
        : false;
    const canAccess = canManageAll || hasChatAccess || takesCalls;
    const calls = isMember && canAccess ? await repos.calls.listForBusiness(business.id) : [];
    return { business, isMember, canAccess, calls };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { isMember, canAccess, calls } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Call log' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Call log' }} />
        <EmptyView
          title="No access"
          subtitle="Only the owner, managers and the people who answer calls or chats can see the call log."
        />
      </Screen>
    );
  }

  const missed = calls.filter((c) => outcomeOf(c) === 'missed' || outcomeOf(c) === 'declined').length;
  const answered = calls.filter((c) => outcomeOf(c) === 'answered').length;

  const tone = (o: Outcome) =>
    o === 'missed' || o === 'declined' ? colors.danger : o === 'live' ? colors.brand : colors.text;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Call log' }} />

      <Text variant="subheading" weight="bold">
        Last {WINDOW_DAYS} days
      </Text>
      <Text variant="caption" tone="muted" style={styles.subtitle}>
        {calls.length === 0
          ? 'No one has called yet.'
          : `${calls.length} call${calls.length === 1 ? '' : 's'} · ${answered} answered · ${missed} missed`}
      </Text>

      {calls.length === 0 ? (
        <EmptyView
          title="No calls this week"
          subtitle="Voice calls to this business — answered and missed — will be listed here."
        />
      ) : (
        calls.map((call) => {
          const outcome = outcomeOf(call);
          const duration = durationLabel(call);
          const picked = answeredBy(call);
          // A caller with an account can be followed up in the inbox; a guest
          // left no thread to open.
          const followUp =
            call.customerId && call.customerId !== 'guest'
              ? () => router.push(`/inbox/${call.businessId}/${call.customerId}`)
              : undefined;
          return (
            <Card key={call.id} onPress={followUp} style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.iconBox, { backgroundColor: colors.surfaceAlt }]}>
                  <Text style={styles.icon}>{OUTCOME_ICON[outcome]}</Text>
                </View>
                <View style={styles.info}>
                  <Text weight="semibold" numberOfLines={1}>
                    {call.customerName}
                  </Text>
                  <Text variant="caption" style={{ color: tone(outcome) }}>
                    {OUTCOME_LABEL[outcome]}
                    {duration ? ` · ${duration}` : ''}
                    {outcome === 'answered' && picked ? ` · by ${picked}` : ''}
                    {outcome !== 'answered' && rangLabel(call) ? ` · rang ${rangLabel(call)}` : ''}
                  </Text>
                </View>
                <Text variant="caption" tone="muted" style={styles.when}>
                  {whenLabel(call.startedAt)}
                </Text>
              </View>
              {followUp && outcome !== 'answered' ? (
                <View style={styles.followUp}>
                  <Tag label="💬 Message back" tone="brand" />
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  info: { flex: 1 },
  when: { textAlign: 'right' },
  followUp: { flexDirection: 'row', marginTop: spacing.sm, marginLeft: 40 + spacing.md },
});
