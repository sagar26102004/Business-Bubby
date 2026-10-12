/**
 * Real device location via expo-location, sitting behind PlacesRepository so
 * the rest of the app keeps depending only on repository interfaces.
 *
 * Everything degrades gracefully: if permission is denied, the platform has no
 * GPS, or a read fails, callers fall back to the seeded mock coordinate. On web
 * geolocation only works over https:// or localhost.
 *
 * FAST FIRST ANSWER. A fresh GPS fix can take 5–30 s on a phone, and Explore
 * can't sort anything by distance until it has a point — so a fresh fix is
 * never waited for when an older one exists. The answer comes from, in order:
 * this session's fix → the last fix saved on the device → the OS's last known
 * position. A fresh fix is then taken in the background and saved; screens pick
 * it up on their next refetch (every screen refetches on focus). Only a device
 * that has never had a fix waits for one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import type { GeoPoint } from '@/domain/types';

const STORAGE_KEY = 'localo:lastfix/v1';

/** Cached so we don't re-prompt / re-read on every repository call. */
let cached: GeoPoint | null = null;
/** True once THIS session has a fresh fix (not just a remembered one). */
let fresh = false;
let inFlight: Promise<GeoPoint | null> | null = null;
let refreshing: Promise<GeoPoint | null> | null = null;

const toPoint = (pos: Location.LocationObject | null): GeoPoint | null =>
  pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null;

/** Take a fresh fix, remember it (memory + device). Never throws. */
function refreshFix(): Promise<GeoPoint | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const point = toPoint(
          await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        );
        if (point) {
          cached = point;
          fresh = true;
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(point)).catch(() => {});
        }
        return point;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** The fix saved by an earlier session, or null. */
async function savedFix(): Promise<GeoPoint | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const p = raw ? (JSON.parse(raw) as GeoPoint) : null;
    return p && typeof p.latitude === 'number' && typeof p.longitude === 'number' ? p : null;
  } catch {
    return null;
  }
}

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

      // Anything we already know answers now; the fresh fix follows behind.
      let known = await savedFix();
      if (!known) {
        try {
          known = toPoint(await Location.getLastKnownPositionAsync());
        } catch {
          known = null;
        }
      }
      if (known) {
        cached = known;
        if (!fresh) void refreshFix();
        return known;
      }
      return await refreshFix();
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
  fresh = false;
}
