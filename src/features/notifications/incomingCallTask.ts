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
import { Platform } from 'react-native';
import { showIncomingCall } from '../../../modules/call-notification';
import { CALL_CHANNEL_ID, CALL_RING_MS } from './push';

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

TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data, error }) => {
  if (error || Platform.OS !== 'android') return;
  const payload = extractCallPayload(data);
  if (!payload) return;
  await showIncomingCall({
    callId: payload.callId,
    callerName: payload.callerName || 'Someone',
    businessName: payload.businessName || 'your business',
    channelId: CALL_CHANNEL_ID,
    answerUri: answerUrlFor(payload.callId),
    timeoutMs: CALL_RING_MS,
  });
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
