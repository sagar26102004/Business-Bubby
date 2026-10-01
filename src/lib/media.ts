/**
 * MEDIA URLS — asking the storage CDN for the size we are actually going to draw.
 *
 * `upload.ts` is about getting bytes INTO storage. This file is about getting
 * the right number of them back OUT, which is a separate problem and the one
 * that actually costs money.
 *
 * THE PROBLEM THIS SOLVES
 * A seller photographs a dish on a 12 MP phone. We draw it in a 150 px tile in
 * a grid of twelve. Before this file existed we fetched all twelve at full
 * resolution — roughly 40 MB of transfer to paint about 0.3 MB of pixels — and
 * bandwidth, not storage, is the limit that bites first on a free plan.
 *
 * Cloudinary can resize and re-encode on the way out, addressed purely by URL:
 *
 *   .../upload/c_limit,w_1280,q_auto,f_auto/v1699.../<uid>/<ts>-<rand>.jpg
 *              └── never upscale, cap at 1280, pick a quality, pick a format
 *
 * `storedUrl` bakes that in at upload time, so all ~20 render sites get a
 * sensible size with no code change, and `thumbUrl` narrows it further at the
 * handful of places that draw a small tile.
 *
 * WIDTH IN THE DATABASE IS A DEFAULT, NOT A COMMITMENT. `thumbUrl` rewrites the
 * transformation segment at render time, so changing a width later is a one-line
 * change here that applies to every existing row with no data migration. That is
 * the whole reason the helpers rewrite rather than parse.
 *
 * THREE WIDTHS, AND NOT FOUR. Every distinct variant is a derived asset that
 * consumes BOTH a transformation and storage against the plan's credits, so the
 * widths are named by ROLE and reused — never chosen per component:
 *
 *   THUMB_WIDTH  small tiles, avatars, editor strips, catalog rows
 *   CARD_WIDTH   a photo that fills the width of a card, where a thumb is soft
 *   IMAGE_WIDTH  baked into the stored URL; what a detail screen gets
 *
 * Adding a fourth because one tile looked slightly better is a real cost. If a
 * component doesn't fit one of the three roles, it almost certainly fits one of
 * them badly enough to live with.
 *
 * ⚠️ VIDEO GETS NO TRANSFORMATION AT ALL. Cloudinary bills video
 * transformations PER SECOND OF DURATION (derived SD h264 is roughly 2
 * transformations a second), so a single 60-second reel would cost 120+
 * transformations for every variant it is asked for. One `q_auto` on the deals
 * feed would be the most expensive line in this codebase. Video is stored and
 * served as the untransformed original; its size is controlled by the duration
 * caps in `domain/showcase.ts` and `features/media/VideoField.tsx`, and nowhere
 * else.
 *
 * ⚠️ `f_auto` IS A BROWSER FEATURE. It resolves per request from the `Accept`
 * header, so it genuinely serves WebP/AVIF on web — and on React Native, where
 * the image loader sends no meaningful `Accept`, Cloudinary falls back to the
 * original format. It is free upside on web and a harmless no-op on Android, so
 * it stays; just don't count on it, and don't be tempted to hardcode `f_webp` to
 * force the issue. One stored URL is shared by web, Android and any future iOS
 * build, and iOS cannot decode WebP through RN's `Image`. The parts that work
 * everywhere are `q_auto` and `w_`, because those are encoder decisions rather
 * than content negotiation.
 *
 * EVERYTHING ELSE PASSES THROUGH UNTOUCHED. Photos uploaded before the move to
 * Cloudinary still live in Supabase Storage, the seeded dish photos point at
 * other hosts, and a business can paste its own Instagram or Drive link. None of
 * those can be resized, so the helpers return them exactly as given rather than
 * building a URL that 404s. Callers never have to ask which kind they hold.
 */
import type { MediaKind } from './upload';

/** The one detail width baked into every stored image URL. */
export const IMAGE_WIDTH = 1280;

/** The ONE thumbnail width, reused at every grid, tile and avatar site. */
export const THUMB_WIDTH = 400;

/**
 * A photo that fills a card's whole width — a browse-list cover, say. Wide
 * enough to stay crisp at 2× on a phone, where a 400 px thumb stretched across
 * the card is visibly soft, and still a fifth of the bytes of the stored 1280.
 * Only for full-bleed covers; a small tile uses THUMB_WIDTH.
 */
export const CARD_WIDTH = 800;

/** The host Cloudinary serves delivery URLs from. */
const CLOUDINARY_HOST = 'res.cloudinary.com';

/** The marker that separates the delivery options from the asset's own path. */
const UPLOAD = '/upload/';

/** Can this URL carry transformations? Only our own Cloudinary assets can. */
export const isCloudinaryUrl = (url?: string): boolean =>
  !!url && url.includes(CLOUDINARY_HOST) && url.includes(UPLOAD);

/**
 * Put `transform` in the delivery slot, replacing whatever is already there.
 *
 * After `/upload/` a Cloudinary URL is `[transform/][v<digits>/]<public id>`.
 * The transformation segment is optional, which is why this has to recognise it
 * rather than count slashes: a version (`v1699123456`) and the public id's own
 * first segment must both survive. Our public ids start with a uuid, which
 * contains no `_` or `,`, so it can never be mistaken for a transformation.
 */
function applyTransform(url: string, transform: string): string {
  if (!isCloudinaryUrl(url)) return url;

  const at = url.indexOf(UPLOAD) + UPLOAD.length;
  const head = url.slice(0, at);
  let rest = url.slice(at);

  const first = rest.split('/')[0];
  const isVersion = /^v\d+$/.test(first);
  const looksLikeTransform = /[,_]/.test(first);
  if (first && !isVersion && looksLikeTransform && rest.includes('/')) {
    rest = rest.slice(first.length + 1);
  }

  return `${head}${transform}/${rest}`;
}

/**
 * Turn Cloudinary's `secure_url` — the untransformed original — into the URL we
 * store on the domain object.
 *
 * Images get `c_limit` (shrink only, never upscale, so a small logo stays
 * crisp), a width cap, and automatic quality/format. **Video gets nothing**, for
 * the per-second billing reason in the header.
 */
export const storedUrl = (secureUrl: string, kind: MediaKind): string =>
  kind === 'video'
    ? secureUrl
    : applyTransform(secureUrl, `c_limit,w_${IMAGE_WIDTH},q_auto,f_auto`);

/**
 * The same image, narrowed to `width` — for anywhere we draw a small tile.
 * Returns non-Cloudinary URLs unchanged, so it is safe to wrap any uri with no
 * conditional at the call site.
 */
export const thumbUrl = (url?: string, width: number = THUMB_WIDTH): string | undefined =>
  url ? applyTransform(url, `c_limit,w_${width},q_auto,f_auto`) : url;
