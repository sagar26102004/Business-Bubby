/**
 * ADS — what a business can buy, and the rules about when an ad is showing.
 *
 * The pitch, in one line: a neighborhood with a few hundred Localo users is an
 * audience, and the shops in it will pay to reach it. The Home screen's ad slot
 * — the rotating card carousel under the category strip — is the inventory.
 *
 * Free vs paid is deliberately NOT "ads or no ads". Every live `Offer` from a
 * nearby business already shows in that slot for free, because a half-empty
 * carousel helps nobody and a business has to see the placement working before
 * it will pay for it. What money buys is:
 *
 *   REACH    — an unpaid offer only reaches people inside FREE_REACH_KM. A plan
 *              widens that to its own radius, so a shop can be seen across the
 *              suburb rather than just down its own street.
 *   PRIORITY — sponsored cards sort ahead of unpaid ones, so they're what a
 *              scroller sees first.
 *
 * Plans are DATA, like every other catalog in this folder — prices change by
 * editing this array, and a campaign freezes the numbers it was sold at
 * (`AdCampaign.amount/days/radiusKm`) so a later price rise never rewrites what
 * an existing customer was quoted.
 */
import type { AdCampaign } from './types';

/**
 * How far an UNPAID offer carries. Small on purpose: it's the free sample, and
 * the gap between this and a plan's radius is the reason to buy one.
 */
export const FREE_REACH_KM = 2;

/**
 * COLD START. In a neighborhood with two hundred users and shops on every
 * corner, `FREE_REACH_KM` fills the slot on its own. On day one it does not —
 * the nearest listing can easily be 5 km away, and an empty ad slot is exactly
 * the "the ads section vanished" problem this feature exists to fix. An empty
 * carousel also sells nobody an ad: a business buys the slot because it has
 * seen the slot working.
 *
 * So when fewer than `MIN_SLOT_CARDS` cards qualify, the free band widens to
 * `COLD_START_REACH_KM` just far enough to fill it. Sponsored cards are never
 * affected — they keep the exact radius that was paid for, and they still sort
 * first — and the top-up stops happening by itself as an area fills up.
 */
export const MIN_SLOT_CARDS = 5;

/** The hard edge of the cold-start top-up. Past this it's another city, not a
 *  thin neighborhood, and "offers near you" would be a lie. */
export const COLD_START_REACH_KM = 25;

/** One purchasable ad slot. */
export interface AdPlan {
  id: string;
  /** What the business sees on the button, e.g. "Neighborhood". */
  label: string;
  /** The one-line pitch under it. */
  description: string;
  icon: string;
  /** Days the ad runs once approved. */
  days: number;
  /** How far it reaches from the business, in km. */
  radiusKm: number;
  /** Rupees for the whole run. */
  amount: number;
  /** The one nudged as the sensible middle. */
  popular?: boolean;
}

/**
 * The rate card. Priced for a small Indian neighborhood shop — a week of reach
 * should cost less than one day's takings, or nobody buys a second one.
 */
export const AD_PLANS: AdPlan[] = [
  {
    id: 'street',
    label: 'Street',
    description: 'A week in front of everyone within a short walk.',
    icon: '🏠',
    days: 7,
    radiusKm: 3,
    amount: 299,
  },
  {
    id: 'neighborhood',
    label: 'Neighborhood',
    description: 'Two weeks across the whole area people travel for.',
    icon: '🏘️',
    days: 14,
    radiusKm: 6,
    amount: 699,
    popular: true,
  },
  {
    id: 'city',
    label: 'City side',
    description: 'A full month, reaching well past your regulars.',
    icon: '🌆',
    days: 30,
    radiusKm: 12,
    amount: 1499,
  },
];

export const getAdPlan = (id: string | undefined): AdPlan | undefined =>
  AD_PLANS.find((p) => p.id === id);

/** "₹699" — plan and campaign amounts are whole rupees. */
export const formatAdAmount = (amount: number): string => `₹${Math.round(amount)}`;

/**
 * Is this campaign on air right now?
 *
 * Approved AND inside its run window. A campaign whose `endsAt` has passed is
 * simply not running any more — the row keeps `status: 'active'` as the record
 * of what was bought, and this is the only thing that decides whether it shows.
 *
 * `nowMs` is passed in rather than read here so callers on the Supabase backend
 * can hand over the server-anchored clock (see supabase/shared.ts) instead of a
 * device clock that might be days out.
 */
export function isCampaignRunning(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  if (campaign.status !== 'active') return false;
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() <= nowMs) return false;
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > nowMs) return false;
  return true;
}

/** Has an approved run finished? (Distinct from "was never approved".) */
export function isCampaignFinished(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  return campaign.status === 'active' && !isCampaignRunning(campaign, nowMs);
}

/** Whole days left in a running campaign, rounded up. 0 once it's over. */
export function campaignDaysLeft(campaign: AdCampaign, nowMs: number = Date.now()): number {
  if (!campaign.endsAt) return 0;
  const ms = new Date(campaign.endsAt).getTime() - nowMs;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Status as the business should read it, including the derived "finished". */
export function campaignStatusLabel(campaign: AdCampaign, nowMs: number = Date.now()): string {
  switch (campaign.status) {
    case 'pending':
      return '⏳ Waiting for review';
    case 'rejected':
      return '✕ Not approved';
    case 'stopped':
      return '■ Stopped';
    case 'active': {
      if (isCampaignFinished(campaign, nowMs)) return '✓ Finished';
      const left = campaignDaysLeft(campaign, nowMs);
      return `● Live · ${left} day${left === 1 ? '' : 's'} left`;
    }
  }
}

/**
 * Taps per hundred impressions, the one number that tells a business whether
 * the ad is working. Undefined until it's been seen at all, because a rate off
 * three impressions is noise dressed up as a metric.
 */
export function campaignTapRate(campaign: AdCampaign): number | undefined {
  if (campaign.impressions < 10) return undefined;
  return Math.round((campaign.taps / campaign.impressions) * 1000) / 10;
}
