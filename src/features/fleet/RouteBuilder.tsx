/**
 * RouteBuilder — mark a vehicle's whole journey on a REAL street map, the way
 * you'd drop pins in Google Maps.
 *
 * The flow is one guided sequence: the map asks for the STARTING point first,
 * then the ENDING point, then stop 1, 2, 3… for as long as the owner keeps
 * adding. Tapping the map (or picking a search result) drops a DRAFT pin and the
 * primary button flips from "Drop pin here" to "✓ Confirm ‹step›"; tapping
 * somewhere else just moves that draft pin, so nothing is committed until the
 * owner confirms.
 *
 * Pins are Google-style teardrops with the step written inside — S for the
 * start, E for the end, 1/2/3… for the stops. As soon as start and end exist the
 * page draws the driving route in blue (OSRM, the same free router RouteMap
 * uses) and every confirmed stop is added as a WAYPOINT, so the blue line is
 * re-routed to actually pass through it even when the stop is off the direct
 * way.
 *
 * Same web/native split as the app's other maps: an <iframe srcDoc> on web,
 * react-native-webview on native/Expo Go — no map SDK, no API key, no billing.
 * Place names come from Nominatim (search + reverse geocode), so confirmed pins
 * arrive back already labelled.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GeoPoint } from '@/domain/types';
import { Button, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** One pin the owner has confirmed on the map. */
export type BuiltPoint = { label: string; point: GeoPoint };

/** Everything the builder hands back when the owner is done. */
export interface BuiltRoute {
  start?: BuiltPoint;
  end?: BuiltPoint;
  stops: BuiltPoint[];
}

/** Which pin the map is waiting for right now. */
type Phase = 'start' | 'end' | 'stop';

type PagePoint = { lat: number; lng: number; label: string };
type PageState = {
  phase: Phase;
  hasDraft: boolean;
  nextLabel: string;
  start: PagePoint | null;
  end: PagePoint | null;
  stops: PagePoint[];
};

export interface RouteBuilderProps {
  /** Seeds the map when editing a journey that already has pins. */
  initial?: BuiltRoute;
  /** Where to centre the map before anything is marked. */
  center?: GeoPoint;
  onCancel: () => void;
  onDone: (route: BuiltRoute) => void;
}

// ── The Leaflet page ──────────────────────────────────────────────────────
// Self-contained: it owns the pins, the draft pin, search and the blue route,
// and reports its state up so the React screen can render the right buttons.
function buildHtml(seed: {
  center: GeoPoint;
  start: PagePoint | null;
  end: PagePoint | null;
  stops: PagePoint[];
}) {
  const data = JSON.stringify(seed);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8eef3;
      font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
    #map { cursor: crosshair; }
    /* Turn-by-turn panel stays hidden — the screen shows distance/time. */
    .leaflet-routing-container { display: none; }
    /* Google-style teardrop: a square with one sharp corner, rotated 45°. */
    .mk { width: 34px; height: 34px; border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg); border: 2.5px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,.4); display: flex;
      align-items: center; justify-content: center; box-sizing: border-box; }
    .mk b { transform: rotate(45deg); color: #fff; font-size: 14px; font-weight: 700; line-height: 1; }
    /* Not committed yet: lighter, and gently bobbing so it reads as a draft. */
    .draft { opacity: .82; animation: bob .9s ease-in-out infinite alternate; }
    @keyframes bob { from { margin-top: 0 } to { margin-top: -7px } }
    #search { position: absolute; top: 10px; left: 10px; right: 10px; z-index: 1000; }
    #q { width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px;
      border: 1px solid #d5dbe3; padding: 0 12px; font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.18); outline: none; background: #fff; }
    #res { background: #fff; border-radius: 10px; margin-top: 6px; overflow-y: auto;
      max-height: 190px; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
    #res div { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #eef1f5; cursor: pointer; }
    #res div:last-child { border-bottom: none; }
    #busy { position: absolute; bottom: 10px; left: 10px; z-index: 1000; background: #fff;
      border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #6b7280;
      box-shadow: 0 2px 8px rgba(0,0,0,.15); display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="search"><input id="q" placeholder="Search a place, road or landmark" /><div id="res"></div></div>
  <div id="busy">Finding the road route…</div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
  <script>
    var D = ${data};
    var COL = { start: '#16a34a', end: '#dc2626', stop: '#f59e0b' };

    function send(msg){
      var s = JSON.stringify(msg);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
      else if (window.parent) window.parent.postMessage(s, '*');
    }

    var start = D.start, end = D.end, stops = D.stops || [];
    var draft = null, draftMarker = null, pendingName = '';
    var routeCtl = null, fallback = null;

    // Zoom sits bottom-right so it never hides under the search box.
    var map = L.map('map', { zoomControl: false, attributionControl: false })
      .setView([D.center.latitude, D.center.longitude], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    var pinLayer = L.layerGroup().addTo(map);

    function phase(){ return !start ? 'start' : !end ? 'end' : 'stop'; }
    function nextLabel(){ var p = phase(); return p === 'start' ? 'S' : p === 'end' ? 'E' : String(stops.length + 1); }
    function nextColor(){ return COL[phase()]; }

    function icon(txt, color, isDraft){
      return L.divIcon({
        className: '',
        html: '<div class="mk' + (isDraft ? ' draft' : '') + '" style="background:' + color + '"><b>' + txt + '</b></div>',
        iconSize: [34, 42], iconAnchor: [17, 41],
      });
    }

    function post(){
      send({ type: 'state', phase: phase(), hasDraft: !!draft, nextLabel: nextLabel(),
             start: start, end: end, stops: stops });
    }

    // ── The draft pin: dropped, moved and dragged freely until confirmed ──
    function setDraft(ll, name){
      draft = ll;
      pendingName = name || '';
      if (draftMarker) map.removeLayer(draftMarker);
      draftMarker = L.marker(ll, { icon: icon(nextLabel(), nextColor(), true), draggable: true, zIndexOffset: 1000 }).addTo(map);
      draftMarker.on('dragend', function(){ draft = draftMarker.getLatLng(); pendingName = ''; post(); });
      post();
    }
    function clearDraft(){
      if (draftMarker) map.removeLayer(draftMarker);
      draftMarker = null; draft = null; pendingName = '';
    }
    // Tapping anywhere else simply moves the pin — nothing is committed yet.
    map.on('click', function(e){ setDraft(e.latlng, ''); });

    function commit(){
      if (!draft) return;
      var p = phase();
      var placed = { lat: draft.lat, lng: draft.lng, label: pendingName || '' };
      var name = pendingName;
      clearDraft();
      if (p === 'start') start = placed; else if (p === 'end') end = placed; else stops.push(placed);
      redraw(); post();
      if (!name) reverseGeocode(placed, function(label){ placed.label = label; post(); });
    }

    function undo(){
      if (draft) { clearDraft(); post(); return; }
      if (stops.length) stops.pop();
      else if (end) end = null;
      else if (start) start = null;
      redraw(); post();
    }

    function redraw(){
      pinLayer.clearLayers();
      // interactive:false so a tap on a pin still lands on the map underneath.
      if (start) L.marker([start.lat, start.lng], { icon: icon('S', COL.start), interactive: false }).addTo(pinLayer);
      stops.forEach(function(s, i){
        L.marker([s.lat, s.lng], { icon: icon(String(i + 1), COL.stop), interactive: false }).addTo(pinLayer);
      });
      if (end) L.marker([end.lat, end.lng], { icon: icon('E', COL.end), interactive: false }).addTo(pinLayer);
      route();
    }

    function busy(on){ document.getElementById('busy').style.display = on ? 'block' : 'none'; }

    function drawFallback(pts){
      if (fallback) map.removeLayer(fallback);
      fallback = L.polyline(pts, { color: '#2563eb', weight: 5, dashArray: '8,10', opacity: .75 }).addTo(map);
      busy(false);
    }

    // The blue line. Every stop rides along as a WAYPOINT, so the route is
    // dragged through it even when it sits off the direct way.
    function route(){
      if (routeCtl) { try { map.removeControl(routeCtl); } catch (e) {} routeCtl = null; }
      if (fallback) { map.removeLayer(fallback); fallback = null; }
      if (!start || !end) { busy(false); return; }
      var wps = [L.latLng(start.lat, start.lng)]
        .concat(stops.map(function(s){ return L.latLng(s.lat, s.lng); }))
        .concat([L.latLng(end.lat, end.lng)]);
      var done = false;
      busy(true);
      try {
        routeCtl = L.Routing.control({
          waypoints: wps,
          router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
          lineOptions: { styles: [{ color: '#2563eb', weight: 6, opacity: .9 }], addWaypoints: false },
          addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: false, show: false,
          createMarker: function(){ return null; },
        }).addTo(map);
        routeCtl.on('routesfound', function(e){
          done = true; busy(false);
          var r = e.routes && e.routes[0];
          if (r && r.summary) send({ type: 'route', distanceKm: r.summary.totalDistance / 1000, durationMin: r.summary.totalTime / 60 });
        });
        routeCtl.on('routingerror', function(){ if (!done) drawFallback(wps); });
        setTimeout(function(){ if (!done) drawFallback(wps); }, 9000);
      } catch (err) { drawFallback(wps); }
    }

    // ── Naming: search to find a place, reverse geocode to name a pin ──
    function reverseGeocode(p, cb){
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + p.lat + '&lon=' + p.lng)
        .then(function(r){ return r.json(); })
        .then(function(d){
          var a = d.address || {};
          cb(d.name || a.road || a.neighbourhood || a.suburb || a.village || a.town || a.city ||
             ((d.display_name || '').split(',')[0]) || '');
        })
        .catch(function(){ cb(''); });
    }

    var q = document.getElementById('q'), res = document.getElementById('res'), timer = null;
    q.addEventListener('input', function(){
      clearTimeout(timer);
      var v = q.value.trim();
      if (v.length < 3) { res.innerHTML = ''; return; }
      timer = setTimeout(function(){ search(v); }, 400);
    });
    function search(v){
      fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(v))
        .then(function(r){ return r.json(); })
        .then(function(list){
          res.innerHTML = '';
          (list || []).forEach(function(it){
            var row = document.createElement('div');
            row.textContent = it.display_name;
            row.onclick = function(){
              var ll = L.latLng(parseFloat(it.lat), parseFloat(it.lon));
              map.setView(ll, 16);
              setDraft(ll, (it.display_name || '').split(',')[0]);
              res.innerHTML = ''; q.value = ''; q.blur();
            };
            res.appendChild(row);
          });
        })
        .catch(function(){ res.innerHTML = ''; });
    }

    // ── Commands from the React screen ──
    function handle(msg){
      if (!msg || !msg.cmd) return;
      if (msg.cmd === 'confirm') commit();
      else if (msg.cmd === 'drop') setDraft(map.getCenter(), '');
      else if (msg.cmd === 'undo') undo();
    }
    window.__cmd = function(j){ try { handle(typeof j === 'string' ? JSON.parse(j) : j); } catch (e) {} };
    window.addEventListener('message', function(e){
      try { var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d && d.cmd) handle(d); } catch (err) {}
    });
    document.addEventListener('message', function(e){
      try { var d = JSON.parse(e.data); if (d && d.cmd) handle(d); } catch (err) {}
    });

    // Seeded pins (editing an existing journey) — draw and frame them.
    redraw();
    var seeded = (start ? [start] : []).concat(stops).concat(end ? [end] : []);
    if (seeded.length) {
      map.fitBounds(L.latLngBounds(seeded.map(function(s){ return [s.lat, s.lng]; })), { padding: [60, 60], maxZoom: 16 });
    }
    post();
    setTimeout(function(){ map.invalidateSize(); }, 200);
  </script>
</body>
</html>`;
}

// ── The screen ────────────────────────────────────────────────────────────
export function RouteBuilder({ initial, center, onCancel, onDone }: RouteBuilderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<PageState | null>(null);
  const [summary, setSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const sendRef = useRef<(cmd: object) => void>(() => {});

  const html = useMemo(
    () =>
      buildHtml({
        center: center ?? initial?.start?.point ?? { latitude: 22.7196, longitude: 75.8577 },
        start: initial?.start ? toPage(initial.start) : null,
        end: initial?.end ? toPage(initial.end) : null,
        stops: (initial?.stops ?? []).map(toPage),
      }),
    // Built once — the page owns the pins from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onMessage = useCallback((raw: string) => {
    try {
      const d = JSON.parse(raw);
      if (d?.type === 'state') setState(d as PageState);
      else if (d?.type === 'route') setSummary({ distanceKm: d.distanceKm, durationMin: d.durationMin });
    } catch {}
  }, []);

  const phase: Phase = state?.phase ?? 'start';
  const hasDraft = !!state?.hasDraft;
  const stopNo = (state?.stops.length ?? 0) + 1;
  const canFinish = !!state?.start && !!state?.end;

  const stepName =
    phase === 'start' ? 'starting point' : phase === 'end' ? 'ending point' : `stop ${stopNo}`;
  const prompt = hasDraft
    ? `Pin placed — tap another spot to move it, or confirm the ${stepName}.`
    : phase === 'start'
      ? 'Tap on the map where the journey STARTS — or search for the place.'
      : phase === 'end'
        ? 'Now tap where the journey ENDS. The road route appears once both are set.'
        : `Add stop ${stopNo} along the way — the blue route bends to pass through it. Done adding? Save the route.`;

  const finish = () => {
    if (!state?.start || !state?.end) return;
    onDone({
      start: fromPage(state.start, 'Start'),
      end: fromPage(state.end, 'End'),
      stops: state.stops.map((s, i) => fromPage(s, `Stop ${i + 1}`)),
    });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onCancel} hitSlop={10} style={styles.close}>
            <Text variant="title" weight="bold">
              ✕
            </Text>
          </Pressable>
          <View style={styles.flex}>
            <Text weight="bold">Mark the route</Text>
            <Text variant="caption" tone="muted">
              {phase === 'start'
                ? 'Step 1 · starting point'
                : phase === 'end'
                  ? 'Step 2 · ending point'
                  : `Step 3 · stops (${state?.stops.length ?? 0} added)`}
            </Text>
          </View>
          {summary ? (
            <Text variant="caption" tone="muted">
              {summary.distanceKm.toFixed(1)} km · {Math.round(summary.durationMin)} min
            </Text>
          ) : null}
        </View>

        {/* Map */}
        <View style={styles.flex}>
          <MapHost html={html} onMessage={onMessage} sendRef={sendRef} />
        </View>

        {/* Marked pins so far */}
        {state && (state.start || state.end || state.stops.length > 0) ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.pins, { borderTopColor: colors.border }]}
            contentContainerStyle={styles.pinsRow}
          >
            {state.start ? <PinChip badge="S" color="#16a34a" label={state.start.label || 'Start'} /> : null}
            {state.stops.map((s, i) => (
              <PinChip key={`s${i}`} badge={String(i + 1)} color="#f59e0b" label={s.label || `Stop ${i + 1}`} />
            ))}
            {state.end ? <PinChip badge="E" color="#dc2626" label={state.end.label || 'End'} /> : null}
          </ScrollView>
        ) : null}

        {/* Controls */}
        <View
          style={[
            styles.bar,
            { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Text variant="caption" tone="muted" style={styles.prompt}>
            {prompt}
          </Text>
          <Button
            title={
              hasDraft
                ? `✓ Confirm ${stepName}`
                : phase === 'start'
                  ? '📍 Drop the S pin here'
                  : phase === 'end'
                    ? '📍 Drop the E pin here'
                    : `📍 Drop pin ${stopNo} here`
            }
            onPress={() => sendRef.current({ cmd: hasDraft ? 'confirm' : 'drop' })}
          />
          <View style={styles.row}>
            <Button
              title="↩ Undo"
              variant="secondary"
              onPress={() => sendRef.current({ cmd: 'undo' })}
              style={styles.flex}
            />
            <Button
              title="✓ Save route"
              variant={canFinish ? 'primary' : 'secondary'}
              disabled={!canFinish}
              onPress={finish}
              style={styles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PinChip({ badge, color, label }: { badge: string; color: string; label: string }) {
  const colors = useColors();
  return (
    <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text variant="caption" weight="bold" tone="inverse">
          {badge}
        </Text>
      </View>
      <Text variant="caption" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const toPage = (p: BuiltPoint): PagePoint => ({
  lat: p.point.latitude,
  lng: p.point.longitude,
  label: p.label,
});
const fromPage = (p: PagePoint, fallback: string): BuiltPoint => ({
  label: p.label?.trim() || fallback,
  point: { latitude: p.lat, longitude: p.lng },
});

/** Platform-appropriate Leaflet host, with a channel back INTO the page. */
function MapHost({
  html,
  onMessage,
  sendRef,
}: {
  html: string;
  onMessage: (raw: string) => void;
  sendRef: React.MutableRefObject<(cmd: object) => void>;
}) {
  return Platform.OS === 'web' ? (
    <WebHost html={html} onMessage={onMessage} sendRef={sendRef} />
  ) : (
    <NativeHost html={html} onMessage={onMessage} sendRef={sendRef} />
  );
}

function WebHost({
  html,
  onMessage,
  sendRef,
}: {
  html: string;
  onMessage: (raw: string) => void;
  sendRef: React.MutableRefObject<(cmd: object) => void>;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const cb = useRef(onMessage);
  cb.current = onMessage;

  sendRef.current = (cmd: object) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify(cmd), '*');
  };

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (typeof e.data !== 'string') return;
      cb.current(e.data);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <View style={styles.fill}>
      {createElement('iframe', {
        ref: frame,
        srcDoc: html,
        style: { border: 'none', width: '100%', height: '100%' },
        title: 'Mark the route',
      })}
    </View>
  );
}

function NativeHost({
  html,
  onMessage,
  sendRef,
}: {
  html: string;
  onMessage: (raw: string) => void;
  sendRef: React.MutableRefObject<(cmd: object) => void>;
}) {
  // Required lazily so the web bundle never touches the native module.
  const { WebView } = require('react-native-webview');
  const view = useRef<{ injectJavaScript: (js: string) => void } | null>(null);

  sendRef.current = (cmd: object) => {
    view.current?.injectJavaScript(`window.__cmd(${JSON.stringify(JSON.stringify(cmd))}); true;`);
  };

  return (
    <WebView
      ref={view}
      originWhitelist={['*']}
      source={{ html }}
      style={styles.fill}
      onMessage={(e: { nativeEvent: { data: string } }) => onMessage(e.nativeEvent.data)}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  close: { paddingRight: spacing.xs },
  pins: { flexGrow: 0, borderTopWidth: 1 },
  pinsRow: { gap: spacing.sm, padding: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 180,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bar: { borderTopWidth: 1, padding: spacing.md, gap: spacing.sm },
  prompt: { textAlign: 'center', marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
});
