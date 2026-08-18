/**
 * Offer liveness — mirror of ../../../src/domain/offers.ts.
 *
 * The ad service needs it: a paused or expired offer must not reach the Home
 * slot just because someone paid to promote it.
 */
import type { Offer } from '@/domain/types';

/** Switched on and not past its end date. */
export function isOfferLive(offer: Offer, now: number = Date.now()): boolean {
  if (!offer.active) return false;
  if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return false;
  return true;
}
