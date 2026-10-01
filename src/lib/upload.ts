/**
 * UPLOADS — turn a picker's local uri into a URL that works on other phones.
 *
 * `expo-image-picker` hands back a uri that only exists on the device that
 * picked it: `file://…` on a phone, `blob:…` on web. Storing that string on a
 * domain object (which is what the app did before this file existed) means the
 * photo renders for the session and for nobody else, ever. For a stall photo
 * that was a known, tolerable gap. For an ad reel it is not: a business films a
 * video, pays to promote it, and every phone but its own shows a blank card.
 *
 * So every picked file goes through `uploadMedia` on its way to a repository.
 *
 * WHERE IT GOES: CLOUDINARY
 * Uploads land in Cloudinary, via the `cloudinary-sign` edge function (which
 * holds the API secret and names the key, so the app can neither read the secret
 * nor choose where a file lands). Cloudinary, rather than the Supabase `media`
 * bucket it used to use, for one reason: the free Supabase plan gives 1 GB of
 * storage and 5 GB of egress a MONTH, and a browse grid pulling twenty
 * full-resolution photos spends that in roughly 1,750 screen views. Cloudinary
 * resizes and re-encodes on delivery (see media.ts), so a 150 px tile costs
 * 150 px worth of bytes.
 *
 * The old path is still here, as `uploadToSupabaseStorage`, reachable by setting
 * EXPO_PUBLIC_MEDIA_BACKEND=supabase. It is kept as LIVE CODE rather than
 * commented out on purpose: `npx tsc --noEmit` is this repo's main gate and it
 * does not look inside comments, so a commented-out fallback is quietly stale by
 * the time you need it. A fallback that doesn't compile isn't a fallback.
 *
 * READS ARE UNAFFECTED EITHER WAY. A stored URL is absolute, so everything
 * uploaded before the move keeps loading from Supabase Storage forever — which
 * is exactly why the `media` bucket and migration 0015 stay in place.
 *
 * WITHOUT SUPABASE (the mock backend, or an unconfigured .env) there is nowhere
 * to put a file and nobody to sign for it, so the local uri comes straight back
 * and behaviour is exactly what it was before. That's the point: callers never
 * branch on the backend.
 *
 * THIS FILE NEVER THROWS. A seller who has just filled in a whole offer must not
 * lose the form because storage was down, so every failure returns the original
 * uri and reports through `onError`. `isLocalUri` is how the UI tells the
 * difference afterwards — and it must be checked, because a returned local uri
 * looks exactly like a successful upload to anything that just renders it.
 */
import { isSupabaseConfigured, supabase } from './supabase';
import { uploadToCloudinary } from './cloudinary';

/** Where the file is going. Only affects the fallback content type. */
export type MediaKind = 'image' | 'video';

export interface UploadOptions {
  kind?: MediaKind;
  /** From the picker asset when it knew one, e.g. 'video/mp4'. */
  mimeType?: string;
  /** The picker's filename, used only to recover a sensible extension. */
  fileName?: string;
  /**
   * The picker asset's `fileSize`, when it reported one. Lets an over-size file
   * be refused before it is uploaded rather than after. Best-effort: the picker
   * does not always know, and the real ceiling is enforced by the Cloudinary
   * upload preset, which a modified client cannot talk its way past.
   */
  bytes?: number;
}

const BUCKET = 'media';

/**
 * Size ceilings by kind, matching `cloudinary-sign`'s MAX_BYTES exactly — and
 * the Cloudinary upload preset's own max-file-size, which is the only one of the
 * three that a modified client cannot talk past. Change them together.
 *
 * 10 MB for images is Cloudinary's free-plan cap. 50 MB for video is the number
 * migration 0015 put on the `media` bucket, kept so the Cloudinary path and the
 * Supabase fallback accept exactly the same files — a fallback that takes a
 * different set isn't really one.
 *
 * Checked here as well as on the server only so the person gets the sentence
 * without waiting for a round trip they were always going to lose.
 */
export const MAX_UPLOAD_BYTES: Record<MediaKind, number> = {
  image: 10485760,
  video: 52428800,
};

/**
 * WHICH STORAGE NEW UPLOADS GO TO.
 *
 *   unset / anything -> Cloudinary, via the cloudinary-sign edge function.
 *   'supabase'       -> the original path, straight into the public `media`
 *                       bucket. Flip this if Cloudinary is misconfigured, if its
 *                       free tier runs out, or to prove the fallback still works.
 *
 * Read at bundle time like every EXPO_PUBLIC_ var, so changing it needs a dev
 * server restart.
 */
const MEDIA_BACKEND: 'cloudinary' | 'supabase' =
  process.env.EXPO_PUBLIC_MEDIA_BACKEND === 'supabase' ? 'supabase' : 'cloudinary';

/** A uri that is already a real URL has nothing to upload. */
const isRemote = (uri: string): boolean => /^https?:\/\//i.test(uri);

/**
 * Best-effort file extension: the picker's filename first (web blob uris carry
 * no extension at all), then the uri, then the mime subtype, then a default.
 */
function extensionFor(uri: string, opts: UploadOptions): string {
  const fromName = opts.fileName?.split('.').pop();
  if (fromName && fromName.length <= 5 && !fromName.includes('/')) return fromName.toLowerCase();

  const path = uri.split('?')[0];
  const fromUri = path.includes('.') ? path.split('.').pop() : undefined;
  if (fromUri && fromUri.length <= 5) return fromUri.toLowerCase();

  const fromMime = opts.mimeType?.split('/')[1];
  if (fromMime) return fromMime.toLowerCase().replace('quicktime', 'mov');

  return opts.kind === 'video' ? 'mp4' : 'jpg';
}

function contentTypeFor(uri: string, opts: UploadOptions): string {
  if (opts.mimeType) return opts.mimeType;
  const ext = extensionFor(uri, opts);
  if (opts.kind === 'video') return ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

/**
 * THE OLD PATH, kept alive. Straight into the public `media` bucket at
 * `<uid>/<timestamp>-<rand>.<ext>` — the folder is what the bucket's RLS pins
 * writes to, so one user can never overwrite another's file.
 *
 * Note the ArrayBuffer: supabase-js's storage client is documented against it
 * for React Native, where Blob support has historically been unreliable. It is
 * not free — RN base64-encodes an ArrayBuffer body in JS on its way to the
 * native layer, so a 12 MB video costs several copies of itself in heap. That
 * cost is one of the reasons the Cloudinary path streams the file by uri
 * instead, and it is tolerable here precisely because this is now the fallback.
 */
async function uploadToSupabaseStorage(
  uri: string,
  userId: string,
  ext: string,
  contentType: string,
): Promise<string> {
  const bytes = await fetch(uri).then((res) => res.arrayBuffer());
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase!.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;

  const { data } = supabase!.storage.from(BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error('Supabase Storage returned no public URL.');
  return data.publicUrl;
}

/**
 * Upload one picked file and return the URL to store on the domain object.
 *
 * Returns the ORIGINAL uri when there's nowhere to upload to and on every
 * failure; never throws. Callers that need to know pass `onError`, and should
 * ALSO check the result with `isLocalUri` — the two silent cases below are
 * silent on purpose and would otherwise look like success.
 */
export async function uploadMedia(
  uri: string,
  opts: UploadOptions = {},
  onError?: (message: string) => void,
): Promise<string> {
  if (!uri || isRemote(uri)) return uri;

  // No backend configured: the mock. A local uri is the correct, documented
  // behaviour here, so this stays SILENT — an error on every pick would be
  // noise in the one situation where nothing is wrong.
  if (!isSupabaseConfigured || !supabase) return uri;

  try {
    const kind: MediaKind = opts.kind === 'video' ? 'video' : 'image';
    const limit = MAX_UPLOAD_BYTES[kind];
    if (opts.bytes != null && opts.bytes > limit) {
      const mb = Math.round(opts.bytes / 1024 / 1024);
      const cap = Math.round(limit / 1024 / 1024);
      onError?.(
        kind === 'video'
          ? `That video is ${mb} MB. Keep it under ${cap} MB — a shorter clip is the way down.`
          : `That photo is ${mb} MB. Keep it under ${cap} MB.`,
      );
      return uri;
    }

    // Identity. Both storage backends need a real account: Cloudinary because
    // `cloudinary-sign` builds the key from a verified uid, Supabase because the
    // bucket's RLS pins writes to `<auth.uid()>/…`.
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;

    // A GUEST IS NOT A USER HERE. An anonymous Supabase session has a real id
    // and the `authenticated` role, so a bare `!user` check waved guests
    // through and the bucket accepted them — an unauthenticated write primitive
    // against the storage bill, for someone who has no listing to attach a
    // photo to in the first place. Both halves are now refused, and said out
    // loud rather than swallowed.
    if (!user || user.is_anonymous) {
      onError?.('Sign in to upload — for now this is saved on your phone only.');
      return uri;
    }

    const ext = extensionFor(uri, opts);
    const contentType = contentTypeFor(uri, opts);

    if (MEDIA_BACKEND === 'supabase') {
      return await uploadToSupabaseStorage(uri, user.id, ext, contentType);
    }
    return await uploadToCloudinary(uri, { kind, ext, contentType, bytes: opts.bytes });
  } catch (e) {
    onError?.(e instanceof Error ? e.message : 'Upload failed');
    return uri;
  }
}

/** One file in a batch: its uri, plus the options that describe only it. */
export interface UploadItem extends UploadOptions {
  uri: string;
}

/**
 * Upload several files, keeping their order.
 *
 * Options are PER FILE, deliberately. This used to take one `UploadOptions` for
 * the whole array, and both callers passed the FIRST picked asset's `mimeType`
 * and `fileName` — so selecting a .png and a .jpg together stored the second one
 * under the first one's extension and content type. Taking an item per file
 * makes that mistake unexpressible rather than merely fixed.
 */
export async function uploadAll(
  items: UploadItem[],
  onError?: (message: string) => void,
): Promise<string[]> {
  return Promise.all(items.map(({ uri, ...opts }) => uploadMedia(uri, opts, onError)));
}

/**
 * Did this uri survive as a local one? True means the file never left the
 * device, so the UI can say so plainly instead of letting a business believe
 * its ad is live everywhere.
 */
export const isLocalUri = (uri?: string): boolean =>
  !!uri && !isRemote(uri) && (uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:'));
