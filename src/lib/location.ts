/**
 * Real device location via expo-location, sitting behind PlacesRepository so
 * the rest of the app keeps depending only on repository interfaces.
 *
 * Everything degrades gracefully: if permission is denied, the platform has no
 * GPS, or a read fails, callers fall back to the seeded mock coordinate. On web
 * geolocation only works over https:// or localhost.
 */
import * as Location from 'expo-location';

import type { GeoPoint } from '@/domain/types';

/** Cached so we don't re-prompt / re-read on every repository call. */
let cached: GeoPoint | null = null;
let inFlight: Promise<GeoPoint | null> | null = null;

/**
 * The device's current coordinate, or null if it can't be determined
 * (permission denied, unsupported, or an error). Never throws.
 */
export async function getDeviceLocation(): Promise<GeoPoint | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      cached = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      return cached;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Forget the cached fix so the next read re-queries the device. */
export function clearDeviceLocation(): void {
  cached = null;
}
