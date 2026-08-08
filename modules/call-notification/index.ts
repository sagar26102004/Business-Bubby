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
 */
export async function showIncomingCall(input: {
  callId: string;
  callerName: string;
  businessName: string;
  channelId: string;
  answerUri: string;
  timeoutMs: number;
}): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.showIncomingCall(
      input.callId,
      input.callerName,
      input.businessName,
      input.channelId,
      input.answerUri,
      input.timeoutMs,
    );
  } catch {
    /* never let a notification failure surface as a broken call */
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
