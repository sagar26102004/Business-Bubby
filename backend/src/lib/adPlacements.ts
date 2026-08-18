/**
 * "What ads does a person standing HERE see?" — mirror of the app's
 * ../../../src/data/adPlacements.ts, ported rather than re-derived so both
 * backends and the mock answer identically.
 *
 * The ordering IS the business model (domain/ads.ts):
 *   1. Sponsored placements — a running, approved campaign. Money buys the
 *      promise of nearby views and the spot at the front; the card itself
 *      carries as far as the viewer is looking (SPONSORED_REACH_KM on Home, the
 *      chosen range in /deals). Legacy radius-priced campaigns are still held to
 *      the radius they were sold.
 *   2. Free placements — any live offer from a business inside FREE_REACH_KM,
 *      widened toward COLD_START_REACH_KM only while the slot is too thin to be
 *      worth showing.
 * Nearest first inside each band.
 *
 * VIEWER-CHOSEN RADIUS (the /deals feed) answers a different question — "what's
 * on around me?" rather than "what belongs in the cards on Home" — so it
 * replaces the free band with exactly what was asked for, lets sponsored cards
 * travel that whole distance, switches the cold-start top-up off (there is no
 * fixed slot to fill), and drops a business whose distance can't be computed.
 */
import type { AdCampaign, Business, Offer } from '@/domain/types';
import type { GeoPoint } from '@/domain/types';
import {
  COLD_START_REACH_KM,
  FREE_REACH_KM,
  MIN_SLOT_CARDS,
  SPONSORED_REACH_KM,
  campaignReachKm,
} from '@/domain/ads';
import { isOfferLive } from '@/domain/offers';
import { haversineKm } from '@/lib/geo';

/** One card's worth of ad — mirrors `AdPlacement` in src/data/repositories.ts. */
export interface AdPlacement {
  business: Business;
  offer: Offer;
  campaign?: AdCampaign;
  /** Straight-line km from the viewer, when a location was given. */
  distanceKm?: number;
}

export function buildPlacements(
  /** Campaigns already filtered to the ones actually running. */
  running: AdCampaign[],
  businesses: Business[],
  near: GeoPoint | undefined,
  now: number,
  /** The range the viewer explicitly asked for (the /deals feed), in km. */
  viewerRadiusKm?: number,
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
    // deleting the offer takes the ad down with it.
    if (!offer || !isOfferLive(offer, now)) continue;

    const distanceKm = distanceTo(business);
    // How far this card may travel: as far as the viewer is looking, and never
    // past the reach a LEGACY campaign specifically bought.
    const limitKm = Math.min(campaignReachKm(campaign), viewerRadiusKm ?? SPONSORED_REACH_KM);
    // An UNKNOWN distance still shows on Home: the slot was bought, and
    // silently dropping it is the worse failure. In the feed, where the whole
    // point is a chosen range, an unplaceable business can't honestly be in it.
    if (distanceKm === undefined) {
      if (viewerRadiusKm !== undefined) continue;
    } else if (distanceKm > limitKm) {
      continue;
    }

    promoted.add(`${business.id}:${offer.id}`);
    sponsored.push({ business, offer, campaign, distanceKm });
  }

  // Every unpaid offer that COULD show. Which of them actually do is a distance
  // cut applied below, once we know how thin the slot is.
  const candidates: AdPlacement[] = [];
  // Without a viewer location there's no way to judge closeness, and showing an
  // unpaid corner shop to someone in another city is worse than an empty slot.
  const outerKm = viewerRadiusKm ?? COLD_START_REACH_KM;
  if (near) {
    for (const business of businesses) {
      const distanceKm = distanceTo(business);
      if (distanceKm === undefined || distanceKm > outerKm) continue;
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
  // thin to be worth showing, keep taking the next-nearest until it's full.
  // Sponsored cards count toward "full", so a well-sold area stops widening.
  const free = candidates.filter(
    (p) => (p.distanceKm ?? Number.POSITIVE_INFINITY) <= (viewerRadiusKm ?? FREE_REACH_KM),
  );
  if (viewerRadiusKm === undefined && sponsored.length + free.length < MIN_SLOT_CARDS) {
    for (const p of candidates) {
      if (sponsored.length + free.length >= MIN_SLOT_CARDS) break;
      if (!free.includes(p)) free.push(p);
    }
  }

  return [...sponsored.sort(nearestFirst), ...free];
}
