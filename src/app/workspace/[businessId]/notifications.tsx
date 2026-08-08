/**
 * Workspace › Manage notifications — the member's own alert switchboard for
 * THIS business. An owner drowning in order pings silences Orders here and
 * still works the orders desk normally; nothing stops arriving, it just stops
 * buzzing. Everyone who can open the workspace can set their own.
 */
import { StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { enabledModules } from '@/domain/modules';
import type { NotificationCategory } from '@/domain/notifications';
import { isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { MuteSettings } from '@/features/notifications/MuteSettings';
import { spacing } from '@/theme/theme';

export default function WorkspaceNotificationsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    return { business, isMember };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Notifications' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }

  // Only offer families this business can actually produce: chats and calls are
  // universal, the rest follow the modules it runs (plus stall questions for a
  // personal stall).
  const mods = new Set(enabledModules(business));
  const categories: NotificationCategory[] = [
    ...(mods.has('orders') ? (['orders'] as const) : []),
    'chats',
    'calls',
    ...(mods.has('bookings') ? (['bookings'] as const) : []),
    ...(mods.has('billing') ? (['billing'] as const) : []),
    ...(mods.has('memberships') ? (['members'] as const) : []),
    'reviews',
    ...(business.type === 'item' ? (['stall'] as const) : []),
  ];

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Text variant="subheading" weight="bold">
        Alerts from {business.name}
      </Text>
      <Text variant="caption" tone="muted" style={styles.subtitle}>
        Your own settings — they don’t change what your teammates get.
      </Text>
      <MuteSettings businessId={business.id} scopeLabel={business.name} categories={categories} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
});
