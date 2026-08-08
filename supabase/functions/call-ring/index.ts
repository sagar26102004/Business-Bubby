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
/** Must match CALL_CATEGORY_ID — this is what puts Accept/Decline on the popup. */
const CALL_CATEGORY_ID = 'incoming_call';

interface Participant {
  id: string;
  name: string;
  side: 'customer' | 'business';
  state: 'ringing' | 'joined' | 'left' | 'declined';
}

interface Call {
  id: string;
  businessName: string;
  customerId: string;
  customerName: string;
  status: string;
  participants: Participant[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
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
      // ⚠️ DELIBERATELY NO title/body — this is a DATA-ONLY message.
      //
      // A push carrying title/body makes Android render its own plain banner,
      // which cannot be restyled: no avatar, no coloured Answer/Decline pills,
      // and it collapses after a few seconds. Sending data only means Android
      // draws nothing and instead wakes the app's background task, which posts
      // the real system CallStyle popup (see src/features/notifications/
      // incomingCallTask.ts). Adding a title here silently reverts the feature.
      //
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

    return json({ sent: messages.length, result });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
