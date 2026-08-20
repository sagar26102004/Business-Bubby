/**
 * Native incoming calls (Android only).
 *
 * Two things live behind this wrapper. The one that matters is the WhatsApp
 * style CALL SCREEN — a full-screen activity that wakes the display, draws over
 * the lock screen and offers Answer and Decline — which Android will only let
 * an app show if one of two unrelated permissions has been granted. The other
 * is the SYSTEM call notification (CallStyle: round avatar, coloured pills),
 * used for ringing on demand and as a fallback.
 *
 * `expo-notifications` can produce neither: no CallStyle, no full-screen
 * intent, no activity. What it CAN do is post the ordinary ringing notification
 * with Accept/Decline buttons, and that is the floor everything here sits on
 * top of — see CallMessagingService.
 *
 * Everything except the drawing stays in TypeScript, so this wrapper is
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
  ): Promise<boolean>;
  showCallScreen(
    callId: string,
    callerName: string,
    businessName: string,
    timeoutMs: number,
  ): Promise<string>;
  dismiss(callId: string): Promise<void>;
  getRingLog(): Promise<string[]>;
  clearRingLog(): Promise<void>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<void>;
  canDrawOverlays(): Promise<boolean>;
  openOverlaySettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  openBatterySettings(): Promise<void>;
  setAnswerUriTemplate(template: string): Promise<void>;
  setDeclineEndpoint(url: string, pushToken: string): Promise<void>;
  takePendingAnswer(): Promise<string | null>;
  startOngoingCall(callId: string, title: string, text: string): Promise<void>;
  stopOngoingCall(): Promise<void>;
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

/** True when this build has the native call screen and popup in it at all. */
export function isCallNotificationAvailable(): boolean {
  return native() !== null;
}

/**
 * Show the incoming-call notification. `answerUri` is a deep link into the app
 * (built with expo-linking, so the scheme is defined in one place); `timeoutMs`
 * should be the call's ring window so Android clears a call nobody answered.
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
    return await mod.showIncomingCall(
      input.callId,
      input.callerName,
      input.businessName,
      input.channelId,
      input.answerUri,
      input.timeoutMs,
    );
  } catch {
    // Never let a notification failure surface as a broken call — but do say so,
    // so the caller can still ring some other way.
    return false;
  }
}

/**
 * Put the full-screen call screen up, exactly as an incoming push would.
 *
 * Resolves to the same sentence the native side writes into the ring log —
 * which route worked, or why neither did. Meant to be shown to the user
 * verbatim in the call-alerts check: this is the one thing they can test
 * without a second phone and a real call.
 */
export async function showCallScreen(input: {
  callId: string;
  callerName: string;
  businessName: string;
  timeoutMs: number;
}): Promise<string | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return await mod.showCallScreen(
      input.callId,
      input.callerName,
      input.businessName,
      input.timeoutMs,
    );
  } catch (err) {
    return err instanceof Error ? err.message : null;
  }
}

/**
 * What happened to the last few call pushes.
 *
 * ⚠️ THIS IS THE ONLY WINDOW INTO THE THING THAT ACTUALLY BREAKS. A call
 * arriving at a closed app runs entirely in Kotlin, with no JS, no console and
 * — when it goes wrong — no notification either, so every failure looks
 * identical from the outside: the phone stays quiet. The native side writes
 * each decision to disk as it happens; this reads it back afterwards.
 *
 * Newest first. Empty on any platform without the module, and empty ALSO means
 * something: if a call was placed and nothing is here, the push never reached
 * the device, which is a completely different problem from failing to draw it.
 */
export async function getRingLog(): Promise<string[]> {
  const mod = native();
  if (!mod) return [];
  try {
    return await mod.getRingLog();
  } catch {
    return [];
  }
}

export async function clearRingLog(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.clearRingLog();
  } catch {
    /* nothing written yet */
  }
}

/**
 * Teach the native side how to deep-link into a call.
 *
 * ⚠️ REQUIRED for answering a call that arrived while the app was closed. The
 * push lands in Kotlin with no JavaScript running, so the Answer button's
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
    /* answering falls back to opening the app's home screen */
  }
}

/**
 * Give the native side what it needs to DECLINE a call server-side.
 *
 * ⚠️ REQUIRED for Decline to mean anything when the app is closed. That button
 * is handled in Kotlin on purpose — refusing a call must not open the app — so
 * it has no session and no Supabase client. `url` is the call-decline function
 * and `pushToken` is this device's push address, which that function accepts as
 * proof of which device is speaking. Without this pair, Decline can only
 * silence the phone and the caller keeps ringing until the call times out.
 *
 * No-ops where the native module isn't present, like everything else here.
 */
export async function setDeclineEndpoint(
  url: string,
  pushToken: string,
): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.setDeclineEndpoint(url, pushToken);
  } catch {
    /* declining falls back to letting the call ring out into the missed log */
  }
}

/**
 * Whether Android will let this app post a full-screen intent — one of the two
 * routes to a call screen.
 *
 * Android 14 turned USE_FULL_SCREEN_INTENT into a per-app switch that is only
 * ON by default for apps Play classifies as calling apps — so for most installs
 * this is FALSE until the user flips it themselves. `null` means the question
 * doesn't apply here (web, Expo Go, or a build without the module).
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
 * user to it is the most any app can do. Same for the two below.
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

/**
 * "Display over other apps" — the OTHER route to a call screen, and the better
 * one: with it the app can launch the call screen directly, so nothing extra is
 * posted to the notification shade. Granted by a completely separate switch
 * from the full-screen one, which is exactly why both are worth having.
 */
export async function canDrawOverlays(): Promise<boolean | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return await mod.canDrawOverlays();
  } catch {
    return null;
  }
}

export async function openOverlaySettings(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.openOverlaySettings();
  } catch {
    /* no such screen on this ROM */
  }
}

/**
 * Whether the phone will still wake Localo for a push.
 *
 * The most under-diagnosed cause of "it never rang": with battery optimisation
 * on — the default — some ROMs delay or drop pushes to an app that hasn't been
 * opened recently, and on the aggressive ones (Xiaomi, Oppo, Vivo, Realme)
 * swiping the app out of Recents counts as a force-stop, after which NOTHING is
 * delivered until it is opened by hand. No code in the app can detect that
 * happening; all it can do is ask to be exempted.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return await mod.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}

export async function openBatterySettings(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.openBatterySettings();
  } catch {
    /* no such screen on this ROM */
  }
}

/**
 * The call the user pressed ANSWER on while the app was closed — read once,
 * then forgotten.
 *
 * ⚠️ This is what makes the green button mean something. Answering used to be
 * expressed ONLY as a deep link into `/call/session/<id>?answer=1`, so picking
 * up depended on that URL surviving a cold start and routing correctly. When it
 * didn't, the app opened on the home screen with the call still ringing and the
 * press looked like it had done nothing. The native side now records the
 * decision itself; this reads it wherever the app happens to land.
 *
 * Returns null on every platform without the module, when nothing is pending,
 * or when the press is older than the ring window (that call is over).
 */
export async function takePendingAnswer(): Promise<string | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return (await mod.takePendingAnswer()) || null;
  } catch {
    return null;
  }
}

/**
 * Go foreground for the duration of a live call.
 *
 * ⚠️ THE CALL DEPENDS ON THIS ONE. Android suspends a backgrounded app's
 * timers and then kills the process outright when it is swiped out of Recents
 * — which used to take the WebRTC session with it, silently, mid-sentence,
 * without ever telling the other side. A foreground service is the only thing
 * that keeps the process alive, and the ongoing notification it must show
 * doubles as the way back into the call.
 *
 * Returns whether Android accepted it. `false` means the call still works but
 * is now only as durable as the screen — worth knowing, never worth an alert.
 */
export async function startOngoingCall(input: {
  callId: string;
  title: string;
  text: string;
}): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    await mod.startOngoingCall(input.callId, input.title, input.text);
    return true;
  } catch {
    // A background start is refused on Android 12+, and the microphone service
    // type on 14+ without the runtime mic permission. Neither is worth breaking
    // a working call over.
    return false;
  }
}

/** Drop back out of the foreground once the call is over. Safe to call twice. */
export async function stopOngoingCall(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.stopOngoingCall();
  } catch {
    /* never started, or already gone */
  }
}

/** Clear the call — answered, declined, cancelled or rang out. */
export async function dismissIncomingCall(callId: string): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.dismiss(callId);
  } catch {
    /* already gone */
  }
}
