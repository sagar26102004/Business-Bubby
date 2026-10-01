/**
 * CLOUDINARY — the transport half of an upload.
 *
 * `upload.ts` decides THAT a file should go up and what to do when it doesn't.
 * This file knows HOW to put one in Cloudinary, and nothing else.
 *
 * TWO REQUESTS, AND WHY
 * The API secret cannot ship in the app — this is a client, so anything in the
 * bundle is readable by anyone holding the APK. So uploading is:
 *
 *   1. ask `cloudinary-sign` (edge function, holds the secret) for a signature,
 *      which also names the `public_id` the file must be stored under, and
 *   2. POST the file straight to Cloudinary with that signature attached.
 *
 * The bytes never touch our server. Step 1 is a few hundred bytes; step 2 goes
 * phone → Cloudinary directly, which is both faster and the only shape that
 * doesn't run a 12 MB video through an edge function's memory.
 *
 * The app cannot choose where the file lands: `public_id` comes back from the
 * function, built from the caller's verified uid. See that function's header.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * React Native's FormData is NOT the browser's. It accepts a string or an
 * `{ uri, name, type }` descriptor and nothing else — hand it a Blob and
 * `getParts()` falls through to `String(value)` and uploads the literal text
 * "[object Blob]" with a 200 OK and no hint anything went wrong
 * (`react-native/Libraries/Network/FormData.js`, the `String(value)` branch).
 * So on a phone we pass the picker's `file://` uri and let the native layer
 * stream it off disk — no base64, no ArrayBuffer, nothing in the JS heap. On
 * web, `FormData` IS the browser's, where a Blob is exactly what's wanted and a
 * `{ uri }` object would be stringified instead. Hence the one Platform branch.
 */
import { Platform } from 'react-native';
import { storedUrl } from './media';
import { getSupabase } from './supabase';

/** What `cloudinary-sign` hands back. One signature, good for one file. */
interface Signature {
  cloudName: string;
  apiKey: string;
  timestamp: string;
  signature: string;
  publicId: string;
  uploadPreset: string;
  /** Incoming transformation, images only — absent for video on purpose. */
  transformation?: string;
  uploadUrl: string;
}

export interface CloudinaryUploadInput {
  kind: 'image' | 'video';
  /** Extension for the stored object, e.g. 'jpg'. */
  ext: string;
  /** Mime type for the multipart part, e.g. 'image/jpeg'. */
  contentType: string;
  /** Byte count when the picker knew one. Lets the server refuse early. */
  bytes?: number;
}

/**
 * Pull the JSON body out of a functions-invoke error.
 *
 * supabase-js puts the status text on the error and the SERVER'S message in the
 * untouched response hanging off it, so this is the only way to see what the
 * function actually said — and the difference matters here: "missing
 * CLOUDINARY_API_KEY" and "Sign in to upload" both arrive as the same useless
 * "Edge Function returned a non-2xx status code" otherwise. (Twin of the helper
 * in `src/data/supabase/auth.ts`; copied rather than imported so `lib/` keeps
 * not depending on `data/`.)
 */
async function functionError(error: unknown, fallback: string): Promise<string> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.json !== 'function') {
    return (error as Error)?.message || fallback;
  }
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return (body as { error?: string } | null)?.error || (error as Error)?.message || fallback;
}

/**
 * Upload one file and return the delivery URL to store on the domain object.
 *
 * THROWS on failure, deliberately — `uploadMedia` owns the decision about what
 * a failed upload means for the person's half-filled form, and it needs the
 * message to tell them why.
 */
export async function uploadToCloudinary(
  uri: string,
  { kind, ext, contentType, bytes }: CloudinaryUploadInput,
): Promise<string> {
  const sb = getSupabase();

  // ---- 1. The signature -----------------------------------------------------
  const { data, error } = await sb.functions.invoke('cloudinary-sign', {
    body: { kind, ext, bytes },
  });
  if (error) {
    throw new Error(
      await functionError(
        error,
        'Media storage is not set up yet — the cloudinary-sign function may not be deployed.',
      ),
    );
  }
  const sig = data as Signature | null;
  if (!sig?.uploadUrl || !sig.signature) throw new Error('Media storage returned no signature.');

  // ---- 2. The file ----------------------------------------------------------
  const form = new FormData();
  const name = `${sig.publicId.split('/').pop() ?? 'upload'}.${ext}`;

  if (Platform.OS === 'web') {
    // The browser's FormData: it wants the bytes. `fetch` on a blob: or file:
    // uri is how we get them without a base64 round trip.
    const blob = await fetch(uri).then((r) => r.blob());
    form.append('file', blob, name);
  } else {
    // React Native's FormData: it wants a descriptor, and the native layer
    // streams the file off disk. See the header — a Blob here uploads the
    // string "[object Blob]" and looks like it worked.
    form.append('file', { uri, name, type: contentType } as unknown as Blob);
  }

  form.append('api_key', sig.apiKey);
  form.append('timestamp', sig.timestamp);
  form.append('signature', sig.signature);
  form.append('public_id', sig.publicId);
  // Signed along with the rest, so this cannot be swapped for a laxer preset.
  // It is where the allowed formats and the max file size live.
  form.append('upload_preset', sig.uploadPreset);

  // Present for images, absent for video — the server decides which, and both
  // cases are covered by the signature, so sending the wrong one fails loudly
  // rather than quietly costing money. See the function's own comment: an
  // incoming transformation on a VIDEO means transcoding, billed per second.
  if (sig.transformation) form.append('transformation', sig.transformation);

  // No Content-Type header: both FormData implementations set it themselves,
  // with the multipart boundary. Setting it by hand omits the boundary and the
  // upload is rejected as malformed.
  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const body = (await res.json().catch(() => null)) as
    | { secure_url?: string; error?: { message?: string } }
    | null;

  if (!res.ok || !body?.secure_url) {
    throw new Error(body?.error?.message || `Cloudinary refused the upload (${res.status}).`);
  }

  // Delivery options baked in for images; nothing at all for video, because
  // Cloudinary bills video transformations per second of duration. See the
  // header of media.ts — this one line is the difference between a reel costing
  // nothing and costing 120+ transformations every time it is asked for.
  return storedUrl(body.secure_url, kind);
}
