/**
 * Offer liveness — COPIED from `src/domain/offers.ts` in the app, so the
 * website and the app agree on which offers a customer may see.
 *
 * Expiry is checked when a page is (re)built, so an offer can linger up to the
 * cache window after it ends — acceptable for a showcase; the app is the source
 * of truth when someone claims it.
 */
import type { Business, Offer } from './types';

/** Switched on and not past its end date. */
export function isOfferLive(offer: Offer, now: number = Date.now()): boolean {
  if (!offer.active) return false;
  if (offer.startsAt && new Date(offer.startsAt).getTime() > now) return false;
  if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return false;
  return true;
}

/** The offers a customer should see on the business page, newest first. */
export function liveOffers(business: Pick<Business, 'offers'>, now: number = Date.now()): Offer[] {
  return (Array.isArray(business.offers) ? business.offers : [])
    .filter((o) => isOfferLive(o, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** "Ends 12 Oct" — in India time, since that's where every listing is. */
export function endsLabel(endsAt: string): string {
  const d = new Date(endsAt);
  return `Ends ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`;
}
