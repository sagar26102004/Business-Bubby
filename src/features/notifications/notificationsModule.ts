/**
 * The one place `expo-notifications` is loaded — lazily, and never in Expo Go
 * on Android.
 *
 * WHY THIS EXISTS
 * Expo Go dropped Android remote push in SDK 53, and `expo-notifications`
 * enforces that from a MODULE-LEVEL side effect: importing the package runs
 * `DevicePushTokenAutoRegistration.fx`, which registers a push-token listener,
 * which calls `warnOfExpoGoPushUsage()`, which on Android `throw`s. A plain
 * `import * as Notifications from 'expo-notifications'` therefore explodes at
 * BUNDLE LOAD, not at call time — and because the chain reaches it through
 * `IncomingCallGate` → `app/_layout.tsx`, the throw took down the root layout
 * and the whole app failed to render in Expo Go with "Cannot read property
 * 'ErrorBoundary' of undefined".
 *
 * So: no static import anywhere. Runtime callers ask for the module and get
 * `null` where it can't be loaded, which matches what push.ts already promises
 * — registration is best effort, and a device that can't register is still a
 * fully working app that simply won't ring while closed. Dev/preview builds and
 * the Play build are unaffected; they get the real module.
 *
 * TYPES are safe to import statically (`import type` is erased at compile
 * time), so callers keep full typing via `NotificationsApi`.
 */
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

export type NotificationsApi = typeof import('expo-notifications');

/**
 * Can this runtime load the module at all? False only in Expo Go on Android,
 * where the import itself throws. iOS Expo Go merely warns, and local
 * notification APIs still work there, so it stays enabled.
 */
export const notificationsAvailable = !(Platform.OS === 'android' && isRunningInExpoGo());

let cached: NotificationsApi | null | undefined;

/** The module, or null when this runtime can't have it. Never throws. */
export function getNotifications(): NotificationsApi | null {
  if (cached !== undefined) return cached;
  if (!notificationsAvailable) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsApi;
  } catch {
    // A runtime that ships without the native module — treat it like Expo Go.
    cached = null;
  }
  return cached;
}
