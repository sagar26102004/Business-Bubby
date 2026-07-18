/**
 * Map view — businesses plotted around the user's current location.
 *
 * This is a self-contained map: it projects each business's real coordinates
 * onto a plane centred on the user, so it works on web and native with no map
 * SDK or native rebuild. Range rings show 1/3/5 km. Tapping a marker selects it
 * and reveals a card; tapping the card opens the full business page.
 *
 * To upgrade to real street tiles later (react-native-maps / expo-maps in a
 * native build), swap the <MapCanvas> internals — the data flow stays the same.
 */
import { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { Business, GeoPoint } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Card, ErrorView, LoadingView, Screen, Stars, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area shown around the user
const RING_KMS = [1, 3, 5];
const MARKER = 40;

export default function MapScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();

  const [size, setSize] = useState({ width: 0, height: 0 });
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

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  // Project a business coordinate to an {x, y} pixel within the canvas.
  const project = useMemo(() => {
    const center = data?.center;
    if (!center || !size.width || !size.height) return null;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const pad = MARKER; // keep markers off the edges
    const pxPerKm = (Math.min(size.width, size.height) / 2 - pad) / RADIUS_KM;
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((center.latitude * Math.PI) / 180);
    return (point: GeoPoint) => {
      const eastKm = (point.longitude - center.longitude) * kmPerDegLng;
      const northKm = (point.latitude - center.latitude) * kmPerDegLat;
      return { x: cx + eastKm * pxPerKm, y: cy - northKm * pxPerKm, pxPerKm, cx, cy };
    };
  }, [data?.center, size]);

  if (loading) return <LoadingView label="Loading map…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  const selected = data.businesses.find((b) => b.id === selectedId);
  const markers = data.businesses.filter((b) => b.location.point);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Map · nearby' }} />

      <View style={[styles.canvas, { backgroundColor: colors.surfaceAlt }]} onLayout={onLayout}>
        {project ? (
          <>
            {/* Range rings */}
            {RING_KMS.map((km) => {
              const r = km * project(data.center).pxPerKm;
              return (
                <View
                  key={km}
                  pointerEvents="none"
                  style={[
                    styles.ring,
                    {
                      width: r * 2,
                      height: r * 2,
                      borderRadius: r,
                      left: project(data.center).cx - r,
                      top: project(data.center).cy - r,
                      borderColor: colors.border,
                    },
                  ]}
                />
              );
            })}

            {/* User location */}
            <View
              pointerEvents="none"
              style={[
                styles.userDot,
                {
                  left: project(data.center).cx - 9,
                  top: project(data.center).cy - 9,
                  backgroundColor: colors.accent,
                  borderColor: colors.surface,
                },
              ]}
            />

            {/* Business markers */}
            {markers.map((b) => {
              const p = project(b.location.point!);
              const type = getType(b.type);
              const isSel = b.id === selectedId;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setSelectedId(b.id)}
                  style={[
                    styles.marker,
                    {
                      left: p.x - MARKER / 2,
                      top: p.y - MARKER / 2,
                      backgroundColor: type?.color ?? colors.brand,
                      borderColor: isSel ? colors.text : colors.surface,
                      borderWidth: isSel ? 3 : 2,
                      transform: [{ scale: isSel ? 1.15 : 1 }],
                    },
                  ]}
                >
                  <Text style={styles.markerEmoji}>{type?.icon ?? '📍'}</Text>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {/* Legend */}
        <View style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
  ring: { position: 'absolute', borderWidth: 1 },
  userDot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
  marker: {
    position: 'absolute',
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerEmoji: { fontSize: 18 },
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
