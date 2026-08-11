/**
 * Fleet & tracking › one tracked item (owner only).
 *
 * Opened from a line inside a vehicle on the tracked-items register. Answers
 * the questions the list deliberately leaves out: whose child is this, how to
 * reach them, which vehicle they ride, and any note the office keeps. Also the
 * one place to rename, move them to another vehicle, or take them off the fleet.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { Vehicle } from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Avatar,
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing } from '@/theme/theme';

const vehicleLabel = (v: Vehicle) => v.name || v.registrationNumber || 'Vehicle';

export default function TrackedItemScreen() {
  const { businessId, itemId } = useLocalSearchParams<{ businessId: string; itemId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [vehicles, items] = await Promise.all([
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
    ]);
    const item = items.find((i) => i.id === itemId);
    if (!item) return { business, vehicles, item: null, customer: null, membership: null };
    // Who the customer actually is, and (when the child came from an enrolment)
    // the plan they're on — that's the "whose child is it" answer.
    const [customer, membership] = await Promise.all([
      repos.users.getById(item.customerId).catch(() => null),
      item.membershipId
        ? repos.memberships.getById(item.membershipId).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { business, vehicles, item, customer, membership };
  }, [businessId, itemId]);

  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, item, customer, membership } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tracked item' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage tracking." />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tracked item' }} />
        <EmptyView title="Not tracked" subtitle="This entry is no longer on the fleet." />
      </Screen>
    );
  }

  const vehicle = vehicles.find((v) => v.id === item.vehicleId);
  const icon = item.kind === 'child' ? '🧒' : '📦';

  const startEdit = () => {
    setDraftLabel(item.label);
    setDraftNote(item.note ?? '');
    setRenaming(true);
  };

  const saveEdit = async () => {
    const label = draftLabel.trim();
    if (label.length < 2) return;
    setSaving(true);
    try {
      await repos.tracking.updateItem(item.id, { label, note: draftNote.trim() || undefined });
      setRenaming(false);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const setVehicle = async (vehicleId: string) => {
    await repos.tracking.updateItem(item.id, {
      vehicleId: item.vehicleId === vehicleId ? undefined : vehicleId,
    });
    reload();
  };

  const remove = async () => {
    await repos.tracking.removeItem(item.id);
    router.back();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: item.label }} />

      <Text variant="title" weight="bold">
        {icon} {item.label}
      </Text>
      <Text tone="muted" style={styles.sub}>
        {item.kind === 'child' ? 'Child' : 'Goods'} ·{' '}
        {vehicle
          ? `on ${getVehicleKind(vehicle.kind).icon} ${vehicleLabel(vehicle)}`
          : 'not on a vehicle yet'}
      </Text>

      {/* Whose child / whose consignment — and how to reach them. */}
      <Card style={styles.card}>
        <Text weight="semibold" style={styles.cardTitle}>
          Tracked by
        </Text>
        <View style={styles.personRow}>
          <Avatar name={item.customerName} size={40} />
          <View style={styles.flex}>
            <Text weight="semibold">{item.customerName}</Text>
            <Text variant="caption" tone="muted">
              {customer?.phone ?? (customer ? 'One Place account' : 'Account not found')}
            </Text>
          </View>
        </View>
        <Button
          title="💬 Message them"
          variant="secondary"
          onPress={() => router.push(`/inbox/${business.id}/${item.customerId}` as Href)}
          style={styles.action}
        />
        {membership ? (
          <Button
            title={`🎫 ${membership.planName} · ${membership.status === 'active' ? 'active' : membership.status}`}
            variant="secondary"
            onPress={() => router.push(`/member/${membership.id}` as Href)}
            style={styles.action}
          />
        ) : null}
      </Card>

      {/* Which vehicle they ride — the assignment that makes tracking work. */}
      <Card style={styles.card}>
        <Text weight="semibold" style={styles.cardTitle}>
          Vehicle
        </Text>
        {vehicles.length === 0 ? (
          <Text variant="caption" tone="muted">
            No vehicles in the fleet yet — add one before assigning.
          </Text>
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {vehicle
                ? 'Tap another to move them, or tap the current one to take them off.'
                : 'Pick a vehicle so the customer can follow it live.'}
            </Text>
            <View style={styles.pillRow}>
              {vehicles.map((v) => (
                <Tag
                  key={v.id}
                  label={vehicleLabel(v)}
                  icon={getVehicleKind(v.kind).icon}
                  selected={item.vehicleId === v.id}
                  onPress={() => setVehicle(v.id)}
                />
              ))}
            </View>
            {vehicle ? (
              <Button
                title="🗺️ Track on map"
                variant="secondary"
                onPress={() => router.push(`/track/${business.id}?vehicle=${vehicle.id}` as Href)}
                style={styles.action}
              />
            ) : null}
          </>
        )}
      </Card>

      {/* Name + office note. */}
      <Card style={styles.card}>
        <Text weight="semibold" style={styles.cardTitle}>
          Details
        </Text>
        {renaming ? (
          <>
            <Input
              label={item.kind === 'child' ? 'Child' : 'Goods'}
              placeholder="e.g. Aarav — Grade 3"
              value={draftLabel}
              onChangeText={setDraftLabel}
            />
            <Input
              label="Note (optional)"
              placeholder="e.g. Drops at Vijay Nagar gate, grandmother collects"
              value={draftNote}
              onChangeText={setDraftNote}
            />
            <Button
              title="Save"
              onPress={saveEdit}
              loading={saving}
              disabled={draftLabel.trim().length < 2}
              style={styles.action}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setRenaming(false)} />
          </>
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {item.note ? item.note : 'No note yet.'}
            </Text>
            <Text variant="caption" tone="muted" style={styles.since}>
              Added {new Date(item.createdAt).toDateString().slice(4)}
            </Text>
            <Button title="✎ Edit name & note" variant="secondary" onPress={startEdit} style={styles.action} />
          </>
        )}
      </Card>

      <Button title="Remove from tracking" variant="ghost" onPress={remove} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  cardTitle: { marginBottom: spacing.sm },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  action: { marginTop: spacing.md },
  since: { marginTop: spacing.xs },
});
