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
 * It lands in the public `media` bucket (supabase/migrations/0015_media_bucket)
 * under `<uploader id>/<timestamp>-<rand>.<ext>` — the folder is what the
 * bucket's RLS pins writes to, so one user can never overwrite another's
 * creative.
 *
 * WITHOUT SUPABASE (the mock backend, or an unconfigured .env) there is nowhere
 * to put a file, so the local uri comes straight back and behaviour is exactly
 * what it was before. That's the point: callers never branch on the backend.
 */
import { isSupabaseConfigured, supabase } from './supabase';

/** Where the file is going. Only affects the fallback content type. */
export type MediaKind = 'image' | 'video';

export interface UploadOptions {
  kind?: MediaKind;
  /** From the picker asset when it knew one, e.g. 'video/mp4'. */
  mimeType?: string;
  /** The picker's filename, used only to recover a sensible extension. */
  fileName?: string;
}

const BUCKET = 'media';

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
 * Upload one picked file and return the URL to store on the domain object.
 *
 * Returns the ORIGINAL uri when there's nowhere to upload to (no Supabase) or
 * when the upload fails — a seller who has just filled in a whole offer should
 * not lose the form because storage was down, and a local uri at least renders
 * for them while they finish. Callers that need to know can pass an `onError`;
 * `uploadMedia` itself never throws.
 */
export async function uploadMedia(
  uri: string,
  opts: UploadOptions = {},
  onError?: (message: string) => void,
): Promise<string> {
  if (!uri || isRemote(uri)) return uri;
  if (!isSupabaseConfigured || !supabase) return uri;

  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    // The bucket only accepts writes into your own folder, so an anonymous
    // caller has no valid path to write to. Keep the local uri rather than
    // firing a request that RLS is certain to refuse.
    if (!userId) return uri;

    // `fetch(uri).arrayBuffer()` is the documented React Native path — it reads
    // file:// on a phone and blob: on web without pulling the bytes through a
    // base64 string, which for a 40 MB video would be a real memory problem.
    const bytes = await fetch(uri).then((res) => res.arrayBuffer());

    const ext = extensionFor(uri, opts);
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: contentTypeFor(uri, opts), upsert: false });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || uri;
  } catch (e) {
    onError?.(e instanceof Error ? e.message : 'Upload failed');
    return uri;
  }
}

/** Upload several files, keeping their order. */
export async function uploadAll(
  uris: string[],
  opts: UploadOptions = {},
  onError?: (message: string) => void,
): Promise<string[]> {
  return Promise.all(uris.map((uri) => uploadMedia(uri, opts, onError)));
}

/**
 * Did this uri survive as a local one? True means the file never left the
 * device, so the UI can say so plainly instead of letting a business believe
 * its ad is live everywhere.
 */
export const isLocalUri = (uri?: string): boolean =>
  !!uri && !isRemote(uri) && (uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:'));
