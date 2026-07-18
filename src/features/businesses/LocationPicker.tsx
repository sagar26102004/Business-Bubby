/**
 * Zomato/Amazon-style location pin picker, on the app's schematic map (same
 * self-contained projection as app/map.tsx — no map SDK, works on web).
 *
 * The pin starts at the user's current location and moves wherever they tap;
 * "Use my current location" snaps it back. Nearby businesses render as faint
 * dots so the schematic map is orientable. When real street tiles arrive
 * (native build), swap the canvas internals — value/onChange stay the same.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import type { GeoPoint } from '@/domain/types';
import { getType } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { Button, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const RADIUS_KM = 5; // area shown around the user
const RING_KMS = [1, 3, 5];
const CANVAS_HEIGHT = 260;
const PIN_SIZE = 34;

export interface LocationPickerProps {
  value?: GeoPoint;
  onChange: (point: GeoPoint) => void;
}

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const repos = useRepositories();
  const colors = useColors();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const { data } = useAsync(async () => {
    const center = await repos.places.getCurrentPlace();
    const nearby = await repos.businesses.list({
      near: center.point,
      maxDistanceKm: RADIUS_KM,
      sortByDistance: true,
    });
    return { center: center.point, nearby };
  }, []);

  // Like a delivery app: the pin starts on the user's current location and
  // they adjust from there.
  useEffect(() => {
    if (data && !value) onChange(data.center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  // Project lat/lng <-> canvas pixels, centred on the user (as in map.tsx).
  const projection = useMemo(() => {
    const center = data?.center;
    if (!center || !size.width || !size.height) return null;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const pad = PIN_SIZE;
    const pxPerKm = (Math.min(size.width, size.height) / 2 - pad) / RADIUS_KM;
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((center.latitude * Math.PI) / 180);
    return {
      cx,
      cy,
      pxPerKm,
      toXY: (point: GeoPoint) => ({
        x: cx + (point.longitude - center.longitude) * kmPerDegLng * pxPerKm,
        y: cy - (point.latitude - center.latitude) * kmPerDegLat * pxPerKm,
      }),
      toPoint: (x: number, y: number): GeoPoint => ({
        latitude: center.latitude + (cy - y) / pxPerKm / kmPerDegLat,
        longitude: center.longitude + (x - cx) / pxPerKm / kmPerDegLng,
      }),
    };
  }, [data?.center, size]);

  const pinXY = projection && value ? projection.toXY(value) : null;
  const distanceKm = data && value ? haversineKm(data.center, value) : undefined;

  const canvasRef = useRef<View>(null);

  // locationX/Y are only set for touch events; web mouse clicks need the
  // canvas's window position to turn pageX/Y into canvas-relative coords.
  const placePin = (nativeEvent: { locationX?: number; locationY?: number; pageX: number; pageY: number }) => {
    if (!projection) return;
    const { locationX, locationY, pageX, pageY } = nativeEvent;
    if (Number.isFinite(locationX) && Number.isFinite(locationY)) {
      onChange(projection.toPoint(locationX!, locationY!));
      return;
    }
    canvasRef.current?.measureInWindow((wx, wy) => {
      const point = projection.toPoint(pageX - wx, pageY - wy);
      if (Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) onChange(point);
    });
  };

  return (
    <View>
      <Pressable
        ref={canvasRef}
        onLayout={onLayout}
        onPress={(e) => placePin(e.nativeEvent)}
        style={[
          styles.canvas,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        {projection ? (
          <>
            {/* Range rings for scale */}
            {RING_KMS.map((km) => {
              const r = km * projection.pxPerKm;
              return (
                <View
                  key={km}
                  pointerEvents="none"
                  style={[
                    styles.ring,
                    {
                      width: r * 2,
                      height: r * 2,
                      borderRadius: r,
                      left: projection.cx - r,
                      top: projection.cy - r,
                      borderColor: colors.border,
                    },
                  ]}
                />
              );
            })}

            {/* Nearby businesses, faint, for orientation */}
            {data?.nearby
              .filter((b) => b.location.point)
              .map((b) => {
                const p = projection.toXY(b.location.point!);
                return (
                  <View
                    key={b.id}
                    pointerEvents="none"
                    style={[
                      styles.nearbyDot,
                      { left: p.x - 5, top: p.y - 5, backgroundColor: getType(b.type)?.color ?? colors.border },
                    ]}
                  />
                );
              })}

            {/* User's current location */}
            <View
              pointerEvents="none"
              style={[
                styles.userDot,
                {
                  left: projection.cx - 8,
                  top: projection.cy - 8,
                  backgroundColor: colors.accent,
                  borderColor: colors.surface,
                },
              ]}
            />

            {/* The pin — anchored bottom-centre like a map pin */}
            {pinXY ? (
              <Text
                pointerEvents="none"
                style={[styles.pin, { left: pinXY.x - PIN_SIZE / 2, top: pinXY.y - PIN_SIZE + 4 }]}
              >
                📍
              </Text>
            ) : null}
          </>
        ) : null}

        <View style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="caption" tone="muted">
            ◉ You · tap the map to move your pin
          </Text>
        </View>
      </Pressable>

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
          onPress={() => data && onChange(data.center)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    height: CANVAS_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  ring: { position: 'absolute', borderWidth: 1 },
  nearbyDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, opacity: 0.35 },
  userDot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
  pin: { position: 'absolute', fontSize: PIN_SIZE - 6 },
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
