/**
 * RouteMap — a street map (Leaflet + OpenStreetMap) that draws driving
 * DIRECTIONS from the user to a destination, exactly like the blue navigation
 * line in Google Maps. The route geometry comes from the free OSRM public
 * router (no API key, no billing); the chosen road is drawn as a thick blue
 * line, with a "you" dot at the start and a business pin at the destination.
 *
 * Same web/native split as RealMap: an <iframe srcDoc> on web (react-native-web
 * is React DOM) and a react-native-webview on native/Expo Go. Both load Leaflet
 * + leaflet-routing-machine from unpkg, like RealMap already loads Leaflet.
 *
 * When OSRM returns a route the page posts its distance/time back up so the
 * caller can show "12 min · 4.2 km". If routing fails (offline, server down)
 * it still draws both points and a straight dashed fallback line.
 */
import { createElement, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { GeoPoint } from '@/domain/types';

export type RouteSummary = { distanceKm: number; durationMin: number };

type Props = {
  from: GeoPoint;
  to: GeoPoint;
  /** Ordered waypoints the route must pass through, between `from` and `to`. */
  stops?: GeoPoint[];
  /** Emoji shown on the destination pin (defaults to 📍). */
  toEmoji?: string;
  /** Destination pin colour (defaults to the brand blue). */
  toColor?: string;
  /** When set, the start renders as a labelled pin instead of the "you" dot. */
  fromEmoji?: string;
  /** Start pin colour (used only with `fromEmoji`). */
  fromColor?: string;
  /** Called once OSRM returns a route, with its distance and drive time. */
  onRoute?: (summary: RouteSummary) => void;
  style?: StyleProp<ViewStyle>;
};

// Build a stand-alone Leaflet + routing page. Injected data is JSON (no escaping risk).
function buildHtml(
  from: GeoPoint,
  to: GeoPoint,
  toEmoji: string,
  toColor: string,
  stops: GeoPoint[],
  fromEmoji?: string,
  fromColor?: string,
) {
  const data = JSON.stringify({ from, to, toEmoji, toColor, stops, fromEmoji, fromColor });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8eef3; }
    /* Hide the turn-by-turn itinerary panel — the RN screen shows distance/time. */
    .leaflet-routing-container { display: none; }
    .pin {
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 20px;
      border: 3px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35);
      font-size: 19px; box-sizing: border-box;
    }
    .me { width: 20px; height: 20px; border-radius: 10px; background: #2563eb;
          border: 3px solid #fff; box-shadow: 0 0 0 3px rgba(37,99,235,.35); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
  <script>
    var D = ${data};
    function send(msg){
      var s = JSON.stringify(msg);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
      else if (window.parent) window.parent.postMessage(s, '*');
    }
    var from = L.latLng(D.from.latitude, D.from.longitude);
    var to = L.latLng(D.to.latitude, D.to.longitude);
    var stops = (D.stops || []).map(function (s) { return L.latLng(s.latitude, s.longitude); });

    var map = L.map('map', { zoomControl: true, attributionControl: false }).setView(from, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    function pinIcon(bg, label){
      return L.divIcon({
        className: '',
        html: '<div class="pin" style="background:' + bg + '">' + label + '</div>',
        iconSize: [40,40], iconAnchor: [20,20],
      });
    }

    // Start — a labelled pin when asked, otherwise the "you" dot.
    if (D.fromEmoji) {
      L.marker(from, { icon: pinIcon(D.fromColor || '#16a34a', D.fromEmoji), interactive: false }).addTo(map);
    } else {
      L.marker(from, {
        icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [20,20], iconAnchor: [10,10] }),
        interactive: false,
      }).addTo(map);
    }
    // Numbered stops in between
    stops.forEach(function (ll, i) {
      L.marker(ll, { icon: pinIcon('#f59e0b', String(i + 1)), interactive: false }).addTo(map);
    });
    // Destination
    L.marker(to, { icon: pinIcon(D.toColor || '#2563eb', D.toEmoji), interactive: false }).addTo(map);

    var allPts = [from].concat(stops).concat([to]);
    var routed = false;
    function fallbackLine(){
      if (routed) return;
      // Straight dashed line through every point if the router is unreachable.
      L.polyline(allPts, { color: '#2563eb', weight: 4, dashArray: '8,10', opacity: .7 }).addTo(map);
      map.fitBounds(L.latLngBounds(allPts), { padding: [56,56], maxZoom: 16 });
    }

    try {
      var control = L.Routing.control({
        waypoints: allPts,
        router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
        // The chosen road, drawn in Google-Maps blue.
        lineOptions: { styles: [{ color: '#2563eb', weight: 6, opacity: .9 }], addWaypoints: false },
        addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true, show: false,
        createMarker: function(){ return null; }, // we drew our own markers
      }).addTo(map);
      control.on('routesfound', function(e){
        routed = true;
        var r = e.routes && e.routes[0];
        if (r && r.summary) {
          send({ type: 'route', distanceKm: r.summary.totalDistance / 1000, durationMin: r.summary.totalTime / 60 });
        }
      });
      control.on('routingerror', fallbackLine);
      // Belt and braces: if nothing came back in 8s, draw the straight line.
      setTimeout(fallbackLine, 8000);
    } catch (err) {
      fallbackLine();
    }

    setTimeout(function(){ map.invalidateSize(); }, 200);
  </script>
</body>
</html>`;
}

export default function RouteMap(props: Props) {
  return Platform.OS === 'web' ? <WebRoute {...props} /> : <NativeRoute {...props} />;
}

function WebRoute({ from, to, stops, toEmoji, toColor, fromEmoji, fromColor, onRoute, style }: Props) {
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d?.type === 'route') onRouteRef.current?.({ distanceKm: d.distanceKm, durationMin: d.durationMin });
      } catch {}
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const html = buildHtml(from, to, toEmoji ?? '📍', toColor ?? '#2563eb', stops ?? [], fromEmoji, fromColor);
  return (
    <View style={[styles.fill, style]}>
      {createElement('iframe', {
        srcDoc: html,
        style: { border: 'none', width: '100%', height: '100%' },
        title: 'Directions',
      })}
    </View>
  );
}

function NativeRoute({ from, to, stops, toEmoji, toColor, fromEmoji, fromColor, onRoute, style }: Props) {
  // Required lazily so the web bundle never touches the native module.
  const { WebView } = require('react-native-webview');
  const html = buildHtml(from, to, toEmoji ?? '📍', toColor ?? '#2563eb', stops ?? [], fromEmoji, fromColor);
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={[styles.fill, style]}
      onMessage={(e: { nativeEvent: { data: string } }) => {
        try {
          const d = JSON.parse(e.nativeEvent.data);
          if (d?.type === 'route') onRoute?.({ distanceKm: d.distanceKm, durationMin: d.durationMin });
        } catch {}
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
