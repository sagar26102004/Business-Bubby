/**
 * Workspace › Appointments — service requests to accept/decline and the
 * bookings already on the calendar. Members only.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Booking, BookingStatus } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function WorkspaceBookingsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, bookings] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.bookings.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canAccess = canAccessService(business, meEmployee, currentUser, 'bookings');
    return { business, isMember, canAccess, bookings };
  }, [businessId, currentUser?.id]);

  const setBookingStatus = async (id: string, status: BookingStatus) => {
    await repos.bookings.updateStatus(id, status);
    reload();
  };

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { isMember, canAccess, bookings } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Appointments' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Appointments' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Appointments in Access & permissions." />
      </Screen>
    );
  }

  const requests = bookings.filter((b) => b.status === 'requested');
  const accepted = bookings.filter((b) => b.status === 'accepted');

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Appointments' }} />


      <Section title={`Service requests${requests.length ? ` · ${requests.length}` : ''}`}>
        {requests.length === 0 ? (
          <Text tone="muted">No pending requests.</Text>
        ) : (
          requests.map((b: Booking) => (
            <Card key={b.id} style={styles.card}>
              <View style={styles.topRow}>
                <Text weight="semibold">{b.serviceName}</Text>
                {b.price ? (
                  <Text weight="semibold" tone="brand">
                    {b.price}
                  </Text>
                ) : null}
              </View>
              <Text variant="caption" tone="muted">
                {b.customerName} · {b.when}
              </Text>
              {b.note ? (
                <Text variant="caption" tone="muted" style={styles.note}>
                  “{b.note}”
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Button title="Accept" onPress={() => setBookingStatus(b.id, 'accepted')} style={styles.actionBtn} />
                <Button
                  title="Decline"
                  variant="secondary"
                  onPress={() => setBookingStatus(b.id, 'declined')}
                  style={styles.actionBtn}
                />
              </View>
            </Card>
          ))
        )}
      </Section>

      <Section title={`Accepted${accepted.length ? ` · ${accepted.length}` : ''}`}>
        {accepted.length === 0 ? (
          <Text tone="muted">Nothing booked in yet.</Text>
        ) : (
          accepted.map((b: Booking) => (
            <Card key={b.id} style={styles.card}>
              <View style={styles.topRow}>
                <Text weight="semibold">{b.serviceName}</Text>
                <Text variant="caption" tone="muted">
                  {b.when}
                </Text>
              </View>
              <Text variant="caption" tone="muted">
                {b.customerName}
                {b.price ? ` · ${b.price}` : ''}
              </Text>
              <Button
                title="Mark completed"
                variant="ghost"
                onPress={() => setBookingStatus(b.id, 'completed')}
                style={styles.actionBtn}
              />
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  section: { marginBottom: spacing.xl },
  sectionTitle: { marginBottom: spacing.md },
  card: { marginBottom: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  note: { marginTop: spacing.xs, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
