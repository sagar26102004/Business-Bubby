/**
 * Supabase-backed AdRepository over the `ad_campaigns` table (migration 0014).
 *
 * The document model holds the whole `AdCampaign` in `data`; `business_id` and
 * `status` are columns because RLS keys on them — active campaigns are world
 * readable (guests browse Home too), everything else only by the business
 * behind it or a platform admin.
 *
 * Two things this repository deliberately does NOT trust the client to do:
 *   - approving. The insert pins `status: 'pending'`, and only a super-admin
 *     may write any other status, so `request()` cannot sell itself a slot.
 *   - counting. Viewers have no update rights on a stranger's campaign, so
 *     impressions and taps go through the `ad_record_event` RPC.
 *
 * Reach is resolved HERE rather than on the Home screen: deciding what a person
 * standing at a point should see needs the campaign, the business location and
 * the offer's live state together, and the screen shouldn't own that rule.
 */
import type { AdCampaign, Business, GeoPoint } from '@/domain/types';
import type {
  AdPlacement,
  AdRepository,
  NewAdCampaignInput,
  PlacementOptions,
} from '@/data/repositories';
import { buildPlacements } from '@/data/adPlacements';
import { getAdPlan, isCampaignRunning } from '@/domain/ads';
import { isOfferLive } from '@/domain/offers';
import { sb, uuid, nowIso, notify, byNewest, mapData, serverNow } from './shared';

/** The campaign row shape we read back. */
type Row = { data: AdCampaign };

const campaignsFrom = (rows: Row[] | null | undefined): AdCampaign[] =>
  mapData(rows).sort(byNewest((c) => c.requestedAt));

/**
 * READS DEGRADE, WRITES DON'T.
 *
 * Migration 0014 is applied to the live project by hand, and until it runs
 * PostgREST answers 404 for `ad_campaigns`. Every read below is a side quest on
 * a screen about something else — the Home feed, and the workspace hub, which
 * loads campaigns alongside eight other things in one Promise.all. A missing
 * table must therefore cost the ad slot and nothing else, exactly as
 * `fetchPrivateProfile` (0007) and `fetchIsSuperAdmin` (0006) do.
 *
 * Writes deliberately keep throwing: someone pressing "Request this ad"
 * deserves to be told when it didn't work.
 */
async function safeRead(run: () => PromiseLike<{ data: unknown; error: unknown }>) {
  try {
    const { data, error } = await run();
    if (error) return [];
    return campaignsFrom(data as Row[] | null);
  } catch {
    return [];
  }
}

/** Read one campaign, or explain that it's gone. */
async function fetchCampaign(id: string): Promise<AdCampaign> {
  const { data, error } = await sb().from('ad_campaigns').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('That ad campaign no longer exists.');
  return data.data as AdCampaign;
}

/** Write the whole document back, keeping the `status` column in step with it. */
async function writeCampaign(next: AdCampaign): Promise<AdCampaign> {
  const { error } = await sb()
    .from('ad_campaigns')
    .update({ status: next.status, data: next })
    .eq('id', next.id);
  if (error) throw error;
  return next;
}

/**
 * Tell the business what happened to its request. Best-effort, like every other
 * notify() in this folder — a blocked notification must never fail the review.
 */
async function notifyOwner(campaign: AdCampaign, title: string, body: string): Promise<void> {
  const { data } = await sb()
    .from('businesses')
    .select('data')
    .eq('id', campaign.businessId)
    .maybeSingle();
  const business = data?.data as Business | undefined;
  if (!business) return;
  await notify({
    recipientId: business.ownerId,
    kind: 'ad_update',
    title,
    body,
    businessId: campaign.businessId,
  });
}

export function createSupabaseAds(): AdRepository {
  return {
    async listPlacements(near?: GeoPoint, options?: PlacementOptions): Promise<AdPlacement[]> {
      // Without a location there's no way to judge reach, so only sponsored
      // cards come back — an unpaid corner shop shown to someone in another
      // city is worse than an empty slot.
      const [active, businessesR] = await Promise.all([
        safeRead(() => sb().from('ad_campaigns').select('data').eq('status', 'active')),
        near
          ? sb().from('businesses').select('data')
          : Promise.resolve({ data: [] as { data: Business }[], error: null }),
      ]);
      if (businessesR.error) throw businessesR.error;

      const now = serverNow();
      const running = active.filter((c) => isCampaignRunning(c, now));

      // Sponsored placements need their business even when `near` is absent, so
      // fetch exactly the ones referenced rather than the whole directory twice.
      const haveBusinesses = new Map<string, Business>(
        (businessesR.data ?? []).map((r) => {
          const b = (r as { data: Business }).data;
          return [b.id, b];
        }),
      );
      const missing = running.map((c) => c.businessId).filter((id) => !haveBusinesses.has(id));
      if (missing.length > 0) {
        const { data } = await sb().from('businesses').select('data').in('id', missing);
        for (const row of data ?? []) {
          const b = (row as { data: Business }).data;
          haveBusinesses.set(b.id, b);
        }
      }

      return buildPlacements(running, [...haveBusinesses.values()], near, now, options?.radiusKm);
    },

    async listForBusiness(businessId: string): Promise<AdCampaign[]> {
      return safeRead(() =>
        sb().from('ad_campaigns').select('data').eq('business_id', businessId),
      );
    },

    async listAll(): Promise<AdCampaign[]> {
      return safeRead(() => sb().from('ad_campaigns').select('data'));
    },

    async request(input: NewAdCampaignInput): Promise<AdCampaign> {
      const plan = getAdPlan(input.planId);
      if (!plan) throw new Error('Pick a plan to promote this offer.');

      const { data: bizRow, error: bizError } = await sb()
        .from('businesses')
        .select('data')
        .eq('id', input.businessId)
        .maybeSingle();
      if (bizError) throw bizError;
      const business = bizRow?.data as Business | undefined;
      if (!business) throw new Error(`Business ${input.businessId} not found`);

      const offer = (business.offers ?? []).find((o) => o.id === input.offerId);
      if (!offer) throw new Error('That offer no longer exists — pick another one.');
      if (!isOfferLive(offer, serverNow())) {
        throw new Error('That offer is paused or finished. Switch it back on before promoting it.');
      }

      // One live campaign per offer: a business paying twice for the same card
      // would just be buying a duplicate of itself in the carousel.
      const existing = await this.listForBusiness(input.businessId);
      const clash = existing.find(
        (c) =>
          c.offerId === input.offerId &&
          (c.status === 'pending' || isCampaignRunning(c, serverNow())),
      );
      if (clash) {
        throw new Error(
          clash.status === 'pending'
            ? 'This offer is already waiting for review.'
            : 'This offer is already being promoted.',
        );
      }

      const campaign: AdCampaign = {
        id: uuid(),
        businessId: input.businessId,
        businessName: business.name,
        offerId: input.offerId,
        planId: plan.id,
        // Frozen from the plan, so a later price change never rewrites what
        // this business was quoted.
        radiusKm: plan.radiusKm,
        days: plan.days,
        amount: plan.amount,
        status: 'pending',
        paid: false,
        requestedAt: nowIso(),
        requestedById: input.requestedById,
        requestedByName: input.requestedByName,
        impressions: 0,
        taps: 0,
      };

      const { error } = await sb().from('ad_campaigns').insert({
        id: campaign.id,
        business_id: campaign.businessId,
        status: campaign.status,
        data: campaign,
      });
      if (error) throw error;
      return campaign;
    },

    async approve(id: string, note?: string): Promise<AdCampaign> {
      const current = await fetchCampaign(id);
      // The clock starts at approval, not at request, so a slow review never
      // eats into the run the business paid for.
      const startsAt = new Date(serverNow());
      const endsAt = new Date(startsAt.getTime() + current.days * 86_400_000);
      const next: AdCampaign = {
        ...current,
        status: 'active',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reviewedAt: nowIso(),
        reviewNote: note?.trim() || undefined,
      };
      const saved = await writeCampaign(next);
      await notifyOwner(
        saved,
        `📣 Your ad is live · ${saved.businessName}`,
        `It runs for ${saved.days} days and reaches ${saved.radiusKm} km around you.`,
      );
      return saved;
    },

    async reject(id: string, note?: string): Promise<AdCampaign> {
      const current = await fetchCampaign(id);
      const next: AdCampaign = {
        ...current,
        status: 'rejected',
        reviewedAt: nowIso(),
        reviewNote: note?.trim() || undefined,
      };
      const saved = await writeCampaign(next);
      await notifyOwner(
        saved,
        `Ad request not approved · ${saved.businessName}`,
        saved.reviewNote ?? 'Your promoted offer was not approved this time.',
      );
      return saved;
    },

    async stop(id: string): Promise<AdCampaign> {
      const current = await fetchCampaign(id);
      return writeCampaign({ ...current, status: 'stopped', endsAt: nowIso() });
    },

    async setPaid(id: string, paid: boolean): Promise<AdCampaign> {
      const current = await fetchCampaign(id);
      return writeCampaign({ ...current, paid });
    },

    async recordImpression(id: string): Promise<void> {
      await recordEvent(id, 'impression');
    },

    async recordTap(id: string): Promise<void> {
      await recordEvent(id, 'tap');
    },
  };
}

/**
 * Bump a counter through the SECURITY DEFINER RPC (migration 0014) — the viewer
 * has no write access to a stranger's campaign row, by design.
 *
 * Swallows everything: this is fired from a carousel the customer is merely
 * scrolling past, and a missing migration or a dropped request must never
 * surface as an error on that screen.
 */
async function recordEvent(id: string, kind: 'impression' | 'tap'): Promise<void> {
  try {
    await sb().rpc('ad_record_event', { p_id: id, p_kind: kind });
  } catch {
    /* counters are engagement, not billing — never worth an error */
  }
}

