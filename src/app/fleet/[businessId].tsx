/**
 * Fleet & tracking — the owner's hub (owner only).
 *
 * Rather than piling vehicles, tracked items and the map onto one screen, this
 * is a short menu that routes to a dedicated page per job:
 *  - Vehicles        → add/remove vehicles, pin a driver, track one on the map.
 *  - Tracked items   → what each customer follows (a child, goods) on a vehicle.
 *  - Live map        → the whole fleet, live.
 */
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function FleetScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [vehicles, items] = await Promise.all([
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
    ]);
    return { business, vehicles, items };
  }, [businessId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, items } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fleet & tracking' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage the fleet." />
      </Screen>
    );
  }

  const base = `/fleet/${business.id}`;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Fleet & tracking' }} />

      <HubTile
        icon="🚌"
        label="Vehicles"
        sub={
          vehicles.length
            ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · add, assign drivers, track`
            : 'Add your first vehicle'
        }
        onPress={() => router.push(`${base}/vehicles` as Href)}
      />
      <HubTile
        icon="🧒"
        label="Tracked for customers"
        sub={
          items.length
            ? `${items.length} item${items.length === 1 ? '' : 's'} · children & goods on vehicles`
            : 'Register a child or goods to a customer'
        }
        onPress={() => router.push(`${base}/items` as Href)}
      />
      <HubTile
        icon="🗺️"
        label="Live fleet map"
        sub="See where every vehicle is right now"
        onPress={() => router.push(`/track/${business.id}`)}
      />
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
  const colors = useColors();
  return (
    <Card onPress={onPress} style={styles.tile}>
      <View style={styles.tileRow}>
        <Text style={styles.tileIcon}>{icon}</Text>
        <View style={styles.tileText}>
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
  tile: { marginBottom: spacing.md },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tileIcon: { fontSize: 28 },
  tileText: { flex: 1 },
  chev: { fontSize: 22 },
});
