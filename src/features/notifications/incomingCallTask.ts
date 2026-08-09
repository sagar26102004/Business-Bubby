/**
 * The background half of "the phone rings while the app is dead".
 *
 * The `call-ring` edge function sends a DATA-ONLY push. Android therefore draws
 * nothing by itself — it wakes this task instead, and we post the system
 * CallStyle popup (round avatar, Answer / Decline pills, holds the screen).
 * That's the whole reason for data-only: a push carrying title/body would make
 * Android render its own plain banner, and we'd be unable to restyle it.
 *
 * Must be registered at MODULE scope (see PushRegistrar's import), because when
 * the app is launched headless for a background notification there is no React
 * tree — only the module graph runs.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as Linking from 'expo-linking';
import { AppState, Platform } from 'react-native';
import { showIncomingCall } from '../../../modules/call-notification';
import { CALL_CATEGORY_ID, CALL_CHANNEL_ID, CALL_RING_MS } from './push';

export const INCOMING_CALL_TASK = 'localo-incoming-call';

/** The fields a call push carries. Everything else in the payload is ignored. */
interface CallPayload {
  callId: string;
  callerName?: string;
  businessName?: string;
  kind?: string;
}

/**
 * Dig `callId` out of the delivered payload.
 *
 * The exact shape of a background notification differs by platform and by how
 * the message was sent — it can arrive as `{data: {...}}`, wrapped in
 * `{notification: {data: {...}}}`, or with the values JSON-encoded as strings.
 * Rather than bet the whole feature on one guess that can only be tested by a
 * 15-minute native build, walk the object and take the first thing that looks
 * like a call.
 */
export function extractCallPayload(input: unknown, depth = 0): CallPayload | null {
  if (!input || depth > 5) return null;

  if (typeof input === 'string') {
    // Payload values survive FCM as strings; a nested JSON blob is common.
    try {
      return extractCallPayload(JSON.parse(input), depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = extractCallPayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.callId === 'string' && obj.callId) {
    return {
      callId: obj.callId,
      callerName: typeof obj.callerName === 'string' ? obj.callerName : undefined,
      businessName: typeof obj.businessName === 'string' ? obj.businessName : undefined,
      kind: typeof obj.kind === 'string' ? obj.kind : undefined,
    };
  }

  for (const value of Object.values(obj)) {
    const found = extractCallPayload(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Deep link that answers the call: the session screen joins on `answer=1`. */
export function answerUrlFor(callId: string): string {
  return Linking.createURL(`/call/session/${callId}`, { queryParams: { answer: '1' } });
}

/**
 * Ring with an ordinary notification, when the system call popup isn't
 * available — an app built before the native module existed, Expo Go, or a
 * device that refused the styled notification.
 *
 * It is NOT as good: a banner rather than a call screen. But it carries the
 * ACCEPT / DECLINE buttons from the registered category, and a ring you can
 * answer beats a beautiful one you never get. Because the push is data-only,
 * without this such a build shows nothing at all.
 */
async function ringWithPlainNotification(payload: CallPayload): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📞 ${payload.callerName || 'Someone'}`,
        body: `Incoming call for ${payload.businessName || 'your business'}`,
        // What attaches the two buttons. Registered on the device at sign-in
        // (see push.ts), so it survives into a headless background launch.
        categoryIdentifier: CALL_CATEGORY_ID,
        // PushRegistrar reads this to answer / open the right call.
        data: { callId: payload.callId, kind: 'incoming_call' },
        sticky: true,
      },
      // A bare `{ channelId }` trigger means "immediately, on this channel" —
      // the channel is what makes it ring for the full window rather than ding.
      trigger: { channelId: CALL_CHANNEL_ID },
    });
  } catch {
    /* out of options — the in-app gate still rings if the app is open */
  }
}

TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data, error }) => {
  if (error || Platform.OS !== 'android') return;
  // The app is on screen, so IncomingCallGate is already showing the call and
  // ringing. A popup over the top of it is just one more thing to dismiss.
  if (AppState.currentState === 'active') return;
  const payload = extractCallPayload(data);
  if (!payload) return;
  const shown = await showIncomingCall({
    callId: payload.callId,
    callerName: payload.callerName || 'Someone',
    businessName: payload.businessName || 'your business',
    channelId: CALL_CHANNEL_ID,
    answerUri: answerUrlFor(payload.callId),
    timeoutMs: CALL_RING_MS,
  });
  if (!shown) await ringWithPlainNotification(payload);
});

/**
 * Ask expo-notifications to route background data messages to the task above.
 * Best-effort: an older build, or a platform without background notification
 * support, simply keeps the previous behaviour.
 */
export async function registerIncomingCallTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.registerTaskAsync(INCOMING_CALL_TASK);
  } catch {
    /* not supported here — the in-app gate still rings when the app is open */
  }
}
