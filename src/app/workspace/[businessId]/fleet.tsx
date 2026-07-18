/**
 * Workspace › Fleet & live location — the driver's live-share toggle, the
 * live fleet map, and (owner) the link to manage vehicles & tracked items.
 * Members only.
 */
import { StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getVehicleKind } from '@/domain/catalog';
import { canAccessService } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function WorkspaceFleetScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, vehicles, sharing] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.tracking.listVehicles(business.id),
      currentUser
        ? repos.tracking.isSharing(business.id, currentUser.id)
        : Promise.resolve(false),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isOwner = currentUser?.id === business.ownerId;
    const isMember = isOwner || !!meEmployee;
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'fleet');
    return { business, vehicles, sharing, meEmployee, isOwner, isMember, canAccess };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, sharing, meEmployee, isOwner, isMember, canAccess } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fleet & tracking' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fleet & tracking' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Fleet & tracking in Access & permissions." />
      </Screen>
    );
  }

  // Vehicles this member drives — sharing their location puts them on the map.
  const myVehicles = meEmployee
    ? vehicles.filter((v) => v.driverEmployeeId === meEmployee.id)
    : [];

  const toggleSharing = async (value: boolean) => {
    if (!currentUser) return;
    await repos.tracking.setSharing(business.id, currentUser.id, value);
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Fleet & tracking' }} />

      <Text tone="muted" style={styles.subtitle}>
        Track your vehicles live — school buses, goods, deliveries.
      </Text>

      {myVehicles.length > 0 ? (
        <Card style={styles.shareCard}>
          <Text weight="semibold">
            You drive: {myVehicles.map((v) => `${getVehicleKind(v.kind).icon} ${v.name}`).join(', ')}
          </Text>
          <Text variant="caption" tone="muted">
            Share your live location during the shift — the owner and the customers whose children or
            goods are aboard see your vehicle move. Turn it off when you’re done.
          </Text>
          <View style={styles.switchRow}>
            <Text>📡 Share my live location</Text>
            <Switch value={sharing} onValueChange={toggleSharing} />
          </View>
        </Card>
      ) : null}

      {vehicles.length > 0 ? (
        <Button title="🗺️ Live fleet map" onPress={() => router.push(`/track/${business.id}`)} />
      ) : (
        <Text tone="muted">
          No vehicles yet.{isOwner ? ' Add your fleet to start live tracking.' : ''}
        </Text>
      )}

      {isOwner ? (
        <Button
          title="🚌 Manage fleet & tracking"
          variant="secondary"
          onPress={() => router.push(`/fleet/${business.id}`)}
          style={styles.manageBtn}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  shareCard: { marginBottom: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  manageBtn: { marginTop: spacing.md },
});
