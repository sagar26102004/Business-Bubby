/**
 * The rules of the work showcase — what a business may upload to US, and how a
 * link to what it keeps ELSEWHERE is understood.
 *
 * Every listing shows its work differently: a cafe photographs its FSSAI
 * certificate, a barber his best fades, a wedding designer films a whole
 * function. The first two fit in a few files; the third never will. So the
 * showcase is deliberately two things at once —
 *
 *  1. a HANDFUL of files we host ourselves (MAX_SHOWCASE_PHOTOS +
 *     MAX_SHOWCASE_VIDEOS), because storage is the one thing that scales with
 *     every business that signs up, and
 *  2. LINKS to the gallery the business already keeps — a Drive folder, an
 *     Instagram grid — which cost us nothing and hold as much as they like.
 *
 * Raise the limits here and the editor, the counters and the warnings all move
 * together; nothing else hardcodes them.
 */
import type { PortfolioItem, ShowcaseLinkKind } from './types';

/** Photos we host per listing. */
export const MAX_SHOWCASE_PHOTOS = 3;
/** Videos we host per listing — video is the expensive one. */
export const MAX_SHOWCASE_VIDEOS = 1;
/** And it has to be short: the media bucket's ceiling is 50 MB a file. */
export const MAX_SHOWCASE_VIDEO_SECONDS = 60;

export const countPhotos = (items: PortfolioItem[]): number =>
  items.filter((i) => i.kind === 'photo').length;

export const countVideos = (items: PortfolioItem[]): number =>
  items.filter((i) => i.kind === 'video').length;

/** How each kind of link introduces itself on the business page. */
const LINK_STYLES: Record<ShowcaseLinkKind, { icon: string; label: string }> = {
  drive: { icon: '📁', label: 'Google Drive' },
  photos: { icon: '🖼️', label: 'Google Photos' },
  instagram: { icon: '📸', label: 'Instagram' },
  youtube: { icon: '▶️', label: 'YouTube' },
  facebook: { icon: '👥', label: 'Facebook' },
  pinterest: { icon: '📌', label: 'Pinterest' },
  website: { icon: '🔗', label: 'More work' },
};

export const describeShowcaseLink = (kind: ShowcaseLinkKind) => LINK_STYLES[kind];

/**
 * A pasted link, tidied. People paste "instagram.com/…" as often as the full
 * thing, and a link without a scheme opens nowhere.
 */
export function normalizeLink(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The host, lowercased and without `www.`, or '' when the URL is unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(normalizeLink(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Which service a pasted link points at — the label writes itself from this. */
export function showcaseLinkKind(url: string): ShowcaseLinkKind {
  const host = hostOf(url);
  if (host.startsWith('drive.google.') || host.startsWith('docs.google.')) return 'drive';
  if (host.startsWith('photos.google.') || host === 'photos.app.goo.gl') return 'photos';
  if (host.includes('instagram.')) return 'instagram';
  if (host.includes('youtube.') || host === 'youtu.be') return 'youtube';
  if (host.includes('facebook.') || host === 'fb.watch' || host.includes('fb.me')) return 'facebook';
  if (host.includes('pinterest.') || host === 'pin.it') return 'pinterest';
  return 'website';
}

/** A link is only usable if it parses into a real http(s) address. */
export function isValidLink(url: string): boolean {
  const host = hostOf(url);
  return host.includes('.') && !host.endsWith('.');
}

/**
 * Can this video play INSIDE the app?
 *
 * Uploaded clips are files in our media bucket and play inline. The seeded
 * legacy items point at a YouTube/Vimeo watch page, which is a web page, not a
 * video stream — those still open in the browser instead.
 */
export function isPlayableVideo(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const watchPages = ['youtube.', 'youtu.be', 'vimeo.', 'facebook.', 'instagram.', 'dailymotion.'];
  return !watchPages.some((h) => host.includes(h));
}
