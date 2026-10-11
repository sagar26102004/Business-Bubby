/**
 * Cloudinary delivery widths — COPIED from `src/lib/media.ts` in the app.
 *
 * Every distinct width is a derived asset billed against the same Cloudinary
 * credits the app uses, so the website reuses the app's three widths and never
 * invents a fourth. Non-Cloudinary URLs (old Supabase Storage photos, pasted
 * links) pass through untouched.
 */

export const IMAGE_WIDTH = 1280;
export const CARD_WIDTH = 800;
export const THUMB_WIDTH = 400;

const CLOUDINARY_HOST = 'res.cloudinary.com';
const UPLOAD = '/upload/';

const isCloudinaryUrl = (url?: string): boolean =>
  !!url && url.includes(CLOUDINARY_HOST) && url.includes(UPLOAD);

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

/** The image at one of the three widths. Video is never transformed (billed per second). */
export const sized = (url: string | undefined, width: number): string | undefined =>
  url ? applyTransform(url, `c_limit,w_${width},q_auto,f_auto`) : url;
