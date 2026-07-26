import { Router } from 'express';
import type { BusinessQuery } from '@/domain/contracts';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireSuperAdmin } from '@/authz';
import { businessService } from '@/services/businesses';

export const businessesRouter = Router();

function parseQuery(q: Record<string, unknown>): BusinessQuery {
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const lat = num(q.lat);
  const lng = num(q.lng);
  return {
    search: typeof q.search === 'string' ? q.search : undefined,
    type: q.type as BusinessQuery['type'],
    subcategoryId: typeof q.subcategoryId === 'string' ? q.subcategoryId : undefined,
    near: lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? { latitude: lat, longitude: lng } : undefined,
    maxDistanceKm: q.maxDistanceKm != null ? num(q.maxDistanceKm) : undefined,
    sortByDistance: q.sortByDistance === 'true' || q.sortByDistance === true,
  };
}

businessesRouter.get('/', optionalAuth, route(async (req) => businessService.list(parseQuery(req.query))));

businessesRouter.get('/stall/owner/:ownerId', optionalAuth, route(async (req) =>
  businessService.getStallForOwner(req.params.ownerId),
));

businessesRouter.get('/:id', optionalAuth, route(async (req) => businessService.getById(req.params.id)));

businessesRouter.get('/:id/products/:productId', optionalAuth, route(async (req) =>
  businessService.getProduct(req.params.id, req.params.productId),
));

businessesRouter.post('/', requireAuth, route(async (req) => {
  const uid = userId(req);
  // Naming a foreign owner is a super-admin power; self-owned listings are open.
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';
  if (ownerId && ownerId !== uid) await requireSuperAdmin(uid);
  return businessService.create(req.body, uid);
}));

businessesRouter.post('/:id/reassign-owner', requireAuth, route(async (req) => {
  await requireSuperAdmin(optionalUserId(req));
  return businessService.reassignOwner(req.params.id, req.body.newOwnerId);
}));

businessesRouter.patch('/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.id, optionalUserId(req));
  return businessService.update(req.params.id, req.body);
}));

businessesRouter.post('/:id/products/:productId/sold', requireAuth, route(async (req) =>
  // Ownership is enforced inside the service via the actor id.
  businessService.setProductSold(req.params.id, req.params.productId, !!req.body.sold, userId(req)),
));

businessesRouter.delete('/:id/products/:productId', requireAuth, route(async (req) => {
  await businessService.removeProduct(req.params.id, req.params.productId, userId(req));
  return { ok: true };
}));
