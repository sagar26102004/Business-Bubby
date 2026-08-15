/**
 * ADS — what a business can buy, and the rules about when an ad is showing.
 *
 * The pitch, in one line: a neighborhood with a few hundred Localo users is an
 * audience, and the shops in it will pay to reach it. The Home screen's ad slot
 * — the rotating card carousel under the category strip — plus the /deals feed
 * are the inventory.
 *
 * Free vs paid is deliberately NOT "ads or no ads". Every live `Offer` from a
 * nearby business already shows in that slot for free, because a half-empty
 * carousel helps nobody and a business has to see the placement working before
 * it will pay for it. What money buys is:
 *
 *   VIEWS    — a promise: at least `views` people INSIDE `withinKm` will see
 *              the card, and the run keeps going until they have.
 *   PRIORITY — sponsored cards sort ahead of unpaid ones, so they're what a
 *              scroller sees first.
 *   REACH    — an unpaid offer only carries FREE_REACH_KM. A sponsored one goes
 *              as far as the viewer is looking: on Home to SPONSORED_REACH_KM,
 *              and in the /deals feed to whatever range the customer picked,
 *              which now runs all the way out to "anywhere".
 *
 * WHY VIEWS AND NOT A RADIUS. A radius was the wrong thing to sell twice over.
 * It capped how many people could ever see the ad — the platform's own interest
 * is the opposite, every extra view is free inventory — and it charged the same
 * for an audience that might be one street or one district away. Distance is
 * really a measure of INTENT: someone 1 km from a cafe might walk in this
 * afternoon; someone 100 km away almost certainly won't. So the plans now sell
 * a number of NEARBY views, and the price per view rises the tighter the band
 * (see AD_PLANS). Views from further out still happen, are still reported, and
 * cost the business nothing.
 *
 * Plans are DATA, like every other catalog in this folder — prices change by
 * editing this array, and a campaign freezes the numbers it was sold at
 * (`AdCampaign.amount/days/targetViews/withinKm`) so a later price rise never
 * rewrites what an existing customer was quoted.
 */
import type { AdCampaign } from './types';

/**
 * How far an UNPAID offer carries. Small on purpose: it's the free sample, and
 * the gap between this and a sponsored card's reach is the reason to buy one.
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
 * affected — they have their own reach rule — and the top-up stops happening by
 * itself as an area fills up.
 */
export const MIN_SLOT_CARDS = 5;

/** The hard edge of the cold-start top-up for FREE offers. Past this it's
 *  another city, not a thin neighborhood, and "offers near you" would be a
 *  lie. */
export const COLD_START_REACH_KM = 25;

/**
 * How far a sponsored card carries on HOME, where the customer has no range
 * control and the slot is titled "near you". The /deals feed ignores this
 * entirely — there the customer picks the range, and a sponsored card shows at
 * whatever distance they asked to see.
 */
export const SPONSORED_REACH_KM = 25;

/**
 * The ranges the /deals feed offers, in km. Small steps where people actually
 * walk, then the big ones — a customer who wants to see what's on across the
 * district (or the state) should be able to, because every extra card viewed is
 * inventory delivered and costs the platform nothing.
 */
export const FEED_RANGES_KM = [1, 2, 5, 10, 25, 50, 100, 200] as const;

/**
 * "Anywhere" — the last rung of the feed's range ladder. A large finite number
 * rather than Infinity so it survives being put in a URL or a query string on
 * the way to a backend (`Infinity` serialises to something that parses as NaN).
 */
export const ANY_RANGE_KM = 20_000;

/** The range the feed opens on: far enough to have something in it, close
 *  enough that the first card is still somewhere the customer would go. */
export const DEFAULT_FEED_RANGE_KM = 10;

export const formatRangeKm = (km: number): string =>
  km >= ANY_RANGE_KM ? 'Anywhere' : `${km} km`;

/**
 * The distance bands views are bucketed into for the business's report, by
 * upper edge in km. Anything past the last one lands in `'far'`.
 */
export const VIEW_BANDS_KM = [1, 2, 5, 10, 25, 50, 100] as const;

/** Which bucket a view from `distanceKm` belongs in. Unknown distance counts
 *  as far away: guessing it was nearby would inflate the one number the
 *  business is actually paying for. */
export function viewBandKey(distanceKm: number | undefined): string {
  if (distanceKm === undefined || !Number.isFinite(distanceKm)) return 'far';
  const band = VIEW_BANDS_KM.find((km) => distanceKm <= km);
  return band === undefined ? 'far' : String(band);
}

/** "Within 2 km" / "Beyond 100 km" — how a band reads to the business. */
export function viewBandLabel(key: string): string {
  if (key === 'far') return `Beyond ${VIEW_BANDS_KM[VIEW_BANDS_KM.length - 1]} km`;
  return `Within ${key} km`;
}

/** One purchasable ad slot. */
export interface AdPlan {
  id: string;
  /** What the business sees on the button, e.g. "Neighborhood". */
  label: string;
  /** The one-line pitch under it. */
  description: string;
  icon: string;
  /** Days the ad runs once approved — the promise's deadline, not its cap. */
  days: number;
  /** Views promised from inside `withinKm`. The headline number. */
  views: number;
  /** How close a viewer has to be for their view to count toward `views`. */
  withinKm: number;
  /** Rupees for the whole run. */
  amount: number;
  /** The one nudged as the sensible middle. */
  popular?: boolean;
}

/**
 * The rate card. Priced for a small Indian neighborhood shop — a week of reach
 * should cost less than one day's takings, or nobody buys a second one.
 *
 * Read down the `amount / views` column and the model is right there: ₹3.50 for
 * a view from inside 2 km, ₹2.50 from inside 10 km, ₹2.00 from inside 25 km.
 * The tighter the band, the dearer the view — because the nearer the viewer,
 * the likelier they walk in.
 */
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

/** "₹699" — plan and campaign amounts are whole rupees. */
export const formatAdAmount = (amount: number): string => `₹${Math.round(amount)}`;

/** "₹3.00 per nearby view" — the plan's price broken down the way it was built. */
export const adCostPerView = (plan: AdPlan): string =>
  `₹${(plan.amount / plan.views).toFixed(2)}`;

/** The plan in one line: "14 days · 200 views within 5 km". */
export const adPlanSummary = (plan: AdPlan): string =>
  `${plan.days} days · ${plan.views} views within ${plan.withinKm} km`;

/**
 * The same line for a campaign, which froze its own numbers at purchase and may
 * be a legacy radius-priced one.
 */
export function campaignPlanSummary(campaign: AdCampaign): string {
  const goal = campaignGoal(campaign);
  return goal
    ? `${campaign.days} days · ${goal.views} views within ${goal.withinKm} km`
    : `${campaign.days} days · ${campaign.radiusKm ?? '?'} km reach`;
}

/**
 * What this campaign promised, or undefined if it's a legacy campaign that
 * bought a radius instead. Everything that treats views as the product goes
 * through here, so the old rows keep behaving exactly as they were sold.
 */
export function campaignGoal(
  campaign: AdCampaign,
): { views: number; withinKm: number } | undefined {
  if (!campaign.targetViews || !campaign.withinKm) return undefined;
  return { views: campaign.targetViews, withinKm: campaign.withinKm };
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
 *  viewer is looking (SPONSORED_REACH_KM on Home, the chosen range in /deals). */
export const campaignReachKm = (campaign: AdCampaign): number =>
  campaign.radiusKm ?? Number.POSITIVE_INFINITY;

/**
 * A run never lasts more than this many times the days it bought. Without a cap
 * an ad in a quiet corner of the map, whose promise can't be met, would sit in
 * the slot forever holding inventory it isn't paying for.
 */
export const MAX_RUN_FACTOR = 2;

/** When the bought run is scheduled to end, in ms. Undefined until approved. */
function scheduledEndMs(campaign: AdCampaign): number | undefined {
  return campaign.endsAt ? new Date(campaign.endsAt).getTime() : undefined;
}

/** The absolute last moment a make-good extension can reach. */
function hardEndMs(campaign: AdCampaign): number | undefined {
  if (!campaign.startsAt) return scheduledEndMs(campaign);
  return new Date(campaign.startsAt).getTime() + campaign.days * MAX_RUN_FACTOR * 86_400_000;
}

/**
 * Is this campaign on air right now?
 *
 * Approved, started, and either inside its run window OR still owed views. That
 * second clause is the whole point of a view-priced plan: "at least 200 views
 * within 5 km" has to be true when the run ends, so a campaign short of its
 * number keeps showing (up to `MAX_RUN_FACTOR` × days) until it isn't. A
 * campaign whose window has passed with the promise kept is simply not running
 * any more — the row keeps `status: 'active'` as the record of what was bought,
 * and this is the only thing that decides whether it shows.
 *
 * `nowMs` is passed in rather than read here so callers on the Supabase backend
 * can hand over the server-anchored clock (see supabase/shared.ts) instead of a
 * device clock that might be days out.
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

/** Running past its bought days to finish delivering the views it promised. */
export function isCampaignInMakeGood(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  const end = scheduledEndMs(campaign);
  return end !== undefined && end <= nowMs && isCampaignRunning(campaign, nowMs);
}

/** Has an approved run finished? (Distinct from "was never approved".) */
export function isCampaignFinished(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  return campaign.status === 'active' && !isCampaignRunning(campaign, nowMs);
}

/** Whole days left in the BOUGHT window, rounded up. 0 once that's passed —
 *  make-good time is deliberately not counted as days remaining, because it
 *  ends on a view count, not on the clock. */
export function campaignDaysLeft(campaign: AdCampaign, nowMs: number = Date.now()): number {
  const end = scheduledEndMs(campaign);
  if (end === undefined) return 0;
  const ms = end - nowMs;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Nearby views still owed on the promise. 0 once it's been kept. */
export function campaignViewsOwed(campaign: AdCampaign): number {
  const goal = campaignGoal(campaign);
  if (!goal) return 0;
  return Math.max(0, goal.views - campaignNearViews(campaign));
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
      if (isCampaignInMakeGood(campaign, nowMs)) {
        return `● Live · extra days, ${campaignViewsOwed(campaign)} views still to deliver`;
      }
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

/**
 * The view breakdown for the business's report: every band that actually has
 * views in it, nearest first, with `far` last. Bands nobody looked from are
 * left out — an empty row teaches nothing.
 */
export function campaignViewBands(
  campaign: AdCampaign,
): { key: string; label: string; views: number }[] {
  const byBand = campaign.viewsByBand ?? {};
  const keys = [...VIEW_BANDS_KM.map(String), 'far'];
  return keys
    .filter((key) => (byBand[key] ?? 0) > 0)
    .map((key) => ({ key, label: viewBandLabel(key), views: byBand[key] ?? 0 }));
}
