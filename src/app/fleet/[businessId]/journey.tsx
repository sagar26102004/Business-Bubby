/**
 * Fleet & tracking › Vehicle journeys (owner only).
 *
 * A vehicle's saved routes: the owner builds a journey by giving a start and an
 * end — typed by name OR pinned on a real map — then adds the stops in between.
 * A vehicle can hold several journeys (morning run, way back home, evening
 * batch); one is marked active. A return trip is one tap: it clones the journey
 * with start/end swapped and stops reversed.
 *
 * Journeys live on the Vehicle object (`Vehicle.journeys` / `activeJourneyId`)
 * and are saved through the generic `TrackingRepository.updateVehicle`, so no
 * new endpoint is needed — the same on every backend.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { GeoPoint, JourneyStop, Vehicle, VehicleJourney } from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { LocationPicker } from '@/features/businesses/LocationPicker';
import RouteMap from '@/components/RouteMap';
import {
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
import { radius, spacing, useColors } from '@/theme/theme';

const genId = () => `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** A blank stop draft (used for start, end and each in-between stop). */
const blankStop = (): JourneyStop => ({ id: genId(), label: '' });

/** Which field's map picker is open. */
type PickerTarget = 'start' | 'end' | string | null;

export default function VehicleJourneyScreen() {
  const { businessId, vehicle: vehicleId } = useLocalSearchParams<{
    businessId: string;
    vehicle?: string;
  }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const colors = useColors();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const vehicles = await repos.tracking.listVehicles(business.id);
    const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
    return { business, vehicle };
  }, [businessId, vehicleId]);

  // ── Journey editor state ───────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState<JourneyStop>(blankStop());
  const [end, setEnd] = useState<JourneyStop>(blankStop());
  const [stops, setStops] = useState<JourneyStop[]>([]);
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // Which saved journey has its route preview expanded.
  const [previewId, setPreviewId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setStart(blankStop());
    setEnd(blankStop());
    setStops([]);
    setPickerFor(null);
    setFormError(null);
    setShowForm(false);
  };

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicle } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Journeys' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage journeys." />
      </Screen>
    );
  }
  if (!vehicle) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Journeys' }} />
        <EmptyView title="Vehicle not found" subtitle="It may have been removed from the fleet." />
      </Screen>
    );
  }

  const journeys = vehicle.journeys ?? [];
  const kind = getVehicleKind(vehicle.kind);

  const persist = async (patch: Partial<Vehicle>) => {
    await repos.tracking.updateVehicle(vehicle.id, patch);
    reload();
  };

  const startEdit = (j: VehicleJourney) => {
    setEditingId(j.id);
    setName(j.name);
    setStart({ ...j.start });
    setEnd({ ...j.end });
    setStops(j.stops.map((s) => ({ ...s })));
    setPickerFor(null);
    setFormError(null);
    setShowForm(true);
  };

  const saveJourney = async () => {
    if (!name.trim()) {
      setFormError('Give the journey a name, e.g. “Morning route”.');
      return;
    }
    if (!start.label.trim()) {
      setFormError('Set the starting point (type it or pin it on the map).');
      return;
    }
    if (!end.label.trim()) {
      setFormError('Set the ending point (type it or pin it on the map).');
      return;
    }
    // Drop empty in-between stops.
    const cleanStops = stops
      .filter((s) => s.label.trim() || s.point)
      .map((s) => ({ ...s, label: s.label.trim() || 'Stop' }));
    const journey: VehicleJourney = {
      id: editingId ?? genId(),
      name: name.trim(),
      start: { ...start, label: start.label.trim() },
      end: { ...end, label: end.label.trim() },
      stops: cleanStops,
      createdAt:
        (editingId && journeys.find((j) => j.id === editingId)?.createdAt) || new Date().toISOString(),
    };
    const next = editingId
      ? journeys.map((j) => (j.id === editingId ? journey : j))
      : [...journeys, journey];
    setSaving(true);
    try {
      // First journey becomes active automatically.
      const patch: Partial<Vehicle> = { journeys: next };
      if (!vehicle.activeJourneyId) patch.activeJourneyId = journey.id;
      await persist(patch);
      resetForm();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the journey.');
    } finally {
      setSaving(false);
    }
  };

  const setActive = (j: VehicleJourney) =>
    persist({ activeJourneyId: vehicle.activeJourneyId === j.id ? undefined : j.id });

  const deleteJourney = (j: VehicleJourney) =>
    persist({
      journeys: journeys.filter((x) => x.id !== j.id),
      activeJourneyId: vehicle.activeJourneyId === j.id ? undefined : vehicle.activeJourneyId,
    });

  /** Clone a journey as its reverse — the way back home. */
  const addReturnTrip = (j: VehicleJourney) => {
    const reversed: VehicleJourney = {
      id: genId(),
      name: /morning|to /i.test(j.name) ? 'Way back home' : `${j.name} (return)`,
      start: { ...j.end, id: genId() },
      end: { ...j.start, id: genId() },
      stops: [...j.stops].reverse().map((s) => ({ ...s, id: genId() })),
      createdAt: new Date().toISOString(),
    };
    return persist({ journeys: [...journeys, reversed] });
  };

  const addStop = () => setStops((s) => [...s, blankStop()]);
  const removeStop = (id: string) => setStops((s) => s.filter((x) => x.id !== id));
  const setStopLabel = (id: string, label: string) =>
    setStops((s) => s.map((x) => (x.id === id ? { ...x, label } : x)));

  // Route a pin pick to whichever field opened the picker.
  const applyPick = (point: GeoPoint) => {
    if (pickerFor === 'start') setStart((s) => ({ ...s, point }));
    else if (pickerFor === 'end') setEnd((e) => ({ ...e, point }));
    else if (typeof pickerFor === 'string')
      setStops((s) => s.map((x) => (x.id === pickerFor ? { ...x, point } : x)));
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Journeys' }} />

      <Text variant="title" weight="bold">
        {kind.icon} {vehicle.name}
      </Text>
      <Text variant="caption" tone="muted" style={styles.sub}>
        Set the routes this vehicle runs. Type a place or drop a pin — then add the stops along the
        way.
      </Text>

      {/* ── Saved journeys ─────────────────────────────────────────────── */}
      {journeys.length === 0 && !showForm ? (
        <Card style={styles.card}>
          <Text weight="semibold">No journeys yet</Text>
          <Text variant="caption" tone="muted" style={styles.sub}>
            Create the first route for this vehicle — a start, an end, and the stops between.
          </Text>
        </Card>
      ) : null}

      {journeys.map((j) => {
        const isActive = vehicle.activeJourneyId === j.id;
        const routePts = journeyPoints(j);
        const canPreview = !!j.start.point && !!j.end.point;
        const showPreview = previewId === j.id && canPreview;
        return (
          <Card key={j.id} style={styles.card}>
            <View style={styles.jHead}>
              <Text weight="semibold" style={styles.flex}>
                {j.name}
              </Text>
              {isActive ? <Tag label="● Active" tone="brand" /> : null}
            </View>
            <Text variant="caption" tone="muted" style={styles.route}>
              🟢 {j.start.label} → 🔴 {j.end.label}
            </Text>
            {j.stops.length > 0 ? (
              <Text variant="caption" tone="muted">
                {j.stops.length} stop{j.stops.length === 1 ? '' : 's'}:{' '}
                {j.stops.map((s) => s.label).join(' · ')}
              </Text>
            ) : (
              <Text variant="caption" tone="muted">
                No stops in between
              </Text>
            )}

            {showPreview ? (
              <View style={[styles.previewMap, { borderColor: colors.border }]}>
                <RouteMap
                  from={j.start.point!}
                  to={j.end.point!}
                  stops={routePts.mid}
                  fromEmoji="🟢"
                  fromColor="#16a34a"
                  toEmoji="🔴"
                  toColor="#dc2626"
                />
              </View>
            ) : null}

            <View style={styles.jActions}>
              <Tag label={isActive ? '✓ Active' : 'Set active'} selected={isActive} onPress={() => setActive(j)} />
              {canPreview ? (
                <Tag
                  label={showPreview ? 'Hide map' : '🗺️ Preview'}
                  onPress={() => setPreviewId(showPreview ? null : j.id)}
                />
              ) : null}
              <Tag label="↩ Return trip" onPress={() => addReturnTrip(j)} />
              <Tag label="✎ Edit" onPress={() => startEdit(j)} />
              <Tag label="🗑 Delete" onPress={() => deleteJourney(j)} />
            </View>
            {!canPreview ? (
              <Text variant="caption" tone="muted" style={styles.pinHint}>
                Pin the start and end on the map to preview the route.
              </Text>
            ) : null}
          </Card>
        );
      })}

      {/* ── New / edit journey ─────────────────────────────────────────── */}
      {showForm ? (
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.formTitle}>
            {editingId ? '✎ Edit journey' : '➕ New journey'}
          </Text>
          <Input
            label="Journey name"
            placeholder="e.g. Morning route, Way back home"
            value={name}
            onChangeText={setName}
          />

          <LocationField
            label="Starting point"
            emoji="🟢"
            stop={start}
            open={pickerFor === 'start'}
            onLabel={(t) => setStart((s) => ({ ...s, label: t }))}
            onTogglePin={() => setPickerFor(pickerFor === 'start' ? null : 'start')}
            onPick={applyPick}
          />

          {/* Stops between start and end */}
          <Text variant="label" weight="medium" style={styles.fieldLabel}>
            Stops in between
          </Text>
          {stops.length === 0 ? (
            <Text variant="caption" tone="muted" style={styles.pinHint}>
              Add each stop the vehicle makes along the way (optional).
            </Text>
          ) : null}
          {stops.map((s, i) => (
            <LocationField
              key={s.id}
              label={`Stop ${i + 1}`}
              emoji={String(i + 1)}
              stop={s}
              open={pickerFor === s.id}
              onLabel={(t) => setStopLabel(s.id, t)}
              onTogglePin={() => setPickerFor(pickerFor === s.id ? null : s.id)}
              onPick={applyPick}
              onRemove={() => removeStop(s.id)}
            />
          ))}
          <Button title="＋ Add a stop" variant="secondary" onPress={addStop} style={styles.addStop} />

          <LocationField
            label="Ending point"
            emoji="🔴"
            stop={end}
            open={pickerFor === 'end'}
            onLabel={(t) => setEnd((e) => ({ ...e, label: t }))}
            onTogglePin={() => setPickerFor(pickerFor === 'end' ? null : 'end')}
            onPick={applyPick}
          />

          {formError ? (
            <Text variant="caption" tone="danger" style={styles.fieldLabel}>
              {formError}
            </Text>
          ) : null}
          <View style={styles.formBtns}>
            <Button title={editingId ? 'Save changes' : 'Save journey'} onPress={saveJourney} loading={saving} style={styles.flex} />
            <Button title="Cancel" variant="ghost" onPress={resetForm} style={styles.flex} />
          </View>
        </Card>
      ) : (
        <Button
          title="➕ New journey"
          onPress={() => {
            resetForm();
            setShowForm(true);
          }}
          style={styles.newBtn}
        />
      )}
    </Screen>
  );
}

/** Start/end/stop → the coordinate list for the route preview. */
function journeyPoints(j: VehicleJourney): { mid: GeoPoint[] } {
  return { mid: j.stops.map((s) => s.point).filter((p): p is GeoPoint => !!p) };
}

/** A single place field: a text input, a "pin on map" toggle, and (when open)
 *  an inline map picker. Text OR pin — either is enough. */
function LocationField({
  label,
  emoji,
  stop,
  open,
  onLabel,
  onTogglePin,
  onPick,
  onRemove,
}: {
  label: string;
  emoji: string;
  stop: JourneyStop;
  open: boolean;
  onLabel: (t: string) => void;
  onTogglePin: () => void;
  onPick: (p: GeoPoint) => void;
  onRemove?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text variant="label" weight="medium">
          {emoji} {label}
        </Text>
        {onRemove ? (
          <Text variant="caption" tone="danger" weight="semibold" onPress={onRemove}>
            Remove
          </Text>
        ) : null}
      </View>
      <Input placeholder="Type a place name" value={stop.label} onChangeText={onLabel} />
      <View style={styles.fieldRow}>
        <Tag
          label={stop.point ? '📍 Pinned · edit' : '📍 Pin on map'}
          selected={!!stop.point}
          onPress={onTogglePin}
        />
        {stop.point ? (
          <Text variant="caption" tone="success">
            ✓ Location set
          </Text>
        ) : null}
      </View>
      {open ? (
        <View style={[styles.picker, { borderColor: colors.border }]}>
          <LocationPicker value={stop.point} onChange={onPick} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  jHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  route: { marginTop: spacing.xs },
  jActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  pinHint: { marginTop: spacing.sm },
  previewMap: {
    height: 260,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  formTitle: { marginBottom: spacing.md },
  field: { marginTop: spacing.md },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  fieldLabel: { marginTop: spacing.lg, marginBottom: spacing.xs },
  picker: { marginTop: spacing.md, borderRadius: radius.lg, borderWidth: 1, padding: spacing.sm },
  addStop: { marginTop: spacing.md },
  formBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  newBtn: { marginTop: spacing.sm },
});
