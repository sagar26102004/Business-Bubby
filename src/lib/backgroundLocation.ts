/**
 * Background live-location for drivers — keeps a fleet vehicle moving on the
 * map even when the driver's app is backgrounded or the phone is locked.
 *
 * This is the OS side of "Share my live location": it asks for the always-on
 * location permission and registers a headless TaskManager task that the OS
 * wakes with fresh GPS fixes. Everything is guarded so it NEVER throws and
 * simply no-ops where background location can't run — the web preview (no
 * background APIs) and Expo Go (needs a dev build for background updates).
 *
 * What's still mocked: there's no server to receive the fixes yet, so the task
 * records the latest one in memory. When the real backend lands, the ONE `TODO`
 * below (POST the fix to the tracking service) is the only thing that changes —
 * the toggle, permissions and task wiring stay exactly as they are.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type { GeoPoint } from '@/domain/types';

/** Unique name for the driver's background location task. */
export const DRIVER_LOCATION_TASK = 'localo-driver-location';

let latestFix: (GeoPoint & { at: number }) | null = null;

// Register the headless task once, at module load, on native only. It runs
// outside React (the OS may start it while the app is closed), so it can't
// reach the repository hooks — the real backend hook is the single POST below.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    const last = locations?.[locations.length - 1];
    if (!last) return;
    latestFix = {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
      at: last.timestamp,
    };
    // TODO(backend): POST `latestFix` to the tracking service, keyed by the
    // signed-in driver, so every watcher sees the vehicle move in real time.
  });
}

/** The most recent background GPS fix, or null if none has arrived. */
export function getLatestBackgroundFix(): (GeoPoint & { at: number }) | null {
  return latestFix;
}

export interface ShareResult {
  /** Foreground sharing is on (the vehicle moves while the app is open). */
  ok: boolean;
  /** Background updates are on too (the vehicle keeps moving when closed). */
  background?: boolean;
  /** Why it couldn't fully start — surfaced to the driver. */
  reason?: 'web' | 'denied' | 'error';
}

/**
 * Begin sharing the driver's live location. Requests foreground permission
 * first (needed even to read GPS), then the always-on background permission,
 * and starts OS-managed background updates when granted. Safe to call twice.
 */
export async function startBackgroundShare(): Promise<ShareResult> {
  if (Platform.OS === 'web') return { ok: true, background: false, reason: 'web' };
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { ok: false, reason: 'denied' };

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status === 'granted') {
      const already = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(
        () => false,
      );
      if (!already) {
        await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15_000,
          distanceInterval: 25,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Sharing your live location',
            notificationBody: 'Your vehicle is visible to the owner and tracking customers.',
          },
        });
      }
      return { ok: true, background: true };
    }
    // Foreground granted but background denied: still share while the app is
    // open — just can't keep moving once it's closed.
    return { ok: true, background: false, reason: 'denied' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Stop sharing — turns off OS background updates if they were running. */
export async function stopBackgroundShare(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(
      () => false,
    );
    if (started) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch {
    // Nothing to stop / already stopped.
  }
}
