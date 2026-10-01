/**
 * cloudinary-sign — mints a one-time signature so the app can upload ONE file
 * to Cloudinary, under a key it does not get to choose.
 *
 * WHY THIS EXISTS ON THE SERVER
 * Cloudinary offers two upload modes. An "unsigned" preset would let the app
 * post directly with nothing but a public preset name — no server at all — but
 * it also lets anyone who unzips the APK upload into the account and burn the
 * free tier, and it cannot pin a file to the person who sent it. A "signed"
 * upload fixes both, at the cost of needing the API secret — which must never
 * reach a client, because this app IS a client: anything in the bundle is
 * readable by anyone holding the APK. So the secret lives here, as a function
 * secret, and the app only ever receives a signature it cannot reuse.
 *
 * WHAT IT GUARANTEES
 * The `public_id` — Cloudinary's name for the stored object — is built HERE,
 * from the caller's verified uid, and the request body has no say in it. That is
 * what carries migration 0015's one guarantee across to a backend with no RLS:
 * a user can only ever write under their own folder. It is in fact stronger
 * than the RLS version, because the client cannot even name a key to attempt.
 *
 * The signature covers `public_id`, `timestamp` and `upload_preset`. Cloudinary
 * excludes `file`, `cloud_name`, `resource_type` and `api_key` from the signed
 * set, so those four are deliberately absent from the string we sign.
 *
 * The PRESET is where the server-side limits live — allowed formats, a maximum
 * file size, and an incoming transformation that caps stored dimensions. Those
 * are what replace the guarantees migration 0015 got from the bucket itself
 * (`allowed_mime_types`, `file_size_limit`), and unlike the byte count in the
 * request body they cannot be talked past by a modified client. Signing the
 * preset name is what stops a caller swapping it for a laxer one.
 *
 * NO PATH B TWIN
 * Identity is Supabase on BOTH backends — `src/data/api/auth.ts` delegates to
 * `createSupabaseAuth()`, so an `EXPO_PUBLIC_BACKEND=api` session still holds a
 * real Supabase JWT and can invoke this function unchanged. There is no
 * Node/Express equivalent to write and no `backend/SYNC_QUEUE.md` entry to add.
 * Please don't "fix" that omission.
 *
 * Deploy:  supabase functions deploy cloudinary-sign
 *          (DEFAULT jwt verification — not --no-verify-jwt. `call-decline` is
 *          the one function here that opts out, because it is called from an
 *          Android broadcast receiver with no session. This one always has one.)
 * Secrets: supabase secrets set CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... \
 *            CLOUDINARY_API_SECRET=... CLOUDINARY_UPLOAD_PRESET=localo_media
 *          SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * ⚠️ WITHOUT THESE, UPLOADING FROM THE WEB PREVIEW FAILS WITH A LIE.
 *
 * `supabase.functions.invoke` sends Authorization/apikey/content-type, which
 * makes the browser send a CORS PREFLIGHT (an OPTIONS request) first. A
 * function that neither answers OPTIONS nor returns these headers fails that
 * preflight, so the real POST is never sent — and supabase-js reports it as the
 * generic "Failed to send a request to the Edge Function", which reads exactly
 * like the function being down or undeployed. React Native does not enforce
 * CORS, so it would break the web only. This has already cost a debugging
 * session twice in this repo (`call-ring`, then `delete-account`).
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

/**
 * Size ceilings, by kind — Cloudinary's own free-plan caps.
 *
 * Images are capped at 10 MB and videos at 100 MB on the free plan, and a file
 * over the line comes back as an opaque 400 from the upload endpoint. Refusing
 * it here instead means the person gets a sentence they can act on. We hold
 * video at 50 MB rather than Cloudinary's 100 because that is the number
 * migration 0015 put on the bucket, so the Supabase fallback and this path
 * accept the same files — a fallback that accepts a different set isn't one.
 *
 * This is a DECLARED size and a modified client can lie about it. The preset's
 * own max-file-size is the wall that actually holds; this is the error message.
 */
const MAX_BYTES: Record<'image' | 'video', number> = {
  image: 10485760,
  video: 52428800,
};

/**
 * Extensions we will mint a key for — 0015's `allowed_mime_types`, as
 * extensions. Anything else is refused BEFORE a signature exists, so an
 * unexpected type never gets a way into the account at all.
 */
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'mp4', 'mov', 'webm'];

/**
 * What a STORED image is capped at, applied by Cloudinary on the way in.
 *
 * `c_limit` only ever shrinks, so a small logo is never blown up, and 1600px
 * keeps us under the free plan's 25 MP processing limit no matter what a
 * flagship phone camera produces. This protects the STORAGE half of the budget;
 * `media.ts` handles the delivery half.
 *
 * ⚠️ WHY THIS LIVES HERE AND NOT ON THE UPLOAD PRESET. The preset is shared by
 * image and video uploads, and an incoming transformation set there would apply
 * to BOTH — which means every uploaded reel would be transcoded, and Cloudinary
 * bills video transcoding per second of footage. That single setting would cost
 * more than everything else in this file put together. Signing it per request,
 * for images only, is what keeps video genuinely untouched.
 *
 * It is part of the signature, so a client cannot drop or widen it.
 */
const IMAGE_INCOMING_TRANSFORM = 'c_limit,w_1600,h_1600,q_auto:good';

/**
 * Cloudinary's upload signature.
 *
 * Every field sent in the POST except `file`, `cloud_name`, `resource_type` and
 * `api_key` goes in; sort by name; join `name=value` with `&`; append the API
 * secret with NO separator; SHA-1; hex.
 *
 * VERIFIED AGAINST CLOUDINARY'S DOCUMENTED VECTORS — keep these, because a
 * mismatch produces one opaque 401 "Invalid Signature" with no indication which
 * part is wrong, and a trailing `&`, an unsorted key or a signed `api_key` all
 * fail identically:
 *
 *   {public_id: 'sample_image', timestamp: 1315060510}, secret 'abcd'
 *     → string: public_id=sample_image&timestamp=1315060510abcd
 *     → sha1:   b4ad47fb4e25c7bf5f92a20089f9db59bc302313
 *
 *   {timestamp: 1315060510}, secret 'abcd'
 *     → sha1:   a21ad0f63beb4de2e5575204b79ab90bffb02c10
 */
async function sign(params: Record<string, string>, apiSecret: string): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign + apiSecret));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface Body {
  kind?: 'image' | 'video';
  ext?: string;
  bytes?: number;
}

Deno.serve(async (req: Request) => {
  // Answered before anything else — a preflight carries no body and no auth,
  // so every check below would reject it.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
    const preset = Deno.env.get('CLOUDINARY_UPLOAD_PRESET') ?? 'localo_media';
    // Named explicitly, because "which secret did I forget" is otherwise a 500
    // with no clue in it, and the app surfaces this string to the person.
    const missing = [
      !cloudName && 'CLOUDINARY_CLOUD_NAME',
      !apiKey && 'CLOUDINARY_API_KEY',
      !apiSecret && 'CLOUDINARY_API_SECRET',
    ].filter(Boolean);
    if (missing.length > 0) {
      return json({ error: `Media storage is not configured: missing ${missing.join(', ')}.` }, 500);
    }

    // Identity: verified against the caller's own JWT. There is deliberately no
    // uid in the request body to compare it against.
    const asCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await asCaller.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    // A guest cannot own a listing, an offer or a profile photo, so there is
    // nothing for them to attach an upload to — while anonymous sign-in being
    // open would otherwise make this an unauthenticated write primitive against
    // the storage bill. (CLAUDE.md long claimed `uploadMedia` already refused
    // guests. It did not: an anonymous user HAS an id, so the `!userId` check
    // waved them through and the bucket's `to authenticated` policy accepted
    // them. This is where that claim becomes true.)
    if (user.is_anonymous) {
      return json({ error: 'Sign in to upload a photo or video.' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const ext = (body.ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ALLOWED_EXT.includes(ext)) {
      return json({ error: `Cannot upload a .${ext || '?'} file.` }, 400);
    }

    const resourceType = body.kind === 'video' ? 'video' : 'image';
    const limit = MAX_BYTES[resourceType];
    if (typeof body.bytes === 'number' && body.bytes > limit) {
      const mb = Math.round(body.bytes / 1024 / 1024);
      const cap = Math.round(limit / 1024 / 1024);
      return json({ error: `That file is ${mb} MB. Keep it under ${cap} MB.` }, 413);
    }

    // THE KEY. Built here, from the verified uid, and the body has no say — see
    // the header. The shape is identical to what upload.ts used for Supabase
    // Storage, which is what keeps the account-deletion sweep's `<uid>/...`
    // prefix match working against either backend.
    const publicId = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    // The SERVER's clock, deliberately. Cloudinary refuses a stale timestamp, so
    // signing with a phone's clock would make a device whose time is wrong
    // unable to upload at all, with nothing on screen to explain why.
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Images are capped on the way in; video is sent through untouched. Every
    // param here is signed, and the client must send back exactly this set —
    // one extra or one missing and Cloudinary refuses with a bare 401.
    const signedParams: Record<string, string> = {
      public_id: publicId,
      timestamp,
      upload_preset: preset,
    };
    if (resourceType === 'image') signedParams.transformation = IMAGE_INCOMING_TRANSFORM;

    const signature = await sign(signedParams, apiSecret!);

    return json({
      cloudName,
      apiKey,
      timestamp,
      signature,
      publicId,
      uploadPreset: preset,
      transformation: signedParams.transformation,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not sign the upload' }, 500);
  }
});
