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
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/**
 * The Android channel incoming calls use. Must match the edge function.
 *
 * ⚠️ VERSIONED ON PURPOSE. Android freezes a channel's importance, sound and
 * vibration at CREATION and ignores every later change — the user owns those
 * settings from then on. So changing how a call rings means a NEW id, not an
 * edit. `calls` (v1) rang with the default notification sound, i.e. one short
 * ding you could scroll past; `calls_v2` rings for the full window.
 */
export const CALL_CHANNEL_ID = 'calls_v2';
/** The v1 channel, deleted on sight so users don't keep two "Incoming calls". */
const LEGACY_CALL_CHANNEL_ID = 'calls';

/**
 * The category that puts ACCEPT / DECLINE buttons on the notification itself.
 * Registered natively, so the buttons appear even when the app is dead — which
 * is the entire point: the owner answers from the popup without hunting for
 * the app first.
 */
export const CALL_CATEGORY_ID = 'incoming_call';

/**
 * Why this device isn't registered to be rung, if it isn't.
 *
 * Registration is deliberately best-effort — a push problem must never break
 * the app — which for a long time meant the failure went into an empty `catch`
 * and the phone simply stayed silent forever with nothing anywhere saying so.
 * The server reported "no registered devices" while the phone's own check said
 * it was registered, and neither side could name the missing step. So keep the
 * reason. In memory, not on disk: it is re-derived on every launch, and a stale
 * one would be worse than none.
 */
let lastRegistration: string | null = null;

/** `null` clears it — call that on success, so a fixed phone stops accusing itself. */
export function recordRegistration(reason: string | null): void {
  lastRegistration = reason;
}

export function getLastRegistration(): string | null {
  return lastRegistration;
}

/** Deep link that answers a call: the session screen joins on `answer=1`. */
export function answerUrlFor(callId: string): string {
  return Linking.createURL(`/call/session/${callId}`, { queryParams: { answer: '1' } });
}

/** True for a notification that is announcing an incoming call. */
function isCallNotification(notification: Notifications.Notification): boolean {
  const data = notification.request.content.data as { kind?: string } | undefined;
  return data?.kind === 'incoming_call';
}

/**
 * Show the alert even when the app happens to be in the FOREGROUND. Android's
 * default is to suppress it, which would mean a call arriving while you're on
 * another screen makes no sound at all.
 *
 * Calls are the exception: IncomingCallGate is already on screen with the
 * answer and decline buttons, ringing. Letting the notification through as well
 * would put a banner over the top of the very thing it is telling you about.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isCall = isCallNotification(notification);
      return {
        shouldPlaySound: !isCall,
        shouldSetBadge: false,
        shouldShowBanner: !isCall,
        shouldShowList: !isCall,
      };
    },
  });
}

/**
 * Clear any notification announcing this call — answered here, answered by a
 * teammate, declined, cancelled or rang out.
 *
 * Matches on the callId the payload carries rather than dismissing everything,
 * so an unrelated order or chat alert sitting in the shade survives being in
 * the wrong place at the wrong time.
 */
export async function dismissCallNotifications(callId: string): Promise<void> {
  // A browser tab never posted one, and asking is an error there rather than
  // an empty list.
  if (Platform.OS === 'web') return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = n.request.content.data as { callId?: string } | undefined;
          return data?.callId === callId;
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    /* nothing presented, or the platform can't enumerate — not worth surfacing */
  }
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
    description: 'Rings when someone calls your business.',
    importance: Notifications.AndroidImportance.MAX,
    // A 32-second ring cadence rather than 'default'. Android plays a channel's
    // sound ONCE per notification, so ringing for the whole 30s call window has
    // to come from the file's length — there is no loop setting. Bundled into
    // res/raw by the expo-notifications plugin (`sounds` in app.json); named
    // WITHOUT a path, exactly as the plugin installs it.
    //
    // ⚠️ The UNDERSCORE is load-bearing. This becomes an Android resource name,
    // which must match [a-z][a-z0-9_]* — a hyphen fails prebuild outright
    // ("Resource name is not valid"), so never rename this to call-ringtone.
    sound: 'call_ringtone.wav',
    vibrationPattern: [0, 700, 550, 700, 2050],
    enableVibrate: true,
    enableLights: true,
    lightColor: '#FF6A3D',
    // A phone call is the one thing that earns an interruption.
    bypassDnd: true,
    // Show it in full on the lock screen — with its Accept/Decline buttons.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  // Retire the v1 channel; otherwise the app's notification settings list two
  // "Incoming calls" entries and the user can't tell which one is live.
  await Notifications.deleteNotificationChannelAsync(LEGACY_CALL_CHANNEL_ID).catch(() => {});
}

/**
 * Register the Accept / Decline buttons.
 *
 * Accept opens the app (`opensAppToForeground`) because answering means joining
 * the call, which needs the app running anyway. Decline deliberately does NOT
 * open it — being forced into the app just to refuse a call is exactly the
 * annoyance we're removing. See PushRegistrar for what each one does.
 */
async function ensureCallCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
    {
      identifier: 'accept',
      buttonTitle: '📞 Accept',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'decline',
      buttonTitle: '📵 Decline',
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
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
    await ensureCallCategory();

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
