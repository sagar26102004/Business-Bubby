/**
 * Map view — businesses plotted around the user's current location on a REAL
 * street map (Leaflet + OpenStreetMap tiles, via <RealMap>). Works on web and
 * native (Expo Go) with no map SDK, no native rebuild and no API key.
 *
 * Range rings show 1/3/5 km. Tapping a marker selects it and reveals a card;
 * tapping the card opens the full business page.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { Business } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Card, ErrorView, LoadingView, Screen, Stars, Text } from '@/components/ui';
import RealMap, { type RealMapMarker } from '@/components/RealMap';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area shown around the user
const RING_KMS = [1, 3, 5];

export default function MapScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | undefined>();

  const { data, loading, error, reload } = useAsync(async () => {
    const center = await repos.places.getCurrentPlace();
    const businesses = await repos.businesses.list({
      near: center.point,
      maxDistanceKm: RADIUS_KM,
      sortByDistance: true,
    });
    return { center: center.point, businesses };
  }, []);

  if (loading) return <LoadingView label="Loading map…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  const withLocation = data.businesses.filter((b) => b.location.point);
  const selected = withLocation.find((b) => b.id === selectedId);
  const markers: RealMapMarker[] = withLocation.map((b) => ({
    id: b.id,
    point: b.location.point!,
    emoji: getType(b.type)?.icon ?? '📍',
    color: getType(b.type)?.color ?? colors.brand,
  }));

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Map · nearby' }} />

      <View style={styles.canvas}>
        <RealMap
          center={data.center}
          markers={markers}
          ringsKm={RING_KMS}
          selectedId={selectedId}
          onMarkerPress={setSelectedId}
        />

        {/* Legend */}
        <View
          pointerEvents="none"
          style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="caption" tone="muted">
            ◉ You · rings at {RING_KMS.join('/')} km · {markers.length} nearby
          </Text>
        </View>
      </View>

      {/* Selected business card */}
      {selected ? (
        <View style={styles.sheet}>
          <SelectedCard business={selected} onPress={() => router.push(`/business/${selected.id}`)} />
        </View>
      ) : (
        <View style={styles.sheet}>
          <View style={[styles.hint, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="caption" tone="muted" style={styles.hintText}>
              Tap a marker to preview a business, then open it for full details.
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}

function SelectedCard({ business, onPress }: { business: Business; onPress: () => void }) {
  const type = getType(business.type);
  const distance = formatDistance(business.distanceKm);
  return (
    <Card onPress={onPress}>
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, { backgroundColor: type?.color ?? '#888' }]}>
          <Text style={styles.cardEmoji}>{type?.icon ?? '📍'}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text weight="semibold" numberOfLines={1}>
            {business.name}
          </Text>
          {business.providerType ? (
            <Text variant="caption" tone="muted">
              {business.providerType}
              {distance ? ` · ${distance}` : ''}
            </Text>
          ) : null}
          <View style={styles.cardMeta}>
            <Stars rating={business.ratingAvg} count={business.ratingCount} />
          </View>
        </View>
        <Text tone="accent" weight="semibold">
          View ›
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  legend: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  sheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
  },
  hint: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintText: { textAlign: 'center' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 22 },
  cardInfo: { flex: 1 },
  cardMeta: { marginTop: 4 },
});
