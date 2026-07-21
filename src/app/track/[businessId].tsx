/**
 * Live tracking map — where a business's vehicles are right now.
 *
 * Role-aware:
 *  - Members (owner/employees) see the whole fleet.
 *  - Customers see only the vehicles carrying THEIR tracked items — a parent
 *    follows the bus with their children aboard, a sender follows the van
 *    with their parcel.
 *
 * A vehicle's live position is its driver's shared location (see
 * TrackingRepository). The screen polls every few seconds — the mock stand-in
 * for a realtime location stream. Same schematic projection as map.tsx, so it
 * runs on web and native without a map SDK.
 */
import { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { GeoPoint, TrackedItem } from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import type { LiveVehicle } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area shown around the business
const RING_KMS = [1, 3, 5];
const MARKER = 44;
const POLL_MS = 3000;

export default function TrackScreen() {
  // `vehicle` (optional) preselects one vehicle — set when arriving from a
  // "Track on map" button on a specific vehicle's card.
  const { businessId, vehicle } = useLocalSearchParams<{ businessId: string; vehicle?: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | undefined>(
    typeof vehicle === 'string' ? vehicle : undefined,
  );
  const [live, setLive] = useState<LiveVehicle[] | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const isOwner = currentUser?.id === business.ownerId;
    const isMember = isOwner || employees.some((e) => e.userId && e.userId === currentUser?.id);
    // Members follow the whole fleet; customers only their own children/goods.
    const items = isMember
      ? await repos.tracking.listItems(business.id)
      : currentUser
        ? await repos.tracking.listItemsForCustomer(currentUser.id, business.id)
        : [];
    return { business, isMember, items };
  }, [businessId, currentUser?.id]);

  // Poll live positions — the mock stand-in for a realtime stream.
  useEffect(() => {
    let active = true;
    const tick = () =>
      repos.tracking
        .getLiveVehicles(businessId)
        .then((v) => active && setLive(v))
        .catch(() => {});
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [businessId, repos]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const center = data?.business.location.point;

  // Project a coordinate to an {x, y} pixel within the canvas (see map.tsx).
  const project = useMemo(() => {
    if (!center || !size.width || !size.height) return null;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const pad = MARKER;
    const pxPerKm = (Math.min(size.width, size.height) / 2 - pad) / RADIUS_KM;
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((center.latitude * Math.PI) / 180);
    return (point: GeoPoint) => {
      const eastKm = (point.longitude - center.longitude) * kmPerDegLng;
      const northKm = (point.latitude - center.latitude) * kmPerDegLat;
      return { x: cx + eastKm * pxPerKm, y: cy - northKm * pxPerKm, pxPerKm, cx, cy };
    };
  }, [center, size]);

  if (loading) return <LoadingView label="Loading live tracking…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, items } = data;

  if (!isMember && items.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Live tracking' }} />
        <EmptyView
          title="Nothing to track yet"
          subtitle={`${business.name} hasn't set up tracking for you. Ask them to add your child or goods to a vehicle.`}
        />
      </Screen>
    );
  }

  // Customers only see vehicles that carry something of theirs.
  const myVehicleIds = new Set(items.map((i) => i.vehicleId).filter(Boolean));
  const visible = (live ?? []).filter((lv) => isMember || myVehicleIds.has(lv.vehicle.id));
  const markers = visible.filter((lv) => lv.point);
  const itemsByVehicle = (vehicleId: string) => items.filter((i) => i.vehicleId === vehicleId);
  const selected = visible.find((lv) => lv.vehicle.id === selectedId);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: `Live · ${business.name}` }} />

      <View style={[styles.canvas, { backgroundColor: colors.surfaceAlt }]} onLayout={onLayout}>
        {project && center ? (
          <>
            {/* Range rings around the business's area */}
            {RING_KMS.map((km) => {
              const r = km * project(center).pxPerKm;
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
                      left: project(center).cx - r,
                      top: project(center).cy - r,
                      borderColor: colors.border,
                    },
                  ]}
                />
              );
            })}

            {/* Vehicle markers at their live positions */}
            {markers.map((lv) => {
              const p = project(lv.point!);
              const kind = getVehicleKind(lv.vehicle.kind);
              const isSel = lv.vehicle.id === selectedId;
              return (
                <Pressable
                  key={lv.vehicle.id}
                  onPress={() => setSelectedId(lv.vehicle.id)}
                  style={[
                    styles.marker,
                    {
                      left: p.x - MARKER / 2,
                      top: p.y - MARKER / 2,
                      backgroundColor: colors.accent,
                      borderColor: isSel ? colors.text : colors.surface,
                      borderWidth: isSel ? 3 : 2,
                      transform: [{ scale: isSel ? 1.15 : 1 }],
                    },
                  ]}
                >
                  <Text style={styles.markerEmoji}>{kind.icon}</Text>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {/* Legend */}
        <View style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="caption" tone="muted">
            {live === null
              ? 'Connecting…'
              : markers.length > 0
                ? `🔴 LIVE · ${markers.length} vehicle${markers.length === 1 ? '' : 's'} · updates every ${POLL_MS / 1000}s`
                : 'No vehicle is sharing a location right now'}
          </Text>
        </View>

        {/* Selected vehicle details */}
        {selected ? (
          <View style={styles.sheet}>
            <Card>
              <Text weight="semibold">
                {getVehicleKind(selected.vehicle.kind).icon} {selected.vehicle.name}
              </Text>
              <Text variant="caption" tone="muted">
                {selected.driverName ? `Driver: ${selected.driverName} · ` : ''}
                {selected.sharing ? `updated ${agoLabel(selected.updatedAt)}` : 'not sharing'}
              </Text>
              {itemsByVehicle(selected.vehicle.id).length > 0 ? (
                <Text variant="caption" tone="muted" style={styles.aboard}>
                  Aboard:{' '}
                  {itemsByVehicle(selected.vehicle.id)
                    .map((i) => `${i.kind === 'child' ? '🧒' : '📦'} ${i.label}`)
                    .join(' · ')}
                </Text>
              ) : null}
            </Card>
          </View>
        ) : null}
      </View>

      {/* What the viewer is tracking */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {isMember
          ? visible.map((lv) => (
              <VehicleRow
                key={lv.vehicle.id}
                lv={lv}
                aboardCount={itemsByVehicle(lv.vehicle.id).length}
                selected={lv.vehicle.id === selectedId}
                onPress={() => setSelectedId(lv.vehicle.id)}
              />
            ))
          : items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                lv={visible.find((lv) => lv.vehicle.id === item.vehicleId)}
                onPress={() => item.vehicleId && setSelectedId(item.vehicleId)}
              />
            ))}
        {isMember && visible.length === 0 ? (
          <Text tone="muted">No vehicles yet — add your fleet from the workspace.</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Fleet row for business members. */
function VehicleRow({
  lv,
  aboardCount,
  selected,
  onPress,
}: {
  lv: LiveVehicle;
  aboardCount: number;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const kind = getVehicleKind(lv.vehicle.kind);
  return (
    <Card
      onPress={onPress}
      style={{ ...styles.row, ...(selected ? { borderWidth: 1, borderColor: colors.accent } : null) }}
    >
      <View style={styles.rowInner}>
        <Text style={styles.rowIcon}>{kind.icon}</Text>
        <View style={styles.rowInfo}>
          <Text weight="semibold">{lv.vehicle.name}</Text>
          <Text variant="caption" tone="muted">
            {lv.driverName ? `Driver: ${lv.driverName}` : 'No driver assigned'}
            {aboardCount ? ` · ${aboardCount} aboard` : ''}
          </Text>
        </View>
        <StatusBadge lv={lv} />
      </View>
    </Card>
  );
}

/** Child/goods row for customers. */
function ItemRow({
  item,
  lv,
  onPress,
}: {
  item: TrackedItem;
  lv?: LiveVehicle;
  onPress: () => void;
}) {
  return (
    <Card onPress={lv ? onPress : undefined} style={styles.row}>
      <View style={styles.rowInner}>
        <Text style={styles.rowIcon}>{item.kind === 'child' ? '🧒' : '📦'}</Text>
        <View style={styles.rowInfo}>
          <Text weight="semibold">{item.label}</Text>
          <Text variant="caption" tone="muted">
            {lv
              ? `On ${lv.vehicle.name}${lv.driverName ? ` · ${lv.driverName}` : ''}`
              : 'Not assigned to a vehicle yet'}
          </Text>
        </View>
        {lv ? <StatusBadge lv={lv} /> : null}
      </View>
    </Card>
  );
}

function StatusBadge({ lv }: { lv: LiveVehicle }) {
  const colors = useColors();
  return lv.sharing ? (
    <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
      <Text variant="caption" weight="semibold" style={{ color: colors.success }}>
        ● LIVE · {agoLabel(lv.updatedAt)}
      </Text>
    </View>
  ) : (
    <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="caption" weight="semibold" tone="muted">
        ○ Offline
      </Text>
    </View>
  );
}

/** "just now" / "12s ago" / "3m ago" for a share timestamp. */
function agoLabel(iso?: string): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 1 },
  marker: {
    position: 'absolute',
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerEmoji: { fontSize: 20 },
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
    bottom: spacing.md,
  },
  aboard: { marginTop: spacing.xs },
  list: { maxHeight: 230 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  row: { marginBottom: spacing.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { fontSize: 26 },
  rowInfo: { flex: 1 },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
});
