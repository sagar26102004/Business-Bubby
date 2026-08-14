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
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type { GeoPoint } from '@/domain/types';

/** Unique name for the driver's background location task. */
export const DRIVER_LOCATION_TASK = 'localo-driver-location';

/**
 * Running inside Expo Go (the store client), not a dev/standalone build.
 * Background location is unavailable here (nonexistent on Android, Simulator-
 * only on iOS), and even *calling* the background APIs makes expo-location emit
 * a console warning. So in Expo Go we skip the background path entirely and
 * share foreground-only — a real dev build lights the background path back up.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * ⛔ BACKGROUND LOCATION IS OFF FOR THE v1.0 PLAY RELEASE.
 *
 * Everything below is FULLY IMPLEMENTED and deliberately left intact — this one
 * flag is the whole switch. It is off because declaring
 * ACCESS_BACKGROUND_LOCATION obliges us to file Google Play's Location
 * Permissions declaration (a form plus a demo video of the disclosure → OS
 * prompt → live-sharing flow) before the app can publish. We ship 1.0 without
 * that review round-trip and turn this on in 1.1.
 *
 * With it off, drivers still share while the workspace is open:
 * `startBackgroundShare` returns { ok: true, background: false } and the vehicle
 * simply stops moving once the app is closed. No caller changes either way.
 *
 * ── TO RE-ENABLE — all four steps, or you ship a permission the app can't use:
 *   1. Set this to `true`.
 *   2. app.json → expo.plugins → "expo-location": set
 *      `isAndroidBackgroundLocationEnabled` AND
 *      `isAndroidForegroundServiceEnabled` back to `true`.
 *   3. app.json → expo.android: move ACCESS_BACKGROUND_LOCATION and
 *      FOREGROUND_SERVICE_LOCATION out of `blockedPermissions` and back into
 *      `permissions`.
 *   4. Play Console: complete the Location Permissions declaration AND the
 *      Foreground Service Types declaration. Record the video from a dev or
 *      production build — Expo Go cannot run background location at all.
 *
 * Deliberately NOT an EXPO_PUBLIC_ env var: env vars only reach the JS bundle,
 * whereas the permission Play actually scans is baked into AndroidManifest.xml
 * at prebuild. A runtime-only flag would hide the feature and still ship the
 * permission — the worst of both. Steps 1–3 have to move together.
 */
const BACKGROUND_LOCATION_ENABLED = false;

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
  /**
   * Why it couldn't fully start — surfaced to the driver. `declined` means the
   * driver said no to OUR disclosure, so the OS was never asked; it is kept
   * apart from `denied` (the OS dialog itself refused) because nagging someone
   * about a Settings screen they deliberately avoided is exactly the pattern
   * the disclosure requirement exists to stop.
   */
  reason?: 'web' | 'denied' | 'declined' | 'error';
}

/**
 * Begin sharing the driver's live location. Requests foreground permission
 * first (needed even to read GPS), then the always-on background permission,
 * and starts OS-managed background updates when granted. Safe to call twice.
 *
 * ⚠️ `confirmBackground` IS THE GOOGLE PLAY PROMINENT DISCLOSURE, and it is a
 * required argument on purpose: Play's Location Permissions policy demands an
 * in-app explanation BEFORE the system background-location dialog, and a
 * required parameter is the only version of that rule a future caller cannot
 * forget — leave it out and the build fails to typecheck rather than failing
 * review weeks later. Pass `confirm` from `useBackgroundLocationDisclosure`
 * (features/fleet/BackgroundLocationDisclosure.tsx); pass `async () => false`
 * only if you deliberately want foreground-only sharing.
 *
 * It is awaited at precisely one point — after foreground permission is granted
 * and immediately before the background request — so the disclosure never
 * appears for plain foreground GPS, which the whole app uses for distance
 * sorting and which needs no disclosure at all. It is also skipped when the
 * permission has already been granted on a previous shift, since there is no
 * upcoming OS prompt to disclose.
 */
export async function startBackgroundShare(
  confirmBackground: () => Promise<boolean>,
): Promise<ShareResult> {
  if (Platform.OS === 'web') return { ok: true, background: false, reason: 'web' };
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { ok: false, reason: 'denied' };

    // Two cases share one path: Expo Go can't run background updates, and
    // BACKGROUND_LOCATION_ENABLED is off for the 1.0 Play release. Either way we
    // share foreground-only and never touch the background APIs — which also
    // keeps expo-location from throwing on a permission that is not in the
    // manifest. Nothing is disclosed here: we are not about to ask for anything.
    if (isExpoGo || !BACKGROUND_LOCATION_ENABLED) return { ok: true, background: false };

    let bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg?.status !== 'granted') {
      // A disclosure that throws must not take foreground sharing down with it,
      // and must not be read as consent — so a failure here is a quiet "no".
      const consented = await confirmBackground().catch(() => false);
      if (!consented) return { ok: true, background: false, reason: 'declined' };
      bg = await Location.requestBackgroundPermissionsAsync();
    }

    if (bg?.status === 'granted') {
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
  if (Platform.OS === 'web' || isExpoGo) return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(
      () => false,
    );
    if (started) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch {
    // Nothing to stop / already stopped.
  }
}
