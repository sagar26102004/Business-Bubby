/**
 * delete-account — closes the caller's account for good.
 *
 * WHY THIS EXISTS ON THE SERVER
 * Google Play refuses any app that lets people create an account but not delete
 * one. Deleting the `auth.users` row needs the Auth ADMIN API, which needs the
 * service role, which must never reach a client — so the whole operation lives
 * here.
 *
 * WHAT IT ACTUALLY DOES
 * Almost nothing itself: the rules are in SQL (migration 0019), where they can
 * be read as one decision table and run in ONE transaction. This function is
 * the doorman — it proves who is asking, refuses when a real business is in the
 * way, and then performs the three steps that cannot be done in SQL:
 *
 *   1. `account_deletion_blockers`  — refuse while a listing with staff or
 *                                     customers is still owned. Cascading it
 *                                     away would delete other people's records
 *                                     (see the long note in 0019).
 *   2. `anonymize_account`          — the scrub, atomically.
 *   3. storage sweep                — remove uploads nothing points at any
 *                                     more. Objects still referenced by a
 *                                     business the person TRANSFERRED on the
 *                                     way out are deliberately left alone.
 *                                     TWO stores, because uploads moved: the
 *                                     Supabase `media` bucket for anything
 *                                     from before the move (3), and Cloudinary
 *                                     for everything since (3b). Postgres
 *                                     cannot see Cloudinary, so without 3b
 *                                     this step quietly reports 0 and a
 *                                     deleted account keeps its photos.
 *   4. `auth.admin.deleteUser`      — LAST, on purpose. If it fails, the person
 *                                     is left with an account they can still
 *                                     sign in to and retry, which is far kinder
 *                                     than a ghost account they cannot.
 *
 * AUTHORIZATION
 * The uid comes from the caller's verified JWT and from nowhere else. There is
 * no "user id" parameter, by design: this endpoint can only ever delete the
 * person holding the token. A platform admin account is refused outright (0019)
 * so the console can never lock itself out.
 *
 * Deploy:  supabase functions deploy delete-account
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
 *          injected by the platform. CLOUDINARY_CLOUD_NAME / _API_KEY /
 *          _API_SECRET are the same three `cloudinary-sign` uses, and step 3b
 *          needs them — without them the Cloudinary sweep does nothing and
 *          silently reports 0 files removed.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * ⚠️ WITHOUT THESE, DELETING FROM THE WEB PREVIEW FAILS WITH A LIE.
 *
 * `supabase.functions.invoke` sends Authorization/apikey/content-type, which
 * makes the browser send a CORS PREFLIGHT (an OPTIONS request) first. A
 * function that neither answers OPTIONS nor returns these headers fails that
 * preflight, so the real POST is never sent — and supabase-js reports it as the
 * generic "Failed to send a request to the Edge Function", which reads exactly
 * like the function being down or undeployed. React Native does not enforce
 * CORS, so it would break the web only. This cost a debugging session once
 * already on `call-ring`; the comment is there in full.
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

/** One listing standing in the way, straight from `account_deletion_blockers`. */
interface Blocker {
  business_id: string;
  business_name: string;
  reasons: string[];
}

/**
 * Remove this user's Cloudinary uploads that nothing points at any more.
 *
 * The Admin API is the only way to see what is actually stored there, and it
 * authenticates with HTTP Basic (`api_key:api_secret`) rather than the signed
 * form the upload endpoint uses — no signature to build.
 *
 * `unreferenced` is injected rather than queried here so the "is anything still
 * pointing at this?" rule lives in ONE place (`media_keys_unreferenced`, 0023)
 * and cannot drift from the Supabase-bucket sweep beside it.
 *
 * Returns how many objects were removed. NEVER THROWS — same reasoning as the
 * sweep it sits next to: a leftover file is a tidiness problem, and failing the
 * deletion over it would leave the person with an account they were told was
 * gone. With the secrets unset it simply does nothing and reports 0.
 */
async function sweepCloudinary(
  userId: string,
  unreferenced: (keys: string[]) => Promise<string[]>,
): Promise<number> {
  const cloud = Deno.env.get('CLOUDINARY_CLOUD_NAME');
  const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
  const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
  if (!cloud || !apiKey || !apiSecret) return 0;

  const auth = `Basic ${btoa(`${apiKey}:${apiSecret}`)}`;
  const base = `https://api.cloudinary.com/v1_1/${cloud}/resources`;
  let removed = 0;

  // Images and videos are separate resource types with separate endpoints, and
  // a failure on one must not stop the other — hence a try per type.
  for (const type of ['image', 'video'] as const) {
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const url = new URL(`${base}/${type}/upload`);
        // The prefix IS the guarantee: `cloudinary-sign` builds every public_id
        // as `<uid>/…`, so this can only ever see this user's own uploads.
        url.searchParams.set('prefix', `${userId}/`);
        url.searchParams.set('max_results', '500');
        if (cursor) url.searchParams.set('next_cursor', cursor);

        const res = await fetch(url, { headers: { Authorization: auth } });
        if (!res.ok) break;
        const body = (await res.json()) as {
          resources?: { public_id?: string }[];
          next_cursor?: string;
        };
        for (const r of body.resources ?? []) if (r.public_id) ids.push(r.public_id);
        cursor = body.next_cursor;
      } while (cursor);

      if (ids.length === 0) continue;
      const orphans = await unreferenced(ids);

      // 100 public_ids per call is the Admin API's limit.
      for (let i = 0; i < orphans.length; i += 100) {
        const batch = orphans.slice(i, i + 100);
        const form = new URLSearchParams();
        for (const id of batch) form.append('public_ids[]', id);
        const res = await fetch(`${base}/${type}/upload`, {
          method: 'DELETE',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        if (res.ok) removed += batch.length;
      }
    } catch {
      // Swallowed, for the reason in the header.
    }
  }

  return removed;
}

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

    // Identity: verified against the caller's own JWT. There is deliberately no
    // uid in the request body to compare it against.
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await asCaller.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    // A guest session has no profile, no data and no username to free. Signing
    // out is the whole of "deleting" it, and the app does that locally.
    if (user.is_anonymous) {
      return json({ error: 'A guest session has no account to delete. Just sign out.' }, 400);
    }

    const admin = createClient(url, serviceKey);

    // ---- 1. Is a real business in the way? ---------------------------------
    const { data: blockerRows, error: blockerError } = await admin.rpc(
      'account_deletion_blockers',
      { p_user: user.id },
    );
    if (blockerError) return json({ error: blockerError.message }, 500);

    const blockers = (blockerRows ?? []) as Blocker[];
    if (blockers.length > 0) {
      // 409, not 403: nothing is wrong with the request — the account simply
      // isn't in a deletable state yet, and the app can say precisely why.
      return json(
        {
          error: 'blocked',
          blockers: blockers.map((b) => ({
            businessId: b.business_id,
            name: b.business_name,
            reasons: b.reasons ?? [],
          })),
        },
        409,
      );
    }

    // ---- 2. The scrub ------------------------------------------------------
    const { data: summary, error: scrubError } = await admin.rpc('anonymize_account', {
      p_user: user.id,
    });
    if (scrubError) {
      // 0019 raises 42501 for the two refusals it enforces itself (platform
      // admin, or a blocker that appeared between the check above and the lock).
      const denied = scrubError.code === '42501';
      return json({ error: scrubError.message }, denied ? 403 : 500);
    }
    const listingsRemoved = Number((summary as { listingsRemoved?: number })?.listingsRemoved ?? 0);

    // ---- 3. Uploads nothing points at any more -----------------------------
    // Best-effort on purpose: a leftover image in a storage bucket is a tidiness
    // problem, and failing the deletion over it would leave the person with an
    // account they were promised was gone.
    let mediaRemoved = 0;
    try {
      const { data: paths } = await admin.rpc('unreferenced_media_paths', { p_user: user.id });
      // The RPC returns a set of text, which PostgREST hands back either as bare
      // strings or as single-key rows depending on the client version.
      const names = ((paths ?? []) as (string | { unreferenced_media_paths: string })[])
        .map((p) => (typeof p === 'string' ? p : p?.unreferenced_media_paths))
        .filter((p): p is string => !!p);
      if (names.length > 0) {
        // Through the storage API, not by deleting rows from `storage.objects`:
        // the row is only the index, and dropping it would strand the actual
        // file in the bucket forever.
        const { error: removeError } = await admin.storage.from('media').remove(names);
        if (!removeError) mediaRemoved = names.length;
      }
    } catch {
      // Swallowed for the reason above.
    }

    // ---- 3b. The same sweep, in Cloudinary ---------------------------------
    // Uploads land in Cloudinary now (src/lib/upload.ts), and Postgres cannot
    // see them — `unreferenced_media_paths` above reads `storage.objects`, so
    // on its own it reports "0 removed" and a deleted account's photos live on
    // forever. Step 3 still runs because files uploaded BEFORE the move are
    // genuinely in the bucket; this is its twin for everything since.
    //
    // Same rule, same reason: list what is under this user's prefix, then keep
    // anything a surviving document still points at — a business they
    // TRANSFERRED on the way out owns photos they uploaded. Hence
    // `media_keys_unreferenced` (0023) rather than Cloudinary's
    // `delete_resources_by_prefix`, which is the blanket wipe 0019 argues
    // against.
    //
    // Best-effort, exactly like step 3.
    mediaRemoved += await sweepCloudinary(user.id, async (keys) => {
      const { data } = await admin.rpc('media_keys_unreferenced', { p_keys: keys });
      return ((data ?? []) as (string | { media_keys_unreferenced: string })[])
        .map((k) => (typeof k === 'string' ? k : k?.media_keys_unreferenced))
        .filter((k): k is string => !!k);
    });

    // ---- 4. The account itself, last ---------------------------------------
    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) {
      // The data is already anonymised at this point, so the account is empty —
      // but it can still sign in, which is the recoverable half of the failure.
      // Say that plainly instead of reporting a success that didn't happen.
      return json(
        {
          error:
            'Your data was removed, but the sign-in itself could not be closed. ' +
            'Please try again — nothing is lost by repeating this.',
          detail: authError.message,
        },
        500,
      );
    }

    return json({ deleted: true, listingsRemoved, mediaRemoved });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
