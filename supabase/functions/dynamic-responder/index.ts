/**
 * LiveKit call-audio token minter — mints a short-lived LiveKit access token so
 * a caller who is a participant on a Localo voice call can connect to that
 * call's REAL audio room.
 *
 * ⚠️ Supabase SLUG is `dynamic-responder` (the live endpoint is
 * /functions/v1/dynamic-responder). The frontend invokes it by that slug
 * (src/data/supabase/calls.ts), so keep this folder named `dynamic-responder`.
 * (The "Deploy: ... livekit-token" line below is a stale comment — ignore it;
 * deploy with `supabase functions deploy dynamic-responder`.)
 *
 * The LiveKit API secret lives ONLY here (as an edge-function secret), never on
 * the client. The frontend (src/data/supabase/calls.ts → getAudioToken) invokes
 * this with the caller's Supabase JWT; we verify the JWT, confirm they're on the
 * call, then sign a token for room `call_<callId>`.
 *
 * Deploy:   supabase functions deploy dynamic-responder
 * Secrets:  supabase secrets set LIVEKIT_URL=wss://<your>.livekit.cloud \
 *                                LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret>
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

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

interface Participant {
  id: string;
  name: string;
  side: 'customer' | 'business';
  state: 'ringing' | 'joined' | 'left' | 'declined';
}
interface CallDoc {
  id: string;
  participants: Participant[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !apiKey || !apiSecret) {
    return json({ error: 'Live audio is not configured (LIVEKIT_* secrets missing).' }, 501);
  }

  // Verify the caller from their Supabase JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'Not signed in.' }, 401);

  let callId: string | undefined;
  try {
    ({ callId } = await req.json());
  } catch {
    /* no body */
  }
  if (!callId) return json({ error: 'callId is required.' }, 400);

  // Read the call with the service role so authz doesn't depend on RLS shape.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: row, error: callErr } = await admin
    .from('calls')
    .select('data')
    .eq('id', callId)
    .maybeSingle();
  if (callErr) return json({ error: callErr.message }, 500);
  const call = row?.data as CallDoc | undefined;
  if (!call) return json({ error: 'Call not found.' }, 404);

  // Authorize: the caller must be a participant on this call.
  const me = call.participants.find((p) => p.id === user.id);
  if (!me) return json({ error: 'You are not part of this call.' }, 403);

  // Mint the token: one room per call, identity = the user id.
  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: me.name,
    ttl: '2h',
  });
  at.addGrant({ room: `call_${callId}`, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  return json({ token, url });
});
