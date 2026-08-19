/**
 * Saved places — Home, Work, and any other spot you want to browse around.
 *
 * The location dropdown on Home has always OFFERED saved places; until now
 * there was no way to create one, so it only ever showed the device's GPS fix.
 * This is where they come from.
 *
 * Two ways to set the point, because both are the obvious one depending on
 * where you're standing: "Use my current location" when you're at the place,
 * and a tap on the map when you're not.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import RealMap from '@/components/RealMap';
import { useRepositories } from '@/data/DataProvider';
import type { GeoPoint, PlaceKind, SavedPlace } from '@/domain/types';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  ErrorView,
  Icon,
  Input,
  ListGroup,
  ListRow,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

type NewKind = Exclude<PlaceKind, 'current'>;

const KIND_LABEL: Record<NewKind, string> = { home: 'Home', work: 'Work', custom: 'Other' };

export default function SavedPlacesScreen() {
  const repos = useRepositories();
  const colors = useColors();

  const { data: places, loading, error, reload } = useAsync(() => repos.places.listPlaces(), []);

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<NewKind>('home');
  const [label, setLabel] = useState('Home');
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The place whose remove is armed and waiting for a second tap. */
  const [armed, setArmed] = useState<string | null>(null);

  const current = places?.find((p) => p.kind === 'current');
  const saved = useMemo(() => (places ?? []).filter((p) => p.kind !== 'current'), [places]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;

  /** Picking a kind renames the place with it, unless it's a custom one. */
  const chooseKind = (next: NewKind) => {
    setKind(next);
    if (next !== 'custom') setLabel(KIND_LABEL[next]);
    else if (label === 'Home' || label === 'Work') setLabel('');
  };

  const startAdding = () => {
    setFormError(null);
    // Seed the pin at the device's fix — the map has to be centred on something,
    // and "where you are now" is right far more often than not.
    setPoint(current?.point ?? null);
    setKind('home');
    setLabel('Home');
    setAdding(true);
  };

  const useCurrentLocation = async () => {
    setFormError(null);
    try {
      const place = await repos.places.getCurrentPlace();
      setPoint(place.point);
    } catch {
      setFormError('Couldn’t read your location. Tap the map to place the pin instead.');
    }
  };

  const save = async () => {
    setFormError(null);
    if (!point) {
      setFormError('Tap the map to choose the spot, or use your current location.');
      return;
    }
    setBusy(true);
    try {
      await repos.places.savePlace({ label: label.trim() || KIND_LABEL[kind], kind, point });
      setAdding(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that place.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Removal is two taps, not one, and the confirmation is the row itself: the
   * first tap arms it, the second removes. Nothing is destroyed by a thumb
   * brushing a list.
   */
  const remove = async (place: SavedPlace) => {
    if (armed !== place.id) {
      setArmed(place.id);
      return;
    }
    setArmed(null);
    await repos.places.removePlace(place.id);
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Saved places' }} />

      <Text tone="muted" style={styles.lede}>
        Browse around somewhere other than where you are. Saved places show up in the location
        picker on Home.
      </Text>

      {saved.length ? (
        <ListGroup style={styles.group}>
          {saved.map((place) => (
            <ListRow
              key={place.id}
              icon="pin"
              label={place.label}
              sub={
                armed === place.id
                  ? 'Tap again to remove this place'
                  : place.address ?? formatPoint(place.point)
              }
              danger={armed === place.id}
              accessory={<Icon name="trash" size={18} color={colors.danger} />}
              onPress={() => remove(place)}
            />
          ))}
        </ListGroup>
      ) : (
        <Card style={styles.empty}>
          <Text weight="medium">No saved places yet</Text>
          <Text variant="caption" tone="muted" style={styles.emptySub}>
            Add Home or Work and you can switch to browsing around it in one tap.
          </Text>
        </Card>
      )}

      {!adding ? (
        <Button title="Add a place" onPress={startAdding} style={styles.gap} />
      ) : (
        <Card style={styles.form}>
          <Text weight="semibold">New place</Text>

          <View style={styles.kinds}>
            {(Object.keys(KIND_LABEL) as NewKind[]).map((k) => (
              <Tag
                key={k}
                label={KIND_LABEL[k]}
                selected={kind === k}
                onPress={() => chooseKind(k)}
              />
            ))}
          </View>

          <Input
            label="Name"
            value={label}
            onChangeText={setLabel}
            placeholder="Mum’s house, the shop, …"
          />

          <Text variant="caption" tone="muted" style={styles.mapHint}>
            {point
              ? 'Tap the map to move the pin.'
              : 'Tap the map to drop a pin, or use your current location.'}
          </Text>

          <View style={[styles.mapBox, { borderColor: colors.border }]}>
            <RealMap
              // Re-centres only when the pin jumps somewhere far (using the
              // current location); tapping keeps the map exactly where it is.
              center={point ?? current?.point ?? { latitude: 22.7196, longitude: 75.8577 }}
              markers={point ? [{ id: 'pin', point, emoji: '📍' }] : []}
              onMapPress={setPoint}
            />
          </View>

          <Text variant="caption" tone="muted" style={styles.coords}>
            {point ? formatPoint(point) : 'No spot chosen yet'}
          </Text>

          <Button
            title="Use my current location"
            variant="secondary"
            onPress={useCurrentLocation}
            style={styles.formGap}
          />

          {formError ? (
            <Text tone="danger" variant="caption" style={styles.formGap}>
              {formError}
            </Text>
          ) : null}

          <Button title="Save place" onPress={save} loading={busy} style={styles.formGap} />
          <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
        </Card>
      )}
    </Screen>
  );
}

/** Coordinates, short enough to sit on one line under a place's name. */
const formatPoint = (point: GeoPoint): string =>
  `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;

const styles = StyleSheet.create({
  lede: { marginBottom: spacing.lg },
  group: { marginBottom: spacing.lg },
  empty: { marginBottom: spacing.lg },
  emptySub: { marginTop: spacing.xs },
  gap: { marginTop: spacing.sm },
  form: { gap: spacing.md },
  kinds: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  mapHint: { marginBottom: -spacing.xs },
  // The map is a WebView/iframe: it fills its parent, so the parent needs a height.
  mapBox: { height: 240, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  coords: { textAlign: 'center' },
  formGap: { marginTop: spacing.xs },
});
