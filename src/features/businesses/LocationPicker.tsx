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
 * The Leaflet page is built ONCE (from the user's location + nearby dots + the
 * initial pin) so moving the pin never reloads the tiles — the drag/tap is
 * handled inside the page and reported back up via postMessage. "Use my current
 * location" bumps a reset key, the one case that rebuilds the page.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { GeoPoint } from '@/domain/types';
import { getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { Button, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area of nearby dots shown around the user
const RING_KMS = [1, 3, 5];
const CANVAS_HEIGHT = 260;

export interface LocationPickerProps {
  value?: GeoPoint;
  onChange: (point: GeoPoint) => void;
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
      .setView([D.center.latitude, D.center.longitude], 15);
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

export function LocationPicker({ value, onChange }: LocationPickerProps) {
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
  }, []);

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

  const useCurrentLocation = () => {
    if (!data) return;
    valueRef.current = data.center;
    onChange(data.center);
    // Rebuild the page so the pin snaps back to the user's location.
    setResetKey((k) => k + 1);
  };

  const distanceKm = data && value ? haversineKm(data.center, value) : undefined;

  return (
    <View>
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
      </View>

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
  below: { marginTop: spacing.sm, gap: spacing.sm },
  distance: { textAlign: 'center' },
});
