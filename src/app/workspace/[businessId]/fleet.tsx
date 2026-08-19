/**
 * Workspace › Fleet & live location — everything the fleet needs in ONE place:
 * the driver's live-share toggle, the live fleet map, and (owner) the vehicle
 * and tracked-item screens. There used to be a second "Manage fleet & tracking"
 * hub in between that only repeated these links (and a duplicate map button);
 * its tiles now live here directly. Members only.
 */
import { StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { getVehicleKind } from '@/domain/catalog';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { startBackgroundShare, stopBackgroundShare } from '@/lib/backgroundLocation';
import {
  BackgroundLocationDisclosure,
  useBackgroundLocationDisclosure,
} from '@/features/fleet/BackgroundLocationDisclosure';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

export default function WorkspaceFleetScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, vehicles, items, sharing] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
      currentUser
        ? repos.tracking.isSharing(business.id, currentUser.id)
        : Promise.resolve(false),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isOwner = currentUser?.id === business.ownerId;
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canAccess = canAccessService(business, meEmployee, currentUser, 'fleet');
    return { business, vehicles, items, sharing, meEmployee, isOwner, isMember, canAccess };
  }, [businessId, currentUser?.id]);

  // Above the early returns — hooks cannot run conditionally.
  const { confirm, disclosureProps } = useBackgroundLocationDisclosure();

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, items, sharing, meEmployee, isOwner, isMember, canAccess } = data;
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
    if (value) {
      // `confirm` shows the Play-required disclosure, and only if the OS is
      // actually about to be asked for background location.
      const res = await startBackgroundShare(confirm);
      if (!res.ok) {
        showAlert(
          'Location permission needed',
          'Allow location access to share your live position.',
        );
        return;
      }
      // `declined` is the driver having just read the disclosure and said no —
      // pointing them at Settings would be arguing with an answer we asked for.
      if (res.background === false && res.reason !== 'web' && res.reason !== 'declined') {
        showAlert(
          'Sharing while the app is open',
          'For your vehicle to keep moving when the app is closed, set location access to "Allow all the time" in Settings.',
        );
      }
    } else {
      await stopBackgroundShare();
    }
    await repos.tracking.setSharing(business.id, currentUser.id, value);
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Fleet & tracking' }} />
      <BackgroundLocationDisclosure {...disclosureProps} />

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

      {/* The one and only live-map entry point. */}
      {vehicles.length > 0 ? (
        <Button title="🗺️ Live fleet map" onPress={() => router.push(`/track/${business.id}`)} />
      ) : (
        <Text tone="muted">
          No vehicles yet.{isOwner ? ' Add your fleet to start live tracking.' : ''}
        </Text>
      )}

      {/* Owner tools, straight on this page — no "Manage fleet" hop. */}
      {isOwner ? (
        <View style={styles.tiles}>
          <HubTile
            icon="🚌"
            label="Vehicles"
            sub={
              vehicles.length
                ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · add, assign drivers, journeys`
                : 'Add your first vehicle'
            }
            onPress={() => router.push(`/fleet/${business.id}/vehicles` as Href)}
          />
          <HubTile
            icon="📌"
            label="Assign to a vehicle"
            sub="Pick a bus, search a student or parcel, tap to put them aboard"
            onPress={() => router.push(`/fleet/${business.id}/assign` as Href)}
          />
          <HubTile
            icon="🧒"
            label="Tracked for customers"
            sub={
              items.length
                ? `${items.length} aboard · children & goods, by vehicle`
                : 'Register a child or goods to a customer'
            }
            onPress={() => router.push(`/fleet/${business.id}/items` as Href)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function HubTile({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: string;
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} style={styles.tile}>
      <View style={styles.tileRow}>
        <Text style={styles.tileIcon}>{icon}</Text>
        <View style={styles.flex}>
          <Text weight="semibold">{label}</Text>
          <Text variant="caption" tone="muted">
            {sub}
          </Text>
        </View>
        <Text tone="muted" style={styles.chev}>
          ›
        </Text>
      </View>
    </Card>
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
  flex: { flex: 1 },
  tiles: { marginTop: spacing.lg },
  tile: { marginBottom: spacing.md },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tileIcon: { fontSize: 28 },
  chev: { fontSize: 22 },
});
