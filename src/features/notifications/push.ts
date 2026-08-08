/**
 * Device push registration — the half of "ring me when the app is closed" that
 * lives on the device.
 *
 * The app learns about incoming calls by polling, which stops dead the moment
 * the app is closed. A push wakes it. This module gets this device's Expo push
 * token and hands it to the backend; the `call-ring` edge function does the
 * sending.
 *
 * Everything here is BEST EFFORT. A device that can't register (permission
 * denied, no Firebase credentials, Expo Go, a simulator) must still be a fully
 * working app — it simply won't ring while closed.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** The Android channel incoming calls use. Must match the edge function. */
export const CALL_CHANNEL_ID = 'calls';

/**
 * Show the alert even when the app happens to be in the FOREGROUND. Android's
 * default is to suppress it, which would mean a call arriving while you're on
 * another screen makes no sound at all.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * The Android notification channel for calls. Channel settings are fixed at
 * CREATION time on Android — changing them later needs a new channel id — so
 * this is deliberately maximal: highest importance (heads-up), sound, a ring
 * cadence, visible on the lock screen, and allowed through Do Not Disturb,
 * because a phone call is the one thing that should interrupt.
 */
async function ensureCallChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
    name: 'Incoming calls',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 700, 550, 700],
    enableVibrate: true,
    enableLights: true,
    lightColor: '#FF6A3D',
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** The EAS project id, which getExpoPushTokenAsync needs to mint a token. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/**
 * Ask for permission (if not already granted) and return this device's Expo
 * push token, or null when push isn't available here.
 *
 * Deliberately does NOT re-prompt: `requestPermissionsAsync` only runs when the
 * status is still undetermined, so a user who said no isn't nagged on every
 * launch.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    // Web push needs a service worker + VAPID keys we haven't set up; and the
    // browser tab is the one place the app is reliably already open.
    if (Platform.OS === 'web') return null;

    await ensureCallChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return null;

    const id = projectId();
    const token = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : {});
    return token.data || null;
  } catch {
    // No FCM credentials in this build, Expo Go, an emulator without Play
    // Services — none of it should surface to the user mid-session.
    return null;
  }
}
