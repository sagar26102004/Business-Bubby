/**
 * Fleet & tracking › Vehicle journeys (owner only).
 *
 * A vehicle's saved routes. There are TWO ways to build one, because owners
 * differ: **mark it on the map** (the easy way — a guided pin drop for the
 * start, the end and each stop, with the road route drawn in blue) or **type
 * the coordinates** of every point when they already have them. Both write the
 * same `JourneyStop`s, so a journey started on the map can be fine-tuned by
 * hand and vice versa.
 *
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
import { RouteBuilder, type BuiltRoute } from '@/features/fleet/RouteBuilder';
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

/** How the owner is entering this journey's points. */
type BuildMode = 'map' | 'coords';

/** Typed lat/lng text, kept raw so half-typed numbers don't wipe the field. */
type CoordText = { lat: string; lng: string };

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
  const [mode, setMode] = useState<BuildMode>('map');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [coordText, setCoordText] = useState<Record<string, CoordText>>({});
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
    setMode('map');
    setBuilderOpen(false);
    setCoordText({});
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
    // A journey that was pinned reopens on the map; a typed one reopens typed.
    setMode(j.start.point && j.end.point ? 'map' : 'coords');
    setBuilderOpen(false);
    setCoordText({});
    setFormError(null);
    setShowForm(true);
  };

  const saveJourney = async () => {
    if (!name.trim()) {
      setFormError('Give the journey a name, e.g. “Morning route”.');
      return;
    }
    if (!start.label.trim() && !start.point) {
      setFormError('Set the starting point — mark it on the map or type its coordinates.');
      return;
    }
    if (!end.label.trim() && !end.point) {
      setFormError('Set the ending point — mark it on the map or type its coordinates.');
      return;
    }
    // Drop empty in-between stops.
    const cleanStops = stops
      .filter((s) => s.label.trim() || s.point)
      .map((s, i) => ({ ...s, label: s.label.trim() || `Stop ${i + 1}` }));
    const journey: VehicleJourney = {
      id: editingId ?? genId(),
      name: name.trim(),
      start: { ...start, label: start.label.trim() || 'Start' },
      end: { ...end, label: end.label.trim() || 'End' },
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

  /** Apply a patch to whichever of start / end / a stop owns this id. */
  const patchStop = (id: string, patch: Partial<JourneyStop>) => {
    if (id === start.id) setStart((s) => ({ ...s, ...patch }));
    else if (id === end.id) setEnd((e) => ({ ...e, ...patch }));
    else setStops((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  /** Raw text for a point's lat/lng boxes — typed text wins over the pin. */
  const textFor = (s: JourneyStop): CoordText =>
    coordText[s.id] ?? {
      lat: s.point ? String(s.point.latitude) : '',
      lng: s.point ? String(s.point.longitude) : '',
    };

  /** Typing coordinates sets the point only once BOTH boxes hold a valid number. */
  const updateCoord = (s: JourneyStop, field: keyof CoordText, value: string) => {
    const next = { ...textFor(s), [field]: value };
    setCoordText((t) => ({ ...t, [s.id]: next }));
    const lat = Number(next.lat.trim());
    const lng = Number(next.lng.trim());
    const ok =
      next.lat.trim() !== '' &&
      next.lng.trim() !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180;
    patchStop(s.id, { point: ok ? { latitude: lat, longitude: lng } : undefined });
  };

  /** Pins marked on the map replace the whole route in one go. */
  const applyBuiltRoute = (r: BuiltRoute) => {
    const s = r.start ? { id: genId(), label: r.start.label, point: r.start.point } : start;
    const e = r.end ? { id: genId(), label: r.end.label, point: r.end.point } : end;
    setStart(s);
    setEnd(e);
    setStops(r.stops.map((x) => ({ id: genId(), label: x.label, point: x.point })));
    setCoordText({});
    setBuilderOpen(false);
    setFormError(null);
    // Name it after the route if the owner hasn't named it yet.
    if (!name.trim() && r.start && r.end) setName(`${r.start.label} → ${r.end.label}`);
  };

  const markedCount = (start.point ? 1 : 0) + (end.point ? 1 : 0) + stops.filter((s) => s.point).length;

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

          {/* How do you want to set the route? */}
          <Text variant="label" weight="medium" style={styles.fieldLabel}>
            How do you want to set the route?
          </Text>
          <View style={styles.modeRow}>
            <Tag
              label="🗺️ Mark on the map"
              selected={mode === 'map'}
              onPress={() => setMode('map')}
            />
            <Tag
              label="⌨️ Type coordinates"
              selected={mode === 'coords'}
              onPress={() => setMode('coords')}
            />
          </View>

          {mode === 'map' ? (
            <View style={styles.mapMode}>
              <Text variant="caption" tone="muted">
                The map asks you for the starting point first, then the ending point, then stop 1,
                2, 3… — drop a pin, move it if it's off, and confirm. The blue road route is drawn
                through every stop.
              </Text>
              {markedCount > 0 ? (
                <View style={styles.pinList}>
                  <RouteLine badge="S" color="#16a34a" stop={start} />
                  {stops.map((s, i) => (
                    <RouteLine key={s.id} badge={String(i + 1)} color="#f59e0b" stop={s} />
                  ))}
                  <RouteLine badge="E" color="#dc2626" stop={end} />
                </View>
              ) : null}
              <Button
                title={markedCount > 0 ? '🗺️ Edit the pins on the map' : '🗺️ Open the map & mark pins'}
                onPress={() => setBuilderOpen(true)}
              />
            </View>
          ) : (
            <View>
              <CoordField
                label="Starting point"
                badge="S"
                color="#16a34a"
                stop={start}
                text={textFor(start)}
                onLabel={(t) => setStart((s) => ({ ...s, label: t }))}
                onCoord={(f, v) => updateCoord(start, f, v)}
              />

              <Text variant="label" weight="medium" style={styles.fieldLabel}>
                Stops in between
              </Text>
              {stops.length === 0 ? (
                <Text variant="caption" tone="muted" style={styles.pinHint}>
                  Add each stop the vehicle makes along the way (optional).
                </Text>
              ) : null}
              {stops.map((s, i) => (
                <CoordField
                  key={s.id}
                  label={`Stop ${i + 1}`}
                  badge={String(i + 1)}
                  color="#f59e0b"
                  stop={s}
                  text={textFor(s)}
                  onLabel={(t) => patchStop(s.id, { label: t })}
                  onCoord={(f, v) => updateCoord(s, f, v)}
                  onRemove={() => removeStop(s.id)}
                />
              ))}
              <Button
                title="＋ Add a stop"
                variant="secondary"
                onPress={addStop}
                style={styles.addStop}
              />

              <CoordField
                label="Ending point"
                badge="E"
                color="#dc2626"
                stop={end}
                text={textFor(end)}
                onLabel={(t) => setEnd((e) => ({ ...e, label: t }))}
                onCoord={(f, v) => updateCoord(end, f, v)}
              />
            </View>
          )}

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

      {builderOpen ? (
        <RouteBuilder
          center={business.location.point}
          initial={{
            start: start.point ? { label: start.label, point: start.point } : undefined,
            end: end.point ? { label: end.label, point: end.point } : undefined,
            stops: stops
              .filter((s) => s.point)
              .map((s) => ({ label: s.label, point: s.point! })),
          }}
          onCancel={() => setBuilderOpen(false)}
          onDone={applyBuiltRoute}
        />
      ) : null}
    </Screen>
  );
}

/** Start/end/stop → the coordinate list for the route preview. */
function journeyPoints(j: VehicleJourney): { mid: GeoPoint[] } {
  return { mid: j.stops.map((s) => s.point).filter((p): p is GeoPoint => !!p) };
}

/** One line of the marked-route summary shown under the map option. */
function RouteLine({ badge, color, stop }: { badge: string; color: string; stop: JourneyStop }) {
  return (
    <View style={styles.pinRow}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text variant="caption" weight="bold" tone="inverse">
          {badge}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text variant="caption" numberOfLines={1}>
          {stop.label || (stop.point ? 'Pinned location' : 'Not marked yet')}
        </Text>
        {stop.point ? (
          <Text variant="caption" tone="muted">
            {stop.point.latitude.toFixed(5)}, {stop.point.longitude.toFixed(5)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A place typed by hand: its name plus the exact latitude and longitude. */
function CoordField({
  label,
  badge,
  color,
  stop,
  text,
  onLabel,
  onCoord,
  onRemove,
}: {
  label: string;
  badge: string;
  color: string;
  stop: JourneyStop;
  text: CoordText;
  onLabel: (t: string) => void;
  onCoord: (field: keyof CoordText, value: string) => void;
  onRemove?: () => void;
}) {
  const half = (text.lat.trim() === '') !== (text.lng.trim() === '');
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <View style={styles.pinRow}>
          <View style={[styles.badge, { backgroundColor: color }]}>
            <Text variant="caption" weight="bold" tone="inverse">
              {badge}
            </Text>
          </View>
          <Text variant="label" weight="medium">
            {label}
          </Text>
        </View>
        {onRemove ? (
          <Text variant="caption" tone="danger" weight="semibold" onPress={onRemove}>
            Remove
          </Text>
        ) : null}
      </View>
      <Input placeholder="Place name, e.g. Vijay Nagar Square" value={stop.label} onChangeText={onLabel} />
      <View style={styles.coordRow}>
        <View style={styles.flex}>
          <Input
            label="Latitude"
            placeholder="22.75213"
            keyboardType="numbers-and-punctuation"
            value={text.lat}
            onChangeText={(v) => onCoord('lat', v)}
          />
        </View>
        <View style={styles.flex}>
          <Input
            label="Longitude"
            placeholder="75.89321"
            keyboardType="numbers-and-punctuation"
            value={text.lng}
            onChangeText={(v) => onCoord('lng', v)}
          />
        </View>
      </View>
      {half ? (
        <Text variant="caption" tone="danger">
          Enter both latitude and longitude to place this point on the map.
        </Text>
      ) : stop.point ? (
        <Text variant="caption" tone="success">
          ✓ Coordinates set
        </Text>
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
  fieldLabel: { marginTop: spacing.lg, marginBottom: spacing.xs },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  mapMode: { gap: spacing.md },
  pinList: { gap: spacing.sm },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  coordRow: { flexDirection: 'row', gap: spacing.sm },
  addStop: { marginTop: spacing.md },
  formBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  newBtn: { marginTop: spacing.sm },
});
