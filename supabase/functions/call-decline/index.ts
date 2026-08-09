/**
 * call-decline — refuse a ringing call from a phone with no session loaded.
 *
 * WHY THIS EXISTS
 * Pressing Decline on the incoming-call notification is handled in Kotlin
 * (CallActionReceiver), because the whole point of that button is that it does
 * NOT open the app. On a closed app there is no JavaScript, no Supabase client
 * and no signed-in session — so the receiver could only ever silence the phone
 * locally. The call carried on ringing the caller for the full 30-second window
 * and then landed in the missed log, which looks exactly like the callee having
 * ignored it. This endpoint is how that phone tells the server "no".
 *
 * AUTHORIZATION — BY DEVICE, NOT BY USER
 * There is no JWT to verify: the app is dead and its access token, wherever it
 * was cached, may well have expired hours ago. What the device DOES still have
 * is its own Expo push token, saved next to the app by the registrar. That
 * token is the address the call was rung on, so possessing it is exactly the
 * claim being made — "I am the device you rang". It is looked up in
 * `push_tokens` (service role; RLS keeps everyone else from reading other
 * people's) to get the user, and that user must ALREADY be a ringing business
 * participant on this specific call.
 *
 * So the worst anyone can do with a stolen push token is decline a call that is
 * ringing that device right now — which is also what they could do by holding
 * the phone. Nothing here reads or writes anything else.
 *
 * ⚠️ DEPLOY WITHOUT JWT VERIFICATION. A killed app has nothing to sign with:
 *     supabase functions deploy call-decline --no-verify-jwt
 * With the default (verify_jwt on) every decline is rejected at the gateway
 * before this code runs, and the symptom is silent — Decline just goes back to
 * ringing out.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Participant {
  id: string;
  side: 'customer' | 'business';
  state: 'ringing' | 'joined' | 'left' | 'declined';
}

interface Call {
  id: string;
  status: string;
  participants: Participant[];
  endedAt?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  try {
    const { callId, pushToken } = (await req.json()) as {
      callId?: string;
      pushToken?: string;
    };
    if (!callId || !pushToken) {
      return json({ error: 'callId and pushToken are required' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The device's claim to be someone. A token that isn't registered proves
    // nothing, so it gets the same flat refusal as a wrong one.
    const { data: tokenRow } = await admin
      .from('push_tokens')
      .select('user_id')
      .eq('token', pushToken)
      .maybeSingle();
    const userId = tokenRow?.user_id as string | undefined;
    if (!userId) return json({ error: 'Unknown device' }, 403);

    const { data: row, error } = await admin
      .from('calls')
      .select('data')
      .eq('id', callId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: 'Call not found' }, 404);

    const call = row.data as Call;

    // Mirrors `decline` in src/data/supabase/calls.ts — deliberately, so a call
    // refused from the notification is indistinguishable from one refused in
    // the app. Only a participant who is still RINGING may decline: someone who
    // already joined is leaving, not declining, and that is a different verb
    // with different consequences for the call's status.
    const me = call.participants.find((p) => p.id === userId && p.side === 'business');
    if (!me) return json({ error: 'You are not on this call' }, 403);
    if (me.state !== 'ringing') return json({ ok: true, reason: 'already answered or gone' });

    me.state = 'declined';

    // The call itself only ends when NOBODY on the business side is left — a
    // group ring where one person declines must keep ringing the others.
    const anyoneLeft = call.participants.some(
      (p) => p.side === 'business' && (p.state === 'ringing' || p.state === 'joined'),
    );
    if (!anyoneLeft && (call.status === 'ringing' || call.status === 'active')) {
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = new Date().toISOString();
    }

    const { error: saveError } = await admin
      .from('calls')
      .update({ data: call })
      .eq('id', callId);
    if (saveError) return json({ error: saveError.message }, 500);

    return json({ ok: true, status: call.status });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
