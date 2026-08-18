/**
 * ADS — the rate card and the rules about when an ad is showing.
 *
 * ⚠️ Mirror of ../../../src/domain/ads.ts. Only the parts the SERVER decides are
 * ported: the plans (a request freezes its numbers from them), whether a
 * campaign is running, and how a view is banded. Labels, summaries and the
 * report formatting stay in the app — they are rendering, not policy.
 *
 * The model, in one line: money buys VIEWS from inside a band plus PRIORITY in
 * the slot, NOT a radius. A radius capped how many people could ever see an ad
 * — against the platform's own interest, since every extra view is free
 * inventory — and charged the same for an audience one street away as one
 * across the district. Distance is really INTENT, so the plans sell a number of
 * nearby views and the card itself travels as far as the viewer is looking.
 */
import type { AdCampaign } from '@/domain/types';

/** How far an UNPAID offer carries. Small on purpose: it's the free sample. */
export const FREE_REACH_KM = 2;

/** Cold start: widen the free band until the Home slot has this many cards. */
export const MIN_SLOT_CARDS = 5;

/** The hard edge of that cold-start top-up for FREE offers. */
export const COLD_START_REACH_KM = 25;

/** How far a sponsored card carries on HOME, where the viewer has no range
 *  control. The /deals feed ignores this — there the customer picks. */
export const SPONSORED_REACH_KM = 25;

/** "Anywhere" — a large finite number rather than Infinity so it survives a
 *  query string (`Infinity` serialises to something that parses as NaN). */
export const ANY_RANGE_KM = 20_000;

/** The distance bands views are bucketed into, by upper edge in km. */
export const VIEW_BANDS_KM = [1, 2, 5, 10, 25, 50, 100] as const;

/**
 * Which bucket a view from `distanceKm` belongs in. Unknown distance counts as
 * far away: guessing it was nearby would inflate the one number the business is
 * actually paying for.
 */
export function viewBandKey(distanceKm: number | undefined): string {
  if (distanceKm === undefined || !Number.isFinite(distanceKm)) return 'far';
  const band = VIEW_BANDS_KM.find((km) => distanceKm <= km);
  return band === undefined ? 'far' : String(band);
}

/** One purchasable ad slot. */
export interface AdPlan {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Days the run lasts once approved — the promise's deadline, not its cap. */
  days: number;
  /** Views promised from inside `withinKm`. The headline number. */
  views: number;
  /** How close a viewer must be for their view to count toward `views`. */
  withinKm: number;
  /** Rupees for the whole run. */
  amount: number;
  popular?: boolean;
}

/** The rate card. ⚠️ Must stay identical to the app's copy — a campaign freezes
 *  these numbers, so a disagreement sells one thing and records another. */
export const AD_PLANS: AdPlan[] = [
  {
    id: 'street',
    label: 'Street',
    description: 'A week in front of the people who walk past you anyway.',
    icon: '🏠',
    days: 7,
    views: 100,
    withinKm: 2,
    amount: 349,
  },
  {
    id: 'neighborhood',
    label: 'Neighborhood',
    description: 'Two weeks in front of the area people travel from.',
    icon: '🏘️',
    days: 14,
    views: 200,
    withinKm: 5,
    amount: 599,
    popular: true,
  },
  {
    id: 'city',
    label: 'City side',
    description: 'Two weeks, well past your regulars.',
    icon: '🌆',
    days: 14,
    views: 300,
    withinKm: 10,
    amount: 749,
  },
  {
    id: 'district',
    label: 'District',
    description: 'A full month across everywhere anyone would drive in from.',
    icon: '🌍',
    days: 30,
    views: 600,
    withinKm: 25,
    amount: 1199,
  },
];

export const getAdPlan = (id: string | undefined): AdPlan | undefined =>
  AD_PLANS.find((p) => p.id === id);

/** The plan in one line: "14 days · 200 views within 5 km". */
export const adPlanSummary = (plan: AdPlan): string =>
  `${plan.days} days · ${plan.views} views within ${plan.withinKm} km`;

/** What this campaign promised, or undefined for a legacy radius-priced one. */
export function campaignGoal(
  campaign: AdCampaign,
): { views: number; withinKm: number } | undefined {
  if (!campaign.targetViews || !campaign.withinKm) return undefined;
  return { views: campaign.targetViews, withinKm: campaign.withinKm };
}

/** The same line for a campaign, which froze its own numbers at purchase. */
export function campaignPlanSummary(campaign: AdCampaign): string {
  const goal = campaignGoal(campaign);
  return goal
    ? `${campaign.days} days · ${goal.views} views within ${goal.withinKm} km`
    : `${campaign.days} days · ${campaign.radiusKm ?? '?'} km reach`;
}

/** Views delivered inside the promised band so far. */
export const campaignNearViews = (campaign: AdCampaign): number => campaign.viewsNear ?? 0;

/** Has the promise been kept? True for legacy campaigns, which never made one. */
export function isCampaignGoalMet(campaign: AdCampaign): boolean {
  const goal = campaignGoal(campaign);
  return !goal || campaignNearViews(campaign) >= goal.views;
}

/** How far this campaign's card carries, in km. Legacy campaigns are held to
 *  the radius they paid for; view-priced ones are limited only by how far the
 *  viewer is looking. */
export const campaignReachKm = (campaign: AdCampaign): number =>
  campaign.radiusKm ?? Number.POSITIVE_INFINITY;

/** A run never lasts more than this many times the days it bought — without a
 *  cap, an ad whose promise can't be met would hold the slot forever. */
export const MAX_RUN_FACTOR = 2;

function scheduledEndMs(campaign: AdCampaign): number | undefined {
  return campaign.endsAt ? new Date(campaign.endsAt).getTime() : undefined;
}

function hardEndMs(campaign: AdCampaign): number | undefined {
  if (!campaign.startsAt) return scheduledEndMs(campaign);
  return new Date(campaign.startsAt).getTime() + campaign.days * MAX_RUN_FACTOR * 86_400_000;
}

/**
 * Is this campaign on air right now?
 *
 * Approved, started, and either inside its run window OR still owed views. That
 * second clause is the whole point of a view-priced plan: "at least 200 views
 * within 5 km" has to be TRUE when the run ends, so a campaign short of its
 * number keeps showing (up to `MAX_RUN_FACTOR` × days) until it isn't. Derived
 * on read — there is no sweep job and the row's `status` never changes for it.
 *
 * ⚠️ Every caller must go through this rather than re-deriving the window in
 * SQL or in a router, or the two answers drift and an ad silently stops (or
 * never stops) showing.
 */
export function isCampaignRunning(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  if (campaign.status !== 'active') return false;
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > nowMs) return false;

  const end = scheduledEndMs(campaign);
  if (end === undefined || end > nowMs) return true;

  // Past its days: only a promise still owed keeps it on air.
  if (isCampaignGoalMet(campaign)) return false;
  const hard = hardEndMs(campaign);
  return hard === undefined || hard > nowMs;
}
