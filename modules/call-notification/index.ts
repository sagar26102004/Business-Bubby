/**
 * Native incoming-call notification (Android only).
 *
 * Renders the SYSTEM call popup — round avatar, "Incoming call", and coloured
 * Decline / Answer pills — which stays up for the whole ring and takes over a
 * locked screen. `expo-notifications` can't produce that: it has no CallStyle
 * and no full-screen intent, so a JS-only notification is always a plain banner
 * with text buttons that collapses after a few seconds.
 *
 * Everything except the rendering stays in TypeScript, so this wrapper is
 * deliberately thin — and no-ops anywhere the native module isn't present (web,
 * Expo Go, or a build made before the module existed), because a missing
 * notification must never take the app down with it.
 */
import { Platform } from 'react-native';

interface CallNotificationNative {
  showIncomingCall(
    callId: string,
    callerName: string,
    businessName: string,
    channelId: string,
    answerUri: string,
    timeoutMs: number,
  ): Promise<void>;
  dismiss(callId: string): Promise<void>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<void>;
  setAnswerUriTemplate(template: string): Promise<void>;
  /** What to substitute the call id for inside that template. */
  callIdPlaceholder: string;
}

/**
 * Resolve the native module lazily and tolerantly. `requireNativeModule`
 * THROWS when the module isn't in the binary — which is the normal case on web
 * and in Expo Go — so this must never run at import time.
 */
function native(): CallNotificationNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo');
    return requireNativeModule('CallNotification') as CallNotificationNative;
  } catch {
    return null;
  }
}

/** True when this build can actually draw the system call popup. */
export function isCallNotificationAvailable(): boolean {
  return native() !== null;
}

/**
 * Show the incoming-call popup. `answerUri` is a deep link into the app (built
 * with expo-linking, so the scheme is defined in one place); `timeoutMs` should
 * be the call's ring window so Android clears a call nobody answered.
 *
 * Returns whether anything was actually posted, so the caller can fall back to
 * a plain expo-notifications alert. Getting this wrong is expensive: a silent
 * `false` that nobody checks means the phone never rings at all.
 */
export async function showIncomingCall(input: {
  callId: string;
  callerName: string;
  businessName: string;
  channelId: string;
  answerUri: string;
  timeoutMs: number;
}): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    await mod.showIncomingCall(
      input.callId,
      input.callerName,
      input.businessName,
      input.channelId,
      input.answerUri,
      input.timeoutMs,
    );
    return true;
  } catch {
    // Never let a notification failure surface as a broken call — but do say so,
    // so the caller can still ring some other way.
    return false;
  }
}

/**
 * Teach the native side how to deep-link into a call.
 *
 * ⚠️ REQUIRED for the popup to work while the app is closed. The push arrives
 * at a Kotlin service with no JavaScript running, so the Answer button's
 * destination cannot be built at that moment — the app's URL scheme lives in
 * app.json and is known only to expo-linking. `build(placeholder)` is called
 * with the token to put where the call id goes; the result is stored once and
 * reused for every call after.
 *
 * No-ops where the native module isn't present, like everything else here.
 */
export async function setAnswerUriTemplate(
  build: (placeholder: string) => string,
): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.setAnswerUriTemplate(build(mod.callIdPlaceholder));
  } catch {
    /* the popup falls back to Expo's plain notification */
  }
}

/**
 * Whether Android will let this app post the real call popup.
 *
 * Android 14 turned USE_FULL_SCREEN_INTENT into a per-app switch that is only
 * ON by default for apps Play classifies as calling apps — so for most installs
 * this is FALSE until the user flips it themselves, and the popup falls back to
 * a banner with Answer/Decline buttons. `null` means the question doesn't apply
 * here (web, Expo Go, or a build without the module).
 */
export async function canUseFullScreenIntent(): Promise<boolean | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return await mod.canUseFullScreenIntent();
  } catch {
    return null;
  }
}

/**
 * Open the system screen holding that switch. There is no runtime dialog for
 * this permission — Android made it a manual toggle on purpose, so taking the
 * user to it is the most any app can do.
 */
export async function openFullScreenIntentSettings(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.openFullScreenIntentSettings();
  } catch {
    /* the settings screen is missing on this ROM — nothing to fall back to */
  }
}

/** Clear the popup — answered, declined, cancelled or rang out. */
export async function dismissIncomingCall(callId: string): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.dismiss(callId);
  } catch {
    /* already gone */
  }
}
