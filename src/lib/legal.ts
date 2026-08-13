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
 * The value in the Play Console listing MUST be the same URL as
 * `PRIVACY_POLICY_URL`.
 */
import { Linking } from 'react-native';

/** TODO(sagar): replace with the real hosted URL before the first Play upload. */
export const PRIVACY_POLICY_URL = 'https://example.com/one-place/privacy-policy.html';

/** TODO(sagar): replace with the real hosted URL before the first Play upload. */
export const TERMS_URL = 'https://example.com/one-place/terms-of-service.html';

/** TODO(sagar): replace with the real hosted URL before the first Play upload. */
export const SUPPORT_URL = 'https://example.com/one-place/support.html';

/**
 * Account deletion, on the web.
 *
 * ⚠️ PLAY REQUIRES **BOTH** ROUTES, not either/or: the in-app path
 * (`/delete-account`) and a publicly reachable URL that someone who has already
 * uninstalled the app — or never installed it — can use. This URL is declared
 * in the Play Console under Data safety → Account deletion, and it must be
 * reachable WITHOUT signing in, or the reviewer marks it failed.
 *
 * TODO(sagar): replace with the real hosted URL before the first Play upload.
 */
export const ACCOUNT_DELETION_URL = 'https://example.com/one-place/delete-account.html';

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
