/**
 * Map view (One Place redesign — Stitch "Neighborhood Map") — businesses
 * plotted around the user's current location on a REAL street map (Leaflet +
 * OpenStreetMap tiles, via <RealMap look="onePlace">). Works on web and native
 * (Expo Go) with no map SDK, no native rebuild and no API key.
 *
 * Full-bleed, no navigator header. Floating over the map:
 *  - Top row: back · a "● You | rings 1·3·5 km | N on map" pill · list view.
 *    Every listed business is plotted, not just those within the rings.
 *  - Category chips (All + every intent category with listings) that
 *    filter the pins, with live counts — the same categories as Explore.
 *  - Zoom +/− on the left; locate-me and street ⇄ satellite on the right.
 *  - A preview card for the selected business (the nearest one to start):
 *    status, rating, distance, what it offers, and Directions · Call · View.
 *
 * Pins are tinted by category and carry a ★ rating chip; the selected pin grows
 * and shows a "Name · 800 m" bubble. The map is LIVE-mounted, so picking a pin
 * or a chip updates the markers in place instead of reloading the tiles.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import type { Business } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { INTENT_CATEGORIES, intentMatches, tagEmoji, type IntentCategory } from '@/domain/intents';
import { openState } from '@/domain/hours';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { ErrorView, Icon, LoadingView, Tag, Text, type IconName } from '@/components/ui';
import RealMap, { type RealMapCommand, type RealMapMarker } from '@/components/RealMap';
import { hasShowableCoordinates } from '@/features/businesses/location';
import { radius, spacing, useColors } from '@/theme/theme';
import { isListedPublicly } from '@/lib/onHold';
import { useServiceGate } from '@/features/businesses/serviceGate';

// Every listed business is plotted, however far away — the rings are only a
// sense of scale around the user, not a cut-off.
const RING_KMS = [1, 3, 5];

/** The first Explore category a business falls under — its pin's tint and icon. */
const categoryOf = (b: Business): IntentCategory | undefined =>
  INTENT_CATEGORIES.find((c) => intentMatches(b, c));

const emojiOf = (b: Business) =>
  tagEmoji(b.tags?.[0] ?? '', categoryOf(b)?.icon ?? getType(b.type)?.icon ?? '📍');

/** Under ~20 m is "here" — "0 m away" reads like a bug, so say nothing (as BusinessHero does). */
const distanceOf = (b: Business) =>
  typeof b.distanceKm === 'number' && b.distanceKm < 0.02 ? undefined : formatDistance(b.distanceKm);

const shorten = (name: string, max = 18) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

export default function MapScreen() {
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pickedId, setPickedId] = useState<string | undefined>();
  const [intentId, setIntentId] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [command, setCommand] = useState<RealMapCommand | undefined>();
  const [headerH, setHeaderH] = useState(0);

  // Call on a platform-held listing shows "not active" instead.
  const gate = useServiceGate();

  const send = (kind: RealMapCommand['kind']) => setCommand((c) => ({ id: (c?.id ?? 0) + 1, kind }));

  const { data, loading, error, reload } = useAsync(async () => {
    const center = await repos.places.getCurrentPlace();
    const businesses = await repos.businesses.list({
      near: center.point,
      sortByDistance: true,
    });
    // ON HOLD (redesign 2026-10): stall — stall listings are hidden from public lists.
    return { center: center.point, businesses: businesses.filter(isListedPublicly) };
  }, []);

  const withLocation = useMemo(
    () => (data?.businesses ?? []).filter((b) => b.location.point),
    [data],
  );
  const intent = INTENT_CATEGORIES.find((c) => c.id === intentId);
  const visible = useMemo(
    () => (intent ? withLocation.filter((b) => intentMatches(b, intent)) : withLocation),
    [withLocation, intent],
  );
  const counts = useMemo(
    () => new Map(INTENT_CATEGORIES.map((c) => [c.id, withLocation.filter((b) => intentMatches(b, c)).length])),
    [withLocation],
  );

  // The picked pin, else the nearest one in view — the card is never empty
  // while there's something on the map.
  const selected = visible.find((b) => b.id === pickedId) ?? visible[0];

  const markers: RealMapMarker[] = useMemo(
    () =>
      visible.map((b) => {
        const distance = distanceOf(b);
        return {
          id: b.id,
          point: b.location.point!,
          emoji: emojiOf(b),
          color: categoryOf(b)?.color ?? colors.brand,
          label: distance ? `${shorten(b.name)} · ${distance}` : shorten(b.name),
          badge:
            typeof b.ratingAvg === 'number' && (b.ratingCount ?? 0) > 0
              ? `★ ${b.ratingAvg.toFixed(1)}`
              : undefined,
        };
      }),
    [visible, colors.brand],
  );

  if (loading) return <LoadingView label="Loading map…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const controlsTop = headerH + spacing.sm;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Map' }} />

      <RealMap
        live
        look="onePlace"
        center={data.center}
        markers={markers}
        ringsKm={RING_KMS}
        selectedId={selected?.id}
        onMarkerPress={setPickedId}
        command={command}
        style={StyleSheet.absoluteFill}
      />

      {/* Top: back · scope pill · list, then the category chips. */}
      <View
        style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
        onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <View style={styles.topRow} pointerEvents="box-none">
          <RoundButton icon="arrowLeft" label="Go back" onPress={goBack} />
          <View style={[styles.scope, floating(colors)]}>
            <View style={styles.youDot} />
            <Text variant="caption" weight="bold">
              You
            </Text>
            <Text variant="caption" style={{ color: colors.border }}>
              |
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              rings {RING_KMS.join('·')} km
            </Text>
            <Text variant="caption" style={{ color: colors.border }}>
              |
            </Text>
            <Text variant="caption" weight="bold" tone="brand">
              {visible.length} on map
            </Text>
          </View>
          <RoundButton icon="list" label="Switch to list view" onPress={() => router.navigate('/')} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipScroll}
        >
          <Tag
            label="All"
            count={withLocation.length}
            selected={intentId === null}
            onPress={() => setIntentId(null)}
          />
          {INTENT_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => (
            <Tag
              key={c.id}
              icon={c.icon}
              label={c.label}
              count={counts.get(c.id) ?? 0}
              selected={intentId === c.id}
              onPress={() => {
                setIntentId(intentId === c.id ? null : c.id);
                setPickedId(undefined);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Zoom, on the left. */}
      <View style={[styles.zoom, floating(colors), { top: controlsTop }]}>
        <Pressable onPress={() => send('zoomIn')} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in">
          <Icon name="plus" size={20} color={colors.text} />
        </Pressable>
        <View style={[styles.zoomRule, { backgroundColor: colors.border }]} />
        <Pressable onPress={() => send('zoomOut')} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out">
          <Icon name="minus" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Locate me + layers, on the right. */}
      <View style={[styles.rightControls, { top: controlsTop }]}>
        <SquareButton icon="locate" label="My location" tint={colors.brand} onPress={() => send('recenter')} />
        <SquareButton
          icon="layers"
          label={satellite ? 'Street map' : 'Satellite map'}
          active={satellite}
          onPress={() => {
            send(satellite ? 'street' : 'satellite');
            setSatellite(!satellite);
          }}
        />
      </View>

      {/* The selected business. */}
      <View style={[styles.sheetWrap, { bottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        {selected ? (
          <PreviewCard
            business={selected}
            onOpen={() => router.push(`/business/${selected.id}`)}
            onCall={() => gate.guard(selected, 'Calling', () => router.push(`/call/${selected.id}`))}
            onDirections={
              hasShowableCoordinates(selected.location)
                ? () => router.push(`/directions/${selected.id}`)
                : undefined
            }
          />
        ) : (
          <View style={[styles.sheet, floating(colors)]}>
            <Text weight="semibold" style={styles.center}>
              {intent ? `No ${intent.label.toLowerCase()} listed yet` : 'Nothing listed yet'}
            </Text>
            <Text variant="caption" tone="muted" style={styles.center}>
              Try another category, or search for what you need.
            </Text>
          </View>
        )}
      </View>
      {gate.popup}
    </View>
  );
}

/** Surface + hairline + soft shadow shared by everything floating on the map. */
const floating = (colors: ReturnType<typeof useColors>) => ({
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
});

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, floating(colors), pressed && styles.pressed]}
    >
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

function SquareButton({
  icon,
  label,
  onPress,
  tint,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tint?: string;
  active?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.square,
        floating(colors),
        active && { backgroundColor: colors.brand, borderColor: colors.brand },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={21} color={active ? colors.textInverse : (tint ?? colors.text)} />
    </Pressable>
  );
}

function PreviewCard({
  business,
  onOpen,
  onCall,
  onDirections,
}: {
  business: Business;
  onOpen: () => void;
  onCall: () => void;
  onDirections?: () => void;
}) {
  const colors = useColors();
  const status = openState(business);
  const distance = distanceOf(business);
  const tint = categoryOf(business)?.color ?? colors.brand;
  const rated = typeof business.ratingAvg === 'number' && (business.ratingCount ?? 0) > 0;
  const about =
    business.tagline ?? business.providerType ?? (business.tags ?? []).slice(0, 3).join(', ');

  return (
    <View style={[styles.sheet, floating(colors)]}>
      <View style={[styles.handle, { backgroundColor: colors.border }]} />

      <Pressable onPress={onOpen} style={styles.sheetRow} accessibilityRole="button" accessibilityLabel={`Open ${business.name}`}>
        <View>
          <View style={[styles.thumb, { backgroundColor: tint }]}>
            <Text style={styles.thumbEmoji}>{emojiOf(business)}</Text>
          </View>
          {typeof status.open === 'boolean' ? (
            <View
              style={[
                styles.openBadge,
                {
                  backgroundColor: colors.surface,
                  borderColor: status.open ? colors.success : colors.danger,
                },
              ]}
            >
              <Text style={[styles.openText, { color: status.open ? colors.success : colors.danger }]} weight="bold">
                {status.open ? 'Open' : 'Closed'}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sheetInfo}>
          <View style={styles.nameRow}>
            <Text weight="bold" numberOfLines={1} style={styles.flexShrink}>
              {business.name}
            </Text>
            {status.todayLabel ? <Tag label={status.todayLabel} tone="status" size="sm" /> : null}
          </View>
          <View style={styles.metaRow}>
            {rated ? (
              <>
                <Icon name="star" size={14} color={colors.star} filled />
                <Text variant="caption" weight="bold">
                  {business.ratingAvg!.toFixed(1)}
                </Text>
                <Text variant="caption" tone="muted">
                  ({business.ratingCount} review{business.ratingCount === 1 ? '' : 's'})
                </Text>
              </>
            ) : (
              <Text variant="caption" tone="muted">
                New
              </Text>
            )}
            {distance ? (
              <Text variant="caption" weight="semibold" tone="brand">
                · {distance} away
              </Text>
            ) : null}
          </View>
          {about ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {about}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        {onDirections ? (
          <ActionTile icon="directions" label="Get directions" onPress={onDirections} />
        ) : null}
        <ActionTile icon="phone" label="Call" onPress={onCall} />
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          style={({ pressed }) => [styles.viewBtn, { backgroundColor: colors.brand }, pressed && styles.pressed]}
        >
          <Text weight="bold" tone="inverse">
            View store
          </Text>
          <Icon name="arrowRight" size={17} color={colors.textInverse} />
        </Pressable>
      </View>
    </View>
  );
}

function ActionTile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionTile, { backgroundColor: colors.surfaceAlt }, pressed && styles.pressed]}
    >
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scope: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  youDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB' },
  chipScroll: { marginHorizontal: -spacing.lg },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: 2 },
  zoom: {
    position: 'absolute',
    left: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  zoomBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  zoomRule: { height: StyleSheet.hairlineWidth },
  rightControls: { position: 'absolute', right: spacing.lg, gap: spacing.sm },
  square: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetWrap: { position: 'absolute', left: spacing.md, right: spacing.md, alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 28,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: { fontSize: 26, lineHeight: 32 },
  openBadge: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  openText: { fontSize: 9, lineHeight: 12 },
  sheetInfo: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  actionTile: {
    width: 56,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
