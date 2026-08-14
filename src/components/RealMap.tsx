/**
 * RealMap — a genuine street map (Leaflet + OpenStreetMap tiles) that works on
 * BOTH web and native, with no map SDK, no native rebuild, no API key, no billing.
 *
 * How: it renders a self-contained Leaflet HTML page.
 *   - Web  → inside an <iframe srcDoc={html}> (react-native-web is React DOM).
 *   - Native (Expo Go / phone) → inside <WebView source={{ html }}> from
 *     react-native-webview, which IS bundled in Expo Go.
 *
 * Same markers, same taps, same street tiles everywhere. Tapping a marker posts
 * a message back up so the caller can select/open the business.
 *
 * LIVE mode (`live`): for real-time tracking the map must NOT reload every time a
 * marker moves. When `live` is set the page is built once and kept mounted, and
 * marker updates are pushed into it imperatively (postMessage on web, injected JS
 * on native) so vehicles glide to their new position without the tiles or the
 * user's zoom/pan resetting. `follow` keeps the selected/only marker in view.
 *
 * To upgrade to native Google/Apple maps later (react-native-maps / expo-maps in
 * a dev build), swap this component's internals — the props stay the same.
 */
import { createElement, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { GeoPoint } from '@/domain/types';

export type RealMapMarker = {
  id: string;
  point: GeoPoint;
  emoji?: string;
  color?: string;
};

type Props = {
  center: GeoPoint;
  markers: RealMapMarker[];
  ringsKm?: number[];
  selectedId?: string;
  onMarkerPress?: (id: string) => void;
  /**
   * Tap anywhere on the map to get that coordinate back. Used by the saved-place
   * picker to drop Home somewhere other than wherever the phone happens to be.
   * Omitted on read-only maps, where a stray tap should do nothing.
   */
  onMapPress?: (point: GeoPoint) => void;
  style?: StyleProp<ViewStyle>;
  /** Keep the map mounted and push marker moves in live (no reload per update). */
  live?: boolean;
  /** In live mode, pan to keep the selected (or only) marker on screen. */
  follow?: boolean;
  /**
   * A planned route to highlight (ordered start → stops → end). Drawn once as a
   * Google-Maps-style road line under the live markers. Changing it rebuilds the
   * page (infrequent — only when the tracked vehicle/route changes).
   */
  route?: GeoPoint[];
};

// Build a stand-alone Leaflet page. Injected data is JSON so there's no escaping risk.
function buildHtml(
  center: GeoPoint,
  markers: RealMapMarker[],
  ringsKm: number[],
  selectedId?: string,
  route: GeoPoint[] = [],
  tappable = false,
) {
  const hasRoute = route.length >= 2;
  const data = JSON.stringify({ center, markers, rings: ringsKm, selectedId, route, tappable });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  ${hasRoute ? '<link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />' : ''}
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8eef3; }
    .leaflet-routing-container { display: none; }
    .pin {
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; border-radius: 17px;
      border: 2px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35);
      font-size: 16px; box-sizing: border-box; transition: transform .6s ease;
    }
    .pin.sel { width: 42px; height: 42px; border-radius: 21px; border-width: 3px; font-size: 20px; }
    .rp { width: 28px; height: 28px; border-radius: 14px; font-size: 14px; }
    .me { width: 18px; height: 18px; border-radius: 9px; background: #2563eb;
          border: 3px solid #fff; box-shadow: 0 0 0 3px rgba(37,99,235,.35); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  ${hasRoute ? '<script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>' : ''}
  <script>
    var D = ${data};
    function send(msg){
      var s = JSON.stringify(msg);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
      else if (window.parent) window.parent.postMessage(s, '*');
    }
    var CENTER = D.center;
    var map = L.map('map', { zoomControl: true, attributionControl: false })
      .setView([CENTER.latitude, CENTER.longitude], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    // You / the business — the fixed anchor point.
    L.marker([CENTER.latitude, CENTER.longitude], {
      icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18,18], iconAnchor: [9,9] }),
      interactive: false,
    }).addTo(map);

    // Range rings (drawn once — they don't move).
    (D.rings || []).forEach(function (km) {
      L.circle([CENTER.latitude, CENTER.longitude], {
        radius: km * 1000, color: '#64748b', weight: 1, fill: false, opacity: .45,
      }).addTo(map);
    });

    // The vehicle's planned route — drawn once, Google-Maps style (thick blue
    // line following the real roads via OSRM), with green start / amber numbered
    // stops / red destination pins. The live vehicle marker moves on top of it.
    var ROUTE = (D.route || []).map(function (p) { return L.latLng(p.latitude, p.longitude); });
    if (ROUTE.length >= 2) {
      function rpin(bg, label) {
        return L.divIcon({
          className: '',
          html: '<div class="pin rp" style="background:' + bg + '">' + label + '</div>',
          iconSize: [28,28], iconAnchor: [14,14],
        });
      }
      L.marker(ROUTE[0], { icon: rpin('#16a34a', '🟢'), interactive: false }).addTo(map);
      for (var ri = 1; ri < ROUTE.length - 1; ri++) {
        L.marker(ROUTE[ri], { icon: rpin('#f59e0b', String(ri)), interactive: false }).addTo(map);
      }
      L.marker(ROUTE[ROUTE.length - 1], { icon: rpin('#dc2626', '🔴'), interactive: false }).addTo(map);

      var routedOk = false;
      function routeFallback() {
        if (routedOk) return; // straight dashed line if the router is unreachable
        L.polyline(ROUTE, { color: '#2563eb', weight: 5, opacity: .7, dashArray: '6,10' }).addTo(map);
      }
      try {
        var rc = L.Routing.control({
          waypoints: ROUTE,
          router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
          lineOptions: { styles: [{ color: '#2563eb', weight: 6, opacity: .85 }], addWaypoints: false },
          addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: false, show: false,
          createMarker: function () { return null; },
        }).addTo(map);
        rc.on('routesfound', function () { routedOk = true; });
        rc.on('routingerror', routeFallback);
        setTimeout(routeFallback, 8000);
      } catch (e) { routeFallback(); }
    }

    // Markers live in their own layer + a by-id lookup so live updates can move
    // an existing pin instead of tearing the whole set down.
    var markerLayer = L.layerGroup().addTo(map);
    var byId = {};
    var didFit = false;

    function draw(P) {
      var next = {};
      var bounds = [[CENTER.latitude, CENTER.longitude]];
      (P.markers || []).forEach(function (m) {
        next[m.id] = true;
        var sel = m.id === P.selectedId ? ' sel' : '';
        var html = '<div class="pin' + sel + '" style="background:' + (m.color || '#2563eb') + '">' + (m.emoji || '📍') + '</div>';
        var size = sel ? 42 : 34, anc = size / 2;
        var icon = L.divIcon({ className: '', html: html, iconSize: [size,size], iconAnchor: [anc,anc] });
        var ll = [m.point.latitude, m.point.longitude];
        var existing = byId[m.id];
        if (existing) {
          existing.setLatLng(ll);           // glide to the new position
          existing.setIcon(icon);
          existing.setZIndexOffset(sel ? 1000 : 0);
        } else {
          var mk = L.marker(ll, { icon: icon, zIndexOffset: sel ? 1000 : 0 }).addTo(markerLayer);
          mk.on('click', (function (id) { return function () { send({ type: 'marker', id: id }); }; })(m.id));
          byId[m.id] = mk;
        }
        bounds.push(ll);
      });
      // Drop pins that are no longer present.
      Object.keys(byId).forEach(function (id) {
        if (!next[id]) { markerLayer.removeLayer(byId[id]); delete byId[id]; }
      });

      if (!didFit) {
        var fitPts = bounds.concat(ROUTE); // frame the whole route + vehicles
        if (fitPts.length > 1) map.fitBounds(fitPts, { padding: [48,48], maxZoom: 16 });
        didFit = true;
      } else if (P.follow) {
        var t = (P.markers || []).filter(function (m) { return m.id === P.selectedId; })[0]
             || ((P.markers && P.markers.length === 1) ? P.markers[0] : null);
        if (t) map.panTo([t.point.latitude, t.point.longitude], { animate: true });
      }
    }

    draw({ markers: D.markers, selectedId: D.selectedId, follow: false });

    // Pick-a-point mode. Leaflet fires 'click' only for taps that aren't a drag
    // or a marker hit, so panning the map never drops a pin by accident.
    if (D.tappable) {
      map.on('click', function (e) {
        send({ type: 'tap', latitude: e.latlng.lat, longitude: e.latlng.lng });
      });
    }

    // Imperative update channel (used only in live mode).
    function applyPayload(P) { try { draw(P); } catch (e) {} }
    window.__applyMap = function (P) { applyPayload(P); };       // native (injected JS)
    window.addEventListener('message', function (e) {            // web (iframe postMessage)
      try {
        var m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (m && m.__map === 'update') applyPayload(m.payload);
      } catch (e2) {}
    });

    setTimeout(function(){ map.invalidateSize(); send({ type: 'ready' }); }, 200);
  </script>
</body>
</html>`;
}

export default function RealMap(props: Props) {
  return Platform.OS === 'web' ? <WebMap {...props} /> : <NativeMap {...props} />;
}

function WebMap({ center, markers, ringsKm, selectedId, onMarkerPress, onMapPress, style, live, follow, route }: Props) {
  const onPress = useRef(onMarkerPress);
  onPress.current = onMarkerPress;
  // Same ref trick as the marker handler: the listener is registered once, so
  // it must read the CURRENT callback rather than the one from first render.
  const onTap = useRef(onMapPress);
  onTap.current = onMapPress;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const payloadRef = useRef({ markers, selectedId, follow });
  payloadRef.current = { markers, selectedId, follow };
  const routeKey = JSON.stringify(route ?? []);

  const postUpdate = () => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage(JSON.stringify({ __map: 'update', payload: payloadRef.current }), '*');
  };

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d?.type === 'marker') onPress.current?.(d.id);
        if (d?.type === 'tap') {
          onTap.current?.({ latitude: d.latitude, longitude: d.longitude });
        }
        if (d?.type === 'ready') {
          readyRef.current = true;
          if (live) postUpdate();
        }
      } catch {}
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Live mode: push marker moves in without reloading the map.
  useEffect(() => {
    if (live && readyRef.current) postUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, markers, selectedId, follow]);

  // In live mode the page is built ONCE (kept mounted) and only rebuilt when the
  // route changes; otherwise it rebuilds per render as before, so static callers
  // (map.tsx) are unchanged.
  const htmlRef = useRef<string | null>(null);
  const builtRouteKey = useRef<string | null>(null);
  if (live) {
    if (htmlRef.current === null || builtRouteKey.current !== routeKey) {
      htmlRef.current = buildHtml(center, markers, ringsKm ?? [], selectedId, route ?? [], !!onMapPress);
      builtRouteKey.current = routeKey;
      readyRef.current = false; // the reloaded page announces ready again
    }
  }
  const html = live
    ? (htmlRef.current as string)
    : buildHtml(center, markers, ringsKm ?? [], selectedId, route ?? [], !!onMapPress);

  return (
    <View style={[styles.fill, style]}>
      {createElement('iframe', {
        ref: iframeRef,
        key: live ? routeKey : undefined,
        srcDoc: html,
        style: { border: 'none', width: '100%', height: '100%' },
        title: 'Map',
      })}
    </View>
  );
}

function NativeMap({ center, markers, ringsKm, selectedId, onMarkerPress, onMapPress, style, live, follow, route }: Props) {
  // Required lazily so the web bundle never touches the native module.
  const { WebView } = require('react-native-webview');
  const webRef = useRef<any>(null);
  const readyRef = useRef(false);
  const payloadRef = useRef({ markers, selectedId, follow });
  payloadRef.current = { markers, selectedId, follow };
  const routeKey = JSON.stringify(route ?? []);

  const postUpdate = () => {
    if (!webRef.current) return;
    webRef.current.injectJavaScript(
      `window.__applyMap && window.__applyMap(${JSON.stringify(payloadRef.current)}); true;`,
    );
  };

  useEffect(() => {
    if (live && readyRef.current) postUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, markers, selectedId, follow]);

  const htmlRef = useRef<string | null>(null);
  const builtRouteKey = useRef<string | null>(null);
  if (live) {
    if (htmlRef.current === null || builtRouteKey.current !== routeKey) {
      htmlRef.current = buildHtml(center, markers, ringsKm ?? [], selectedId, route ?? [], !!onMapPress);
      builtRouteKey.current = routeKey;
      readyRef.current = false;
    }
  }
  const html = live
    ? (htmlRef.current as string)
    : buildHtml(center, markers, ringsKm ?? [], selectedId, route ?? [], !!onMapPress);

  return (
    <WebView
      ref={webRef}
      key={live ? routeKey : undefined}
      originWhitelist={['*']}
      source={{ html }}
      style={[styles.fill, style]}
      onLoadEnd={() => {
        readyRef.current = true;
        if (live) postUpdate();
      }}
      onMessage={(e: { nativeEvent: { data: string } }) => {
        try {
          const d = JSON.parse(e.nativeEvent.data);
          if (d?.type === 'marker') onMarkerPress?.(d.id);
          if (d?.type === 'tap') onMapPress?.({ latitude: d.latitude, longitude: d.longitude });
        } catch {}
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
