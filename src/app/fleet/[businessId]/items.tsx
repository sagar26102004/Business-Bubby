/**
 * Fleet & tracking › Tracked for customers (owner only).
 *
 * The READ-ONLY register of who and what rides on the fleet. A single bus can
 * carry 30–40 children and a truck a whole manifest of goods, so this is
 * deliberately a VEHICLE-first list, not a wall of cards: each vehicle is one
 * collapsed row showing how many are aboard, and opening it reveals a compact
 * line per child/parcel. Tapping a line opens that item's own page (whose child
 * it is, which vehicle, notes). The search box cuts straight to one name across
 * the whole fleet, so nobody has to expand five buses to find Aarav.
 *
 * Putting people ON a vehicle is a different job with a different shape — it
 * lives in its own screen (`./assign`), reached from Fleet & live location.
 */
import { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { TrackedItem, TrackedItemKind, Vehicle } from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  SearchField,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const itemIcon = (kind: TrackedItemKind) => (kind === 'child' ? '🧒' : '📦');

/** Vehicle label: the pet name, falling back to the number plate. */
const vehicleLabel = (v: Vehicle) => v.name || v.registrationNumber || 'Vehicle';

export default function FleetItemsScreen() {
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

  // Which vehicle rows are open. Everything starts collapsed — the point of the
  // screen is that a 40-child bus is one line until you ask for it.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  const term = query.trim().toLowerCase();
  // Search spans the label AND the customer, so "Aarav" and "Mahendra" both
  // find the same child.
  const matches = useMemo(() => {
    if (!term) return [];
    return (data?.items ?? []).filter(
      (i) =>
        i.label.toLowerCase().includes(term) ||
        i.customerName.toLowerCase().includes(term) ||
        (i.note ?? '').toLowerCase().includes(term),
    );
  }, [data?.items, term]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, items } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tracked items' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage tracking." />
      </Screen>
    );
  }

  const itemsOn = (vehicleId: string) => items.filter((i) => i.vehicleId === vehicleId);
  const unassigned = items.filter((i) => !i.vehicleId || !vehicles.some((v) => v.id === i.vehicleId));

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  };

  const openItem = (item: TrackedItem) =>
    router.push(`/fleet/${business.id}/item/${item.id}` as Href);

  /** One compact line inside an open vehicle (or in the search results). */
  const renderRow = (item: TrackedItem, last: boolean, showVehicle = false) => {
    const vehicle = vehicles.find((v) => v.id === item.vehicleId);
    return (
      <Pressable
        key={item.id}
        onPress={() => openItem(item)}
        style={[
          styles.row,
          !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.label}`}
      >
        <Text style={styles.rowIcon}>{itemIcon(item.kind)}</Text>
        <View style={styles.flex}>
          <Text weight="medium" numberOfLines={1}>
            {item.label}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {item.customerName}
            {showVehicle
              ? ` · ${vehicle ? `${getVehicleKind(vehicle.kind).icon} ${vehicleLabel(vehicle)}` : 'no vehicle'}`
              : ''}
          </Text>
        </View>
        <Text tone="muted" style={styles.rowChev}>
          ›
        </Text>
      </Pressable>
    );
  };

  /** A vehicle as ONE collapsed row: icon, name, how many aboard. */
  const renderVehicle = (v: Vehicle) => {
    const aboard = itemsOn(v.id);
    const open = expanded[v.id];
    return (
      <Card key={v.id} style={styles.group}>
        <Pressable
          onPress={() => toggle(v.id)}
          style={styles.groupHeader}
          accessibilityRole="button"
          accessibilityLabel={`${vehicleLabel(v)}, ${aboard.length} aboard`}
        >
          <Text style={styles.rowIcon}>{getVehicleKind(v.kind).icon}</Text>
          <View style={styles.flex}>
            <Text weight="semibold">{vehicleLabel(v)}</Text>
            <Text variant="caption" tone="muted">
              {aboard.length === 0
                ? 'Nobody aboard yet'
                : `${aboard.length} aboard`}
              {v.registrationNumber && v.registrationNumber !== v.name
                ? ` · ${v.registrationNumber}`
                : ''}
            </Text>
          </View>
          <Text tone="muted" style={styles.rowChev}>
            {open ? '▾' : '▸'}
          </Text>
        </Pressable>
        {open && aboard.length > 0 ? (
          <View style={[styles.groupBody, { borderTopColor: colors.border }]}>
            {aboard.map((i, idx) => renderRow(i, idx === aboard.length - 1))}
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Tracked items' }} />

      {/* Straight to one name, without expanding a single vehicle. */}
      <SearchField
        placeholder="Search a child, parcel or customer…"
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search tracked children and goods"
      />

      {term ? (
        <>
          <Text variant="caption" tone="muted" style={styles.hint}>
            {matches.length === 0
              ? `Nothing matches “${query.trim()}”.`
              : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
          </Text>
          {matches.length > 0 ? (
            <Card style={styles.group}>
              <View style={styles.searchBody}>
                {matches.map((i, idx) => renderRow(i, idx === matches.length - 1, true))}
              </View>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          {items.length === 0 ? (
            <Text variant="caption" tone="muted" style={styles.hint}>
              Nobody is tracked yet. Use “Assign to a vehicle” in Fleet &amp; live location to put
              students or goods aboard.
            </Text>
          ) : null}

          {vehicles.map(renderVehicle)}

          {/* Anything not on a vehicle can't actually be followed — surface it. */}
          {unassigned.length > 0 ? (
            <Card style={styles.group}>
              <Pressable
                onPress={() => toggle('unassigned')}
                style={styles.groupHeader}
                accessibilityRole="button"
                accessibilityLabel={`Not on a vehicle, ${unassigned.length}`}
              >
                <Text style={styles.rowIcon}>⚠️</Text>
                <View style={styles.flex}>
                  <Text weight="semibold">Not on a vehicle</Text>
                  <Text variant="caption" tone="muted">
                    {unassigned.length} waiting · customers can’t track these yet
                  </Text>
                </View>
                <Text tone="muted" style={styles.rowChev}>
                  {expanded.unassigned ? '▾' : '▸'}
                </Text>
              </Pressable>
              {expanded.unassigned ? (
                <View style={[styles.groupBody, { borderTopColor: colors.border }]}>
                  {unassigned.map((i, idx) => renderRow(i, idx === unassigned.length - 1))}
                </View>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { marginTop: spacing.xs, marginBottom: spacing.sm },
  group: { marginBottom: spacing.sm, paddingVertical: 0 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  groupBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: spacing.lg },
  searchBody: { paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  rowIcon: { fontSize: 22 },
  rowChev: { fontSize: 20 },
});
