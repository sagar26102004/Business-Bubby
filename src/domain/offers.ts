/**
 * Offer liveness — the single answer to "should a customer see this offer?"
 *
 * It lives in `domain` rather than beside the rest of the offer maths in
 * features/businesses/offerUtils.ts because the DATA layer needs it too: the ad
 * repositories decide what goes in the Home ad slot, and a paused or expired
 * offer must not get there just because someone paid to promote it. Screens
 * still import it from offerUtils, which re-exports both functions.
 */
import type { Business, Offer } from './types';

/** Switched on and not past its end date. */
export function isOfferLive(offer: Offer, now: number = Date.now()): boolean {
  if (!offer.active) return false;
  if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return false;
  return true;
}

/** The offers a customer should see on the business page, newest first. */
export function liveOffers(business: Pick<Business, 'offers'>, now: number = Date.now()): Offer[] {
  return (business.offers ?? [])
    .filter((o) => isOfferLive(o, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
