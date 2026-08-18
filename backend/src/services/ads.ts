/**
 * ADS — the paid slot on Home and the /deals feed. Ports MockAdRepository and
 * src/data/supabase/ads.ts method-for-method.
 *
 * Two things this service deliberately does NOT trust a caller to do:
 *   - APPROVING. `request()` always writes `status: 'pending'` and freezes the
 *     plan's own numbers, so a business cannot sell itself a slot. Only a
 *     super-admin route may move it off `pending`.
 *   - COUNTING WHAT IT LIKES. A view counts toward the promise only when the
 *     viewer's distance says it came from inside the band that was bought.
 *
 * ⚠️ Prisma runs on a privileged connection that BYPASSES RLS, so every rule
 * migration 0014's policies express for Path A is re-expressed here in
 * `authz.ts` terms — the routers carry the guards, this file carries the logic.
 *
 * ⚠️ Whether a campaign is on air is ALWAYS `isCampaignRunning` (domain/ads.ts),
 * never a window re-derived in SQL or in a router. A view-priced campaign keeps
 * running past `endsAt` while it still owes views, and a second implementation
 * of that rule is a second answer to "is this ad showing?".
 */
import type { AdCampaign, Business, GeoPoint } from '@/domain/types';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson } from '@/lib/data';
import { buildPlacements, type AdPlacement } from '@/lib/adPlacements';
import {
  campaignGoal,
  campaignPlanSummary,
  getAdPlan,
  isCampaignRunning,
  viewBandKey,
} from '@/domain/ads';
import { isOfferLive } from '@/domain/offers';
import { notFound } from '@/http/errors';
import { notify } from './notify';

export interface NewAdCampaignInput {
  businessId: string;
  offerId: string;
  planId: string;
  requestedById: string;
  requestedByName: string;
}

/** Newest request first — the order the workspace and the admin queue read in. */
const byNewest = (a: AdCampaign, b: AdCampaign) => b.requestedAt.localeCompare(a.requestedAt);

async function mustFind(id: string): Promise<AdCampaign> {
  const row = await prisma.adCampaign.findUnique({ where: { id } });
  if (!row) throw notFound('That ad campaign no longer exists.');
  return asData<AdCampaign>(row);
}

/** Write the whole document back, keeping the `status` column in step with it. */
async function save(next: AdCampaign): Promise<AdCampaign> {
  await prisma.adCampaign.update({
    where: { id: next.id },
    data: { status: next.status, data: toJson(next) },
  });
  return next;
}

/**
 * Tell the business what happened to its request. Best-effort, like every other
 * notify() here — a blocked notification must never fail the review.
 */
async function notifyOwner(campaign: AdCampaign, title: string, body: string): Promise<void> {
  const row = await prisma.business.findUnique({ where: { id: campaign.businessId } });
  if (!row) return;
  const business = asData<Business>(row);
  await notify({
    recipientId: business.ownerId,
    kind: 'ad_update',
    title,
    body,
    businessId: campaign.businessId,
  });
}

export const adService = {
  /**
   * What a person standing at `near` should see. `radiusKm` is the /deals
   * feed's viewer-chosen range (up to ANY_RANGE_KM — deliberately NOT clamped
   * to the Home reach); omitted, the Home slot's own rules apply.
   */
  async listPlacements(near?: GeoPoint, radiusKm?: number): Promise<AdPlacement[]> {
    const now = Date.now();
    const active = rowsData<AdCampaign>(
      await prisma.adCampaign.findMany({ where: { status: 'active' } }),
    );
    const running = active.filter((c) => isCampaignRunning(c, now));

    // Without a location there is no way to judge reach, so only the businesses
    // behind sponsored cards are needed; with one, the whole directory is in
    // play because any live offer nearby can fill the slot.
    const businesses = near
      ? rowsData<Business>(await prisma.business.findMany())
      : rowsData<Business>(
          await prisma.business.findMany({
            where: { id: { in: [...new Set(running.map((c) => c.businessId))] } },
          }),
        );

    return buildPlacements(running, businesses, near, now, radiusKm);
  },

  /** One campaign, or 404. Used by the routers that authorize on its business. */
  async getById(id: string): Promise<AdCampaign> {
    return mustFind(id);
  },

  /** Every campaign this business has ever run — the workspace's ad history. */
  async listForBusiness(businessId: string): Promise<AdCampaign[]> {
    const rows = rowsData<AdCampaign>(await prisma.adCampaign.findMany({ where: { businessId } }));
    return rows.sort(byNewest);
  },

  /** The platform admin's queue: everything, newest first. */
  async listAll(): Promise<AdCampaign[]> {
    return rowsData<AdCampaign>(await prisma.adCampaign.findMany()).sort(byNewest);
  },

  async request(input: NewAdCampaignInput): Promise<AdCampaign> {
    const plan = getAdPlan(input.planId);
    if (!plan) throw new Error('Pick a plan to promote this offer.');

    const row = await prisma.business.findUnique({ where: { id: input.businessId } });
    if (!row) throw notFound(`Business ${input.businessId} not found`);
    const business = asData<Business>(row);

    const offer = (business.offers ?? []).find((o) => o.id === input.offerId);
    if (!offer) throw new Error('That offer no longer exists — pick another one.');
    if (!isOfferLive(offer)) {
      throw new Error('That offer is paused or finished. Switch it back on before promoting it.');
    }

    // One live campaign per offer: paying twice for the same card would just buy
    // a duplicate of yourself in the carousel.
    const existing = await this.listForBusiness(input.businessId);
    const clash = existing.find(
      (c) => c.offerId === input.offerId && (c.status === 'pending' || isCampaignRunning(c)),
    );
    if (clash) {
      throw new Error(
        clash.status === 'pending'
          ? 'This offer is already waiting for review.'
          : 'This offer is already being promoted.',
      );
    }

    const campaign: AdCampaign = {
      id: newUuid(),
      businessId: input.businessId,
      businessName: business.name,
      offerId: input.offerId,
      planId: plan.id,
      // Frozen from the plan, so a later price change never rewrites what this
      // business was quoted. `radiusKm` is deliberately NOT written: reach is no
      // longer what's being sold, and only legacy rows carry it.
      targetViews: plan.views,
      withinKm: plan.withinKm,
      days: plan.days,
      amount: plan.amount,
      // Pinned, never taken from the client — this is the whole reason a
      // business can't approve itself.
      status: 'pending',
      paid: false,
      requestedAt: new Date().toISOString(),
      requestedById: input.requestedById,
      requestedByName: input.requestedByName,
      impressions: 0,
      taps: 0,
      viewsNear: 0,
      viewsByBand: {},
    };

    await prisma.adCampaign.create({
      data: {
        id: campaign.id,
        businessId: campaign.businessId,
        status: campaign.status,
        data: toJson(campaign),
      },
    });
    return campaign;
  },

  async approve(id: string, note?: string): Promise<AdCampaign> {
    const current = await mustFind(id);
    // The clock starts at approval, not at request, so a slow review never eats
    // into the run the business paid for.
    const startsAt = new Date();
    const next: AdCampaign = {
      ...current,
      status: 'active',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + current.days * 86_400_000).toISOString(),
      reviewedAt: startsAt.toISOString(),
      reviewNote: note?.trim() || undefined,
    };
    const saved = await save(next);
    await notifyOwner(
      saved,
      `📣 Your ad is live · ${saved.businessName}`,
      `${campaignPlanSummary(saved)}. We'll keep it running until those views land.`,
    );
    return saved;
  },

  async reject(id: string, note?: string): Promise<AdCampaign> {
    const current = await mustFind(id);
    const saved = await save({
      ...current,
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewNote: note?.trim() || undefined,
    });
    await notifyOwner(
      saved,
      `Ad request not approved · ${saved.businessName}`,
      saved.reviewNote ?? 'Your promoted offer was not approved this time.',
    );
    return saved;
  },

  async stop(id: string): Promise<AdCampaign> {
    const current = await mustFind(id);
    return save({ ...current, status: 'stopped', endsAt: new Date().toISOString() });
  },

  async setPaid(id: string, paid: boolean): Promise<AdCampaign> {
    const current = await mustFind(id);
    return save({ ...current, paid });
  },

  /**
   * Count a card being shown or tapped. NEVER throws: this is fired from a
   * carousel a customer is merely scrolling past, so a missing campaign, a
   * finished run or a dropped write must cost nothing on that screen.
   *
   * `distanceKm` is how far the VIEWER was from the business, and it is the
   * billing model: the view counts toward the promise only from inside the band
   * that was bought, and every view is bucketed for the business's report. An
   * unknown distance banks as `far` rather than being guessed nearby — guessing
   * would inflate the one number being paid for.
   */
  async recordEvent(id: string, kind: 'impression' | 'tap', distanceKm?: number): Promise<void> {
    try {
      const row = await prisma.adCampaign.findUnique({ where: { id } });
      if (!row) return;
      const campaign = asData<AdCampaign>(row);
      if (!isCampaignRunning(campaign)) return;

      const next: AdCampaign = { ...campaign };
      if (kind === 'tap') {
        next.taps = campaign.taps + 1;
      } else {
        next.impressions = campaign.impressions + 1;
        const band = viewBandKey(distanceKm);
        next.viewsByBand = {
          ...campaign.viewsByBand,
          [band]: (campaign.viewsByBand?.[band] ?? 0) + 1,
        };
        const goal = campaignGoal(campaign);
        if (goal && distanceKm !== undefined && distanceKm <= goal.withinKm) {
          next.viewsNear = (campaign.viewsNear ?? 0) + 1;
        }
      }
      await save(next);
    } catch {
      /* counters are engagement, not billing — never worth an error */
    }
  },
};
