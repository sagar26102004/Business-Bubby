/**
 * call-ring — pushes an incoming-call alert to the people a call is ringing.
 *
 * WHY THIS EXISTS ON THE SERVER
 * The app finds incoming calls by polling, which only runs while the app is
 * open. A business owner who swiped Localo away never learns anyone is calling.
 * A push wakes the phone; this function sends it. It is the DOORBELL only —
 * the call itself still runs over LiveKit, unchanged.
 *
 * WHY IT CAN'T BE DONE FROM THE CLIENT
 * Push tokens are readable only by the user who owns them (RLS on push_tokens,
 * migration 0011), precisely so nobody can enumerate other people's devices.
 * Sending therefore needs the service role, which must never reach a client.
 *
 * AUTHORIZATION
 * The caller's JWT is verified, and they must be the CUSTOMER on the call they
 * are asking us to ring — so this can't be used to push arbitrary alerts at
 * arbitrary people. Recipients come from the call's own participant list, not
 * from the request body.
 *
 * Deploy:  supabase functions deploy call-ring
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
 *          injected by the platform; nothing extra to configure.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/**
 * Must match CALL_CHANNEL_ID in src/features/notifications/push.ts. Versioned
 * because Android freezes a channel's sound at creation — bumping the id there
 * without bumping it here sends every ring to a channel that no longer exists.
 */
const CALL_CHANNEL_ID = 'calls_v2';
/**
 * Must match CALL_CATEGORY_ID — this is what puts Accept/Decline on the
 * notification Android renders by itself, i.e. the fallback for every case
 * where the app's own service doesn't draw the call popup. The category is
 * registered on the device at sign-in (src/features/notifications/push.ts).
 */
const CALL_CATEGORY_ID = 'incoming_call';

interface Participant {
  id: string;
  name: string;
  side: 'customer' | 'business';
  state: 'ringing' | 'joined' | 'left' | 'declined';
}

/**
 * One entry from Expo's /push/send response — the fate of ONE message.
 *
 * `status: 'ok'` means Expo took it, not that a phone showed it; the delivery
 * answer proper is a receipt fetched later (Expo suggests ~15 minutes), which
 * is far too slow to help a call that rings for 30 seconds. The ticket is the
 * only feedback available in time, and it is enough to separate the failures
 * that are permanent (bad credentials, dead token) from a phone that simply
 * didn't react.
 */
interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface Call {
  id: string;
  businessName: string;
  customerId: string;
  customerName: string;
  status: string;
  participants: Participant[];
}

/**
 * ⚠️ WITHOUT THESE, A CALL PLACED FROM A BROWSER NEVER RINGS ANYONE.
 *
 * `supabase.functions.invoke` sends Authorization/apikey/content-type, which
 * makes the browser send a CORS PREFLIGHT (an OPTIONS request) first. A
 * function that neither answers OPTIONS nor returns these headers fails that
 * preflight, so the real POST is never sent at all — and supabase-js surfaces
 * it as the maddeningly generic "Failed to send a request to the Edge
 * Function", which reads exactly like the function being down or undeployed.
 *
 * The failure is invisible from the phone's side: the call still connects
 * (LiveKit's token comes from `dynamic-responder`, which HAS had these headers
 * all along), the callee's app still finds the call by polling if it happens to
 * be open — and the push, the one thing that wakes a CLOSED app, is silently
 * never requested. React Native does not enforce CORS, so this broke web
 * callers only, which is precisely the case that is easiest to test with.
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  // Answered before anything else — a preflight carries no body and no auth,
  // so every check below would reject it.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identity: verified against the caller's own JWT, never trusted from the body.
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await asCaller.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return json({ error: 'Not signed in' }, 401);

    const { callId } = (await req.json()) as { callId?: string };
    if (!callId) return json({ error: 'callId is required' }, 400);

    // Service role from here: it must read OTHER users' push tokens, which RLS
    // deliberately forbids to everyone else.
    const admin = createClient(url, serviceKey);

    const { data: row, error } = await admin
      .from('calls')
      .select('data')
      .eq('id', callId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: 'Call not found' }, 404);

    const call = row.data as Call;
    if (call.customerId !== userId) {
      return json({ error: 'You are not the caller on this call' }, 403);
    }
    if (call.status !== 'ringing') return json({ sent: 0, reason: 'not ringing' });

    const targets = call.participants
      .filter((p) => p.side === 'business' && p.state === 'ringing')
      .map((p) => p.id);
    if (targets.length === 0) return json({ sent: 0, reason: 'nobody to ring' });

    const { data: tokenRows } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', targets);
    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token);
    if (tokens.length === 0) return json({ sent: 0, reason: 'no registered devices' });

    const messages = tokens.map((to) => ({
      to,
      // ⚠️ THE SAFETY NET. These two lines are what Android falls back to
      // rendering if the app's own notification service doesn't handle the
      // message — and combined with `categoryId` below, that fallback still
      // carries Accept and Decline.
      //
      // It was data-only for exactly one build, so that Android would draw
      // nothing and leave the field to the native CallStyle popup. When that
      // popup didn't appear on a closed app, data-only meant there was nothing
      // to fall back to: the phone rang showing an empty notification with no
      // way to answer. A plainer notification that works beats a beautiful one
      // that might not — and this is the one that has been seen ringing a
      // locked phone, with Answer and Decline on it, on real devices.
      title: `📞 ${call.customerName}`,
      body: `Incoming call for ${call.businessName}`,
      sound: 'default',
      // `high` is what lets Android deliver to an app that isn't running.
      priority: 'high',
      channelId: CALL_CHANNEL_ID,
      categoryId: CALL_CATEGORY_ID,
      // A ring is worthless once it's been answered elsewhere or timed out;
      // the app's own ring window is 30s.
      ttl: 30,
      // Everything the popup renders travels here, because the woken app has no
      // session yet and cannot look the call up before it needs to ring.
      data: {
        callId: call.id,
        kind: 'incoming_call',
        callerName: call.customerName,
        businessName: call.businessName,
      },
      // iOS needs this flag to be woken for a content-only push at all. Harmless
      // on Android, and iOS calls aren't wired up yet (no PushKit/CallKit).
      _contentAvailable: true,
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) return json({ error: 'Push service rejected the request', result }, 502);

    // ⚠️ A 200 HERE DOES NOT MEAN ANYONE'S PHONE RANG. Expo answers every
    // /push/send with 200 and a PER-MESSAGE ticket, and a message it could not
    // accept comes back as `{ status: 'error' }` inside that otherwise happy
    // response. Reporting `messages.length` as "sent" — which this used to do —
    // therefore claimed success for the two failures that actually happen:
    //
    //   • InvalidCredentials — no FCM V1 key uploaded for this EAS project, so
    //     Expo has nothing to hand the message to. EVERY Android push fails and
    //     the app cheerfully says it pushed to N devices.
    //   • DeviceNotRegistered — the token belongs to an install that is gone
    //     (reinstall, cleared data, app uninstalled). Permanently silent.
    //
    // Both look exactly like "the phone ignored it" from the caller's side,
    // which is a completely different problem with a completely different fix.
    // So read the tickets and say which it was.
    const tickets: Ticket[] = Array.isArray((result as { data?: unknown })?.data)
      ? ((result as { data: Ticket[] }).data)
      : [];

    // Tickets come back in the order the messages went out, which is the only
    // thing tying a failure back to the token that caused it.
    const failures = tickets
      .map((ticket, i) => ({ ticket, token: tokens[i] }))
      .filter((x) => x.ticket?.status === 'error');

    // A token whose device is gone will never work again — every future call
    // would waste a message and, worse, keep this diagnostic reporting a device
    // that cannot ring. Expo's own guidance is to stop sending to it, so drop
    // the row. ONLY for DeviceNotRegistered: InvalidCredentials is a project
    // misconfiguration, and deleting perfectly good tokens over it would turn a
    // five-minute fix into a re-registration hunt across every phone.
    const dead = failures
      .filter((x) => x.ticket.details?.error === 'DeviceNotRegistered')
      .map((x) => x.token);
    if (dead.length > 0) {
      await admin.from('push_tokens').delete().in('token', dead);
    }

    const accepted = tickets.filter((t) => t?.status === 'ok').length;
    // Distinct messages only: ten phones failing for one reason is one fact.
    const reasons = [...new Set(failures.map((x) => x.ticket.message).filter(Boolean))];

    return json({
      // `sent` now means ACCEPTED BY EXPO, not "handed to fetch".
      sent: accepted,
      attempted: messages.length,
      failed: failures.length,
      // Verbatim from Expo — its messages name the fix ("Unable to retrieve the
      // FCM server key…"), and paraphrasing them would lose exactly that.
      failures: reasons,
      reason:
        accepted === 0 && reasons.length > 0
          ? reasons.join('; ')
          : accepted === 0
            ? 'the push service accepted nothing and gave no reason'
            : undefined,
      result,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
