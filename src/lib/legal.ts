/**
 * Where the published legal pages live.
 *
 * ⚠️ ONE PLACE ON PURPOSE. Google Play requires a privacy-policy URL in the
 * store listing AND a reachable link inside the app, and a reviewer following a
 * dead link is a rejection. Every in-app link reads these constants, so when the
 * pages are hosted there is exactly one line to change per page — not a hunt
 * through screens.
 *
 * The pages themselves are written and kept in the repo:
 *   docs/legal/privacy-policy.html
 *   docs/legal/terms-of-service.html
 *   docs/legal/support.html
 *   docs/legal/delete-account.html
 * They are static, self-contained HTML — any static host works (GitHub Pages,
 * Netlify, a folder on a domain). Upload them, then paste the real URLs below.
 *
 * HOSTED ON GITHUB PAGES from this same repo. `.github/workflows/legal-pages.yml`
 * publishes `docs/legal/` as the site root — which is why the URLs below have no
 * `/legal/` segment. Editing any page under `docs/legal/` and pushing to `main`
 * redeploys it in about a minute; the URLs never change.
 *
 * The value in the Play Console listing MUST be the same URL as
 * `PRIVACY_POLICY_URL`.
 */
import { Linking } from 'react-native';

export const PRIVACY_POLICY_URL = 'https://sagar26102004.github.io/Business-Bubby/privacy-policy.html';

export const TERMS_URL = 'https://sagar26102004.github.io/Business-Bubby/terms-of-service.html';

export const SUPPORT_URL = 'https://sagar26102004.github.io/Business-Bubby/support.html';

/**
 * Account deletion, on the web.
 *
 * ⚠️ PLAY REQUIRES **BOTH** ROUTES, not either/or: the in-app path
 * (`/delete-account`) and a publicly reachable URL that someone who has already
 * uninstalled the app — or never installed it — can use. This URL is declared
 * in the Play Console under Data safety → Account deletion, and it must be
 * reachable WITHOUT signing in, or the reviewer marks it failed.
 */
export const ACCOUNT_DELETION_URL = 'https://sagar26102004.github.io/Business-Bubby/delete-account.html';

/**
 * Open a legal page in the system browser.
 *
 * Swallows the failure deliberately: a dead link is a problem to fix in the
 * constants above, not a reason to throw an unhandled rejection out of a
 * `Pressable` and crash the screen the user was reading.
 */
export function openLegalPage(url: string): void {
  void Linking.openURL(url).catch(() => {});
}
