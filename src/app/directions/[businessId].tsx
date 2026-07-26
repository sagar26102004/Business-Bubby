/**
 * Directions to a business — the "location button" on the business page opens
 * this. It shows the shop's exact spot on a real street map and the driving
 * route from where you are now, drawn as a blue line just like Google Maps.
 *
 * The route is computed by the free OSRM public router inside <RouteMap>; here
 * we just supply the two points (your current location + the shop) and show the
 * address, distance and drive time on top.
 */
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import { getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import RouteMap, { type RouteSummary } from '@/components/RouteMap';
import { hasShowableCoordinates, locationSummary } from '@/features/businesses/location';
import { radius, spacing, useColors } from '@/theme/theme';

export default function DirectionsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();

  const [route, setRoute] = useState<RouteSummary | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const from = await repos.places.getCurrentPlace();
    return { business, from: from.point };
  }, [businessId]);

  if (loading) return <LoadingView label="Finding the way…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" subtitle="This listing may have been removed." />;

  const { business, from } = data;
  const type = getType(business.type);

  // Honour the owner's privacy choice: no precise pin, no route.
  if (!hasShowableCoordinates(business.location)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Directions' }} />
        <EmptyView
          title="Exact location not shared"
          subtitle={`${business.name} keeps its precise address private — ${locationSummary(
            business.location,
          )}.`}
        />
      </Screen>
    );
  }

  const to = business.location.point!;
  // A one-tap handoff to the phone's real maps app for turn-by-turn navigation.
  const openInMaps = () => {
    const dest = `${to.latitude},${to.longitude}`;
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,
    );
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: `Directions · ${business.name}` }} />

      <View style={styles.canvas}>
        <RouteMap
          from={from}
          to={to}
          toEmoji={type?.icon ?? '📍'}
          toColor={type?.color ?? colors.brand}
          onRoute={setRoute}
        />
      </View>

      <View style={styles.sheet}>
        <Card>
          <Text weight="semibold" numberOfLines={1}>
            📍 {business.name}
          </Text>
          <Text variant="caption" tone="muted" style={styles.address}>
            {locationSummary(business.location)}
          </Text>
          <Text variant="caption" tone="brand" weight="semibold" style={styles.summary}>
            {route
              ? `🚗 ${route.durationMin < 1 ? '<1' : Math.round(route.durationMin)} min · ${
                  route.distanceKm < 1
                    ? `${Math.round(route.distanceKm * 1000)} m`
                    : `${route.distanceKm.toFixed(1)} km`
                } by road`
              : 'Drawing the route…'}
          </Text>
          <Button
            title="🧭 Open in Maps for navigation"
            variant="secondary"
            onPress={openInMaps}
            style={styles.mapsBtn}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  sheet: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl },
  address: { marginTop: 2 },
  summary: { marginTop: spacing.xs },
  mapsBtn: { marginTop: spacing.md },
});
