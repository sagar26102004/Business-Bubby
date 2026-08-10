/**
 * "What ads does a person standing HERE see?" — asked once, answered once.
 *
 * This sits in `data/` rather than in either backend because both of them need
 * the identical rule, and it can't live in `domain/` (it speaks `AdPlacement`,
 * which is part of the repository contract). The Home screen deliberately does
 * NOT own this: deciding reach needs the campaign, the business's location and
 * the offer's live state together, and a screen that knew all three would end
 * up being the place the rule quietly drifts.
 *
 * The ordering IS the business model (see domain/ads.ts):
 *   1. Sponsored placements — a running, approved campaign, within the radius
 *      that was bought. This is what the money buys.
 *   2. Free placements — any live offer from a business inside FREE_REACH_KM,
 *      widened toward COLD_START_REACH_KM only while the slot is too thin to
 *      be worth showing. A shop has to see the slot working before it will pay
 *      for it, and an empty carousel proves nothing.
 * Nearest first inside each band.
 */
import type { AdCampaign, Business, GeoPoint } from '@/domain/types';
import { COLD_START_REACH_KM, FREE_REACH_KM, MIN_SLOT_CARDS } from '@/domain/ads';
import { isOfferLive } from '@/domain/offers';
import { haversineKm } from '@/lib/geo';
import type { AdPlacement } from './repositories';

export function buildPlacements(
  /** Campaigns already filtered to the ones actually running. */
  running: AdCampaign[],
  businesses: Business[],
  near: GeoPoint | undefined,
  now: number,
): AdPlacement[] {
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const distanceTo = (b: Business): number | undefined =>
    near && b.location?.point ? haversineKm(near, b.location.point) : undefined;

  const sponsored: AdPlacement[] = [];
  const promoted = new Set<string>();

  for (const campaign of running) {
    const business = byId.get(campaign.businessId);
    if (!business) continue;
    const offer = (business.offers ?? []).find((o) => o.id === campaign.offerId);
    // A campaign points at its creative rather than copying it, so pausing or
    // deleting the offer takes the ad down with it. That's the trade for never
    // having a stale duplicate of the offer running as an ad.
    if (!offer || !isOfferLive(offer, now)) continue;

    const distanceKm = distanceTo(business);
    // Reach is what was paid for. An UNKNOWN distance (no viewer location, or a
    // business that never pinned itself) still shows: the slot was bought, and
    // silently dropping it is the worse failure of the two.
    if (distanceKm !== undefined && distanceKm > campaign.radiusKm) continue;

    promoted.add(`${business.id}:${offer.id}`);
    sponsored.push({ business, offer, campaign, distanceKm });
  }

  // Every unpaid offer that COULD show, with how far away it is. Which of them
  // actually show is a distance cut applied below, once we know how thin the
  // slot is.
  const candidates: AdPlacement[] = [];
  // Without a viewer location there's no way to judge closeness, and showing an
  // unpaid corner shop to someone in another city is worse than an empty slot.
  if (near) {
    for (const business of businesses) {
      const distanceKm = distanceTo(business);
      if (distanceKm === undefined || distanceKm > COLD_START_REACH_KM) continue;
      for (const offer of business.offers ?? []) {
        if (!isOfferLive(offer, now)) continue;
        // Never twice: a sponsored offer is already in the list above.
        if (promoted.has(`${business.id}:${offer.id}`)) continue;
        candidates.push({ business, offer, distanceKm });
      }
    }
  }

  const nearestFirst = (a: AdPlacement, b: AdPlacement) =>
    (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
  candidates.sort(nearestFirst);

  // Normally only what's genuinely close by. But if that leaves the slot too
  // thin to be worth showing, keep taking the next-nearest until it's full —
  // the cold-start rule in domain/ads.ts. Sponsored cards already count toward
  // "full", so a well-sold area stops widening on its own.
  const free = candidates.filter((p) => (p.distanceKm ?? Infinity) <= FREE_REACH_KM);
  if (sponsored.length + free.length < MIN_SLOT_CARDS) {
    for (const p of candidates) {
      if (sponsored.length + free.length >= MIN_SLOT_CARDS) break;
      if (!free.includes(p)) free.push(p);
    }
  }

  return [...sponsored.sort(nearestFirst), ...free];
}
