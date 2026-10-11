/** Site-wide constants. One place to change a link or a name. */

export const SITE_NAME = 'One Place';
export const SITE_TAGLINE = 'Every local business, in one place.';

export const APP_PACKAGE = 'in.oneplace.app';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`;

/** The app's URL scheme (`scheme` in the app's app.json). */
const APP_SCHEME = 'localo';

/**
 * The legal pages already live on GitHub Pages, and Play Console requires the
 * privacy URL to be byte-identical to `src/lib/legal.ts` in the app — so the
 * website LINKS to them rather than hosting a second copy that could drift.
 */
export const LEGAL = {
  privacy: 'https://sagar26102004.github.io/Business-Bubby/privacy-policy.html',
  terms: 'https://sagar26102004.github.io/Business-Bubby/terms-of-service.html',
  support: 'https://sagar26102004.github.io/Business-Bubby/support.html',
  deleteAccount: 'https://sagar26102004.github.io/Business-Bubby/delete-account.html',
};

/** Public contact address — the same one shown on the Play listing. */
export const CONTACT_EMAIL = 'rathoresagar26@gmail.com';

/**
 * The site's own address, no trailing slash. NEXT_PUBLIC_SITE_URL once there is
 * a domain; until then Vercel's production address; locally, localhost.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}

/**
 * "Open in the app" for one business. On Android Chrome an `intent://` link
 * opens the installed app straight onto the business page, and falls back to
 * the Play Store when it isn't installed. Elsewhere (desktop, iPhone) the Play
 * link is the only useful thing to offer.
 */
export function appIntentUrl(businessId: string): string {
  return (
    `intent://business/${businessId}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
  );
}
