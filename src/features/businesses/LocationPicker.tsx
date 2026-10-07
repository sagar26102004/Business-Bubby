/**
 * Zomato/Amazon-style location pin picker on a REAL street map (Leaflet +
 * OpenStreetMap tiles), matching the rest of the app (see components/RealMap).
 * Works on BOTH web (iframe) and native/Expo Go (react-native-webview) — no map
 * SDK, no native rebuild, no API key, no billing.
 *
 * The pin starts at the user's current location. Tapping the map moves it there;
 * the pin is also draggable; "Use my current location" snaps it back. Nearby
 * businesses render as faint dots so the map is orientable.
 *
 * Panning a small map inside a scrolling form is fiddly — on a phone the page
 * and the map fight over every drag — so there are two easier ways in:
 *   - a SEARCH box: type the address or area, tap a result, the pin jumps there
 *     (Nominatim via `lib/geocode.ts`; `onPlaceFound` lets the form fill its
 *     address fields from the same result);
 *   - a FULL-SCREEN button that opens the same map in a modal with the search
 *     on top, where nothing else is competing for the gesture.
 *
 * The Leaflet page is built ONCE (from the user's location + nearby dots + the
 * initial pin) so moving the pin never reloads the tiles — the drag/tap is
 * handled inside the page and reported back up via postMessage. "Use my current
 * location" bumps a reset key, the one case that rebuilds the page.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GeoPoint } from '@/domain/types';
import { getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { searchPlaces, type PlaceResult } from '@/lib/geocode';
import { Button, Icon, Input, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area of nearby dots shown around the user
const RING_KMS = [1, 3, 5];
const CANVAS_HEIGHT = 260;

export interface LocationPickerProps {
  value?: GeoPoint;
  onChange: (point: GeoPoint) => void;
  /** A search result was picked — lets the form fill its address fields too. */
  onPlaceFound?: (place: PlaceResult) => void;
}

type Dot = { lat: number; lng: number; color: string };

// Build the self-contained Leaflet page. Injected data is JSON (no escaping risk).
function buildHtml(center: GeoPoint, pin: GeoPoint, dots: Dot[], rings: number[]) {
  const data = JSON.stringify({ center, pin, dots, rings });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8eef3; }
    #map { cursor: crosshair; }
    .pin { font-size: 30px; text-align: center; line-height: 34px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.4)); }
    .me { width: 18px; height: 18px; border-radius: 9px; background: #2563eb;
          border: 3px solid #fff; box-shadow: 0 0 0 3px rgba(37,99,235,.35); }
    .dot { border-radius: 50%; opacity: .4; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var D = ${data};
    function send(msg){
      var s = JSON.stringify(msg);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
      else if (window.parent) window.parent.postMessage(s, '*');
    }
    var map = L.map('map', { zoomControl: true, attributionControl: false })
      .setView([D.pin.latitude, D.pin.longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    // You
    L.marker([D.center.latitude, D.center.longitude], {
      icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18,18], iconAnchor: [9,9] }),
      interactive: false,
    }).addTo(map);

    // Range rings for scale
    (D.rings || []).forEach(function (km) {
      L.circle([D.center.latitude, D.center.longitude], {
        radius: km * 1000, color: '#64748b', weight: 1, fill: false, opacity: .45,
      }).addTo(map);
    });

    // Nearby businesses, faint, for orientation
    (D.dots || []).forEach(function (d) {
      L.marker([d.lat, d.lng], {
        icon: L.divIcon({ className: '', html: '<div class="dot" style="width:10px;height:10px;background:' + d.color + '"></div>', iconSize: [10,10], iconAnchor: [5,5] }),
        interactive: false,
      }).addTo(map);
    });

    // The draggable pin
    var pinIcon = L.divIcon({ className: '', html: '<div class="pin">📍</div>', iconSize: [34,34], iconAnchor: [17,32] });
    var pin = L.marker([D.pin.latitude, D.pin.longitude], { draggable: true, icon: pinIcon }).addTo(map);
    function report(ll){ send({ type: 'pick', lat: ll.lat, lng: ll.lng }); }
    pin.on('dragend', function(){ report(pin.getLatLng()); });
    map.on('click', function(e){ pin.setLatLng(e.latlng); report(e.latlng); });

    setTimeout(function(){ map.invalidateSize(); }, 200);
  </script>
</body>
</html>`;
}

export function LocationPicker({ value, onChange, onPlaceFound }: LocationPickerProps) {
  const repos = useRepositories();
  const colors = useColors();

  const { data } = useAsync(async () => {
    const center = await repos.places.getCurrentPlace();
    const nearby = await repos.businesses.list({
      near: center.point,
      maxDistanceKm: RADIUS_KM,
      sortByDistance: true,
    });
    return { center: center.point, nearby };
    // No refetch on focus: the map page below is rebuilt whenever this data
    // changes, and reloading the tiles under a pin the user is placing (after
    // a trip to another step and back) loses their work for no gain.
  }, [], { refetchOnFocus: false });

  // Like a delivery app: the pin starts on the user's current location and they
  // adjust from there.
  useEffect(() => {
    if (data && !value) onChange(data.center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // The map page is built once per (data, resetKey) — NOT on every pin move, so
  // dragging/tapping the pin never reloads the tiles. `value` at build time
  // seeds the initial pin; later picks are handled inside the page.
  const valueRef = useRef(value);
  valueRef.current = value;
  const [resetKey, setResetKey] = useState(0);

  const html = useMemo(() => {
    if (!data) return null;
    const dots: Dot[] = data.nearby
      .filter((b) => b.location.point)
      .map((b) => ({
        lat: b.location.point!.latitude,
        lng: b.location.point!.longitude,
        color: getType(b.type)?.color ?? '#94a3b8',
      }));
    const pin = valueRef.current ?? data.center;
    return buildHtml(data.center, pin, dots, RING_KMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, resetKey]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlePick = (p: GeoPoint) => {
    if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) onChangeRef.current(p);
  };

  // Moving the pin from OUTSIDE the map (current location, a search result)
  // rebuilds the page around it; drags and taps inside the map never do.
  const jumpTo = (p: GeoPoint) => {
    valueRef.current = p;
    onChange(p);
    setResetKey((k) => k + 1);
  };

  const useCurrentLocation = () => {
    if (data) jumpTo(data.center);
  };

  const pickPlace = (place: PlaceResult) => {
    jumpTo(place.point);
    onPlaceFound?.(place);
  };

  const [fullScreen, setFullScreen] = useState(false);
  const closeFullScreen = () => {
    setFullScreen(false);
    // The inline map was built before the pin moved in the big one.
    setResetKey((k) => k + 1);
  };
  const insets = useSafeAreaInsets();

  const distanceKm = data && value ? haversineKm(data.center, value) : undefined;

  return (
    <View>
      <PlaceSearch near={data?.center} onPick={pickPlace} />

      <View style={[styles.canvas, { borderColor: colors.border }]}>
        {html ? (
          <MapFrame key={resetKey} html={html} onPick={handlePick} style={styles.fill} />
        ) : (
          <View style={[styles.fill, styles.loading, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="caption" tone="muted">
              Loading map…
            </Text>
          </View>
        )}
        <View style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="caption" tone="muted">
            ◉ You · tap the map or drag 📍 to set your pin
          </Text>
        </View>
        {html ? (
          <Pressable
            onPress={() => setFullScreen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open the map full screen"
            style={[styles.expand, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Icon name="map" size={16} color={colors.text} />
            <Text variant="caption" weight="semibold">
              Full screen
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={fullScreen} animationType="slide" onRequestClose={closeFullScreen}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingTop: insets.top + spacing.sm,
              paddingBottom: insets.bottom + spacing.sm,
            },
          ]}
        >
          <PlaceSearch near={data?.center} onPick={pickPlace} />
          <View style={[styles.sheetMap, { borderColor: colors.border }]}>
            {html && fullScreen ? (
              <MapFrame key={`full-${resetKey}`} html={html} onPick={handlePick} style={styles.fill} />
            ) : null}
          </View>
          <View style={styles.sheetFoot}>
            <Button title="🎯 My location" variant="secondary" onPress={useCurrentLocation} />
            <View style={styles.fill}>
              <Button title="Done" onPress={closeFullScreen} />
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.below}>
        <Text variant="caption" tone="muted" style={styles.distance}>
          {typeof distanceKm === 'number'
            ? distanceKm < 0.05
              ? '📍 Pin is at your current location'
              : `📍 Pin is ${distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`} from you`
            : 'Loading map…'}
        </Text>
        <Button
          title="🎯 Use my current location"
          variant="secondary"
          onPress={useCurrentLocation}
        />
      </View>
    </View>
  );
}

/**
 * Type-to-find box above the map. Debounced (Nominatim allows ~1 request a
 * second); results are listed inline under the box, and picking one hands it
 * up and clears the box.
 */
function PlaceSearch({ near, onPick }: { near?: GeoPoint; onPick: (place: PlaceResult) => void }) {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  // Only the newest request may write results, however the replies arrive.
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      seq.current++;
      setResults([]);
      setBusy(false);
      setSearched(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const found = await searchPlaces(q, near);
      if (mine !== seq.current) return;
      setResults(found);
      setBusy(false);
      setSearched(true);
    }, 600);
    return () => clearTimeout(t);
    // `near` is read at search time; a new location shouldn't re-run the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pick = (place: PlaceResult) => {
    setQuery('');
    onPick(place);
  };

  return (
    <View style={styles.search}>
      <Input
        placeholder="Search your address or area"
        value={query}
        onChangeText={setQuery}
        rightIcon="search"
        autoCorrect={false}
        returnKeyType="search"
      />
      {busy ? (
        <View style={styles.searchNote}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      ) : results.length > 0 ? (
        <View style={[styles.results, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {results.map((r, i) => (
            <Pressable
              key={`${r.point.latitude},${r.point.longitude},${i}`}
              onPress={() => pick(r)}
              style={({ pressed }) => [
                styles.result,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Icon name="pin" size={16} color={colors.textMuted} />
              <Text variant="caption" numberOfLines={2} style={styles.fill}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : searched ? (
        <Text variant="caption" tone="muted" style={styles.searchNote}>
          No places found — try a nearby landmark or area, or move the pin on the map.
        </Text>
      ) : null}
    </View>
  );
}

/** Platform-appropriate Leaflet host: iframe on web, WebView on native. */
function MapFrame({
  html,
  onPick,
  style,
}: {
  html: string;
  onPick: (p: GeoPoint) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return Platform.OS === 'web' ? (
    <WebFrame html={html} onPick={onPick} style={style} />
  ) : (
    <NativeFrame html={html} onPick={onPick} style={style} />
  );
}

function WebFrame({ html, onPick, style }: { html: string; onPick: (p: GeoPoint) => void; style?: StyleProp<ViewStyle> }) {
  const cb = useRef(onPick);
  cb.current = onPick;
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d?.type === 'pick') cb.current({ latitude: d.lat, longitude: d.lng });
      } catch {}
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <View style={style}>
      {createElement('iframe', {
        srcDoc: html,
        style: { border: 'none', width: '100%', height: '100%' },
        title: 'Pick location',
      })}
    </View>
  );
}

function NativeFrame({ html, onPick, style }: { html: string; onPick: (p: GeoPoint) => void; style?: StyleProp<ViewStyle> }) {
  // Required lazily so the web bundle never touches the native module.
  const { WebView } = require('react-native-webview');
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={style}
      onMessage={(e: { nativeEvent: { data: string } }) => {
        try {
          const d = JSON.parse(e.nativeEvent.data);
          if (d?.type === 'pick') onPick({ latitude: d.lat, longitude: d.lng });
        } catch {}
      }}
    />
  );
}

const styles = StyleSheet.create({
  canvas: {
    height: CANVAS_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  legend: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  expand: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  search: { marginBottom: spacing.sm, gap: spacing.xs },
  searchNote: { paddingVertical: spacing.xs, alignItems: 'center', textAlign: 'center' },
  results: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheet: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  sheetMap: { flex: 1, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  sheetFoot: { flexDirection: 'row', gap: spacing.sm },
  below: { marginTop: spacing.sm, gap: spacing.sm },
  distance: { textAlign: 'center' },
});
