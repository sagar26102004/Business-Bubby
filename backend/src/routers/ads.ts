/**
 * Ad campaigns — the paid slot on Home and the /deals feed.
 *
 * The guards here ARE migration 0014's RLS policies, restated: Prisma connects
 * privileged and bypasses RLS, so nothing else stands between a business and
 * someone else's campaign.
 *
 *   anyone at all   — read the placements, count a view or a tap.
 *   business member — request a campaign, see its own history, stop it early.
 *   platform admin  — the queue, approve, reject, mark paid, stop anything.
 */
import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId, optionalUserId } from '@/http/context';
import { isBusinessMember, requireBusinessMember, requireSuperAdmin, isSuperAdmin } from '@/authz';
import { forbidden } from '@/http/errors';
import { adService } from '@/services/ads';

export const adsRouter = Router();

/**
 * The Home slot and the /deals feed. Public: guests browse Home too.
 *
 * `radiusKm` is the range the CUSTOMER picked in the feed and runs all the way
 * to ANY_RANGE_KM (20 000, "Anywhere") — deliberately not clamped to the Home
 * reach, because a wider look is more inventory delivered and costs the
 * advertiser nothing (only views from inside their bought band count).
 */
adsRouter.get('/placements', optionalAuth, route(async (req) => {
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const near =
    lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
      ? { latitude: lat, longitude: lng }
      : undefined;
  const radiusKm = num(req.query.radiusKm);
  return adService.listPlacements(near, radiusKm != null && !isNaN(radiusKm) ? radiusKm : undefined);
}));

/** The platform admin's queue: every campaign, newest first. */
adsRouter.get('/', requireAuth, route(async (req) => {
  await requireSuperAdmin(optionalUserId(req));
  return adService.listAll();
}));

adsRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return adService.listForBusiness(req.params.businessId);
}));

/**
 * Buy a slot. The body carries only WHICH offer and WHICH plan — days, amount,
 * target views and band are frozen from the plan by the service, and the status
 * is pinned to `pending`, so this cannot sell itself an approval.
 */
adsRouter.post('/', requireAuth, route(async (req) => {
  const uid = userId(req);
  const { businessId, offerId, planId, requestedByName } = req.body ?? {};
  await requireBusinessMember(businessId, uid);
  return adService.request({
    businessId,
    offerId,
    planId,
    requestedById: uid,
    requestedByName: requestedByName ?? '',
  });
}));

adsRouter.post('/:id/approve', requireAuth, route(async (req) => {
  await requireSuperAdmin(optionalUserId(req));
  return adService.approve(req.params.id, req.body?.note);
}));

adsRouter.post('/:id/reject', requireAuth, route(async (req) => {
  await requireSuperAdmin(optionalUserId(req));
  return adService.reject(req.params.id, req.body?.note);
}));

/** Pull a running ad early — by the business itself, or by an admin. */
adsRouter.post('/:id/stop', requireAuth, route(async (req) => {
  const uid = userId(req);
  const campaign = await adService.getById(req.params.id);
  const allowed = (await isBusinessMember(campaign.businessId, uid)) || (await isSuperAdmin(uid));
  if (!allowed) throw forbidden('Only this business or a platform admin can stop this ad.');
  return adService.stop(req.params.id);
}));

adsRouter.post('/:id/paid', requireAuth, route(async (req) => {
  await requireSuperAdmin(optionalUserId(req));
  return adService.setPaid(req.params.id, req.body?.paid === true);
}));

/**
 * Count a view or a tap. ANY caller, signed in or not — the card is shown to
 * guests, and a viewer has no write access to a stranger's campaign (which is
 * exactly what Path A's `ad_record_event` RPC exists to work around).
 *
 * ALWAYS 204, even on failure: this fires from a carousel someone is scrolling
 * past, and an error here would surface on a screen about something else.
 */
adsRouter.post('/:id/events', optionalAuth, route(async (req, res) => {
  const { kind, distanceKm } = (req.body ?? {}) as { kind?: string; distanceKm?: number };
  if (kind === 'impression' || kind === 'tap') {
    await adService.recordEvent(
      req.params.id,
      kind,
      typeof distanceKm === 'number' && isFinite(distanceKm) ? distanceKm : undefined,
    );
  }
  res.status(204).end();
}));
