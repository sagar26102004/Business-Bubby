/**
 * The public One Place WEBSITE (the Next.js project in `website/`) — every
 * listing has a page there that opens in any browser, no app needed.
 *
 * The app links by id (`/b/<businessId>`): the website redirects that to the
 * business's readable address (`/<business-name>`), so the app never needs to
 * know how slugs are made, and a rename never breaks a link already shared.
 *
 * WHEN THERE'S A DOMAIN: change WEBSITE_URL to it (and set NEXT_PUBLIC_SITE_URL
 * on the website's Vercel project). Links shared before keep working as long as
 * the old *.vercel.app address stays attached to the project.
 */
import { Linking } from 'react-native';
import { shareText, type ShareOutcome } from './share';

export const WEBSITE_URL = 'https://oneplace-website.vercel.app';

/** The business's public web page. */
export function businessWebsiteUrl(businessId: string): string {
  return `${WEBSITE_URL}/b/${businessId}`;
}

/** Share a business's web page through the system share sheet (clipboard on web). */
export function shareBusinessWebsite(business: { id: string; name: string }): Promise<ShareOutcome> {
  const url = businessWebsiteUrl(business.id);
  return shareText(
    `${business.name} — see our menu, prices, photos and reviews: ${url}`,
    business.name,
  );
}

export function openBusinessWebsite(businessId: string): void {
  void Linking.openURL(businessWebsiteUrl(businessId)).catch(() => {});
}
