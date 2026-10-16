import { Router } from 'express';
import type { BusinessQuery, NearbyIntent, NearbyQuery, NearbyScope } from '@/domain/contracts';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId, optionalUserId } from '@/http/context';
import { isSuperAdmin, requireBusinessManager, requireBusinessMember, requireSuperAdmin } from '@/authz';
import { businessService } from '@/services/businesses';

export const businessesRouter = Router();

const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
const bool = (v: unknown) => v === 'true' || v === true;
/** A comma list off the query string; `undefined` when the key is absent. */
const list = (v: unknown): string[] | undefined =>
  typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
const point = (q: Record<string, unknown>) => {
  const lat = num(q.lat);
  const lng = num(q.lng);
  return lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? { latitude: lat, longitude: lng } : undefined;
};

function parseScope(q: Record<string, unknown>): NearbyScope {
  return {
    near: point(q),
    radiusKm: num(q.radiusKm),
    minCount: num(q.minCount) ?? 0,
    excludeTypes: list(q.excludeTypes) as NearbyScope['excludeTypes'],
  };
}

function parseQuery(q: Record<string, unknown>): BusinessQuery {
  const lat = num(q.lat);
  const lng = num(q.lng);
  return {
    search: typeof q.search === 'string' ? q.search : undefined,
    type: q.type as BusinessQuery['type'],
    subcategoryId: typeof q.subcategoryId === 'string' ? q.subcategoryId : undefined,
    near: lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? { latitude: lat, longitude: lng } : undefined,
    maxDistanceKm: q.maxDistanceKm != null ? num(q.maxDistanceKm) : undefined,
    sortByDistance: bool(q.sortByDistance),
    limit: q.limit != null ? num(q.limit) : undefined,
    summary: bool(q.summary),
    ids: list(q.ids),
    ownerId: typeof q.ownerId === 'string' && q.ownerId ? q.ownerId : undefined,
    activeOnly: bool(q.activeOnly),
  };
}

businessesRouter.get('/', optionalAuth, route(async (req) => businessService.list(parseQuery(req.query))));

// ── Database-paged reads (public, guests too). Declared before '/:id'. ──

/** Ranked search (SYNC-051): `?q=&lat=&lng=&limit=`. */
businessesRouter.get('/search', optionalAuth, route(async (req) =>
  businessService.search(String(req.query.q ?? ''), {
    near: point(req.query),
    limit: num(req.query.limit),
  }),
));

/** Autocomplete (SYNC-051): `?q=&limit=`. */
businessesRouter.get('/suggest', optionalAuth, route(async (req) =>
  businessService.suggest(String(req.query.q ?? ''), num(req.query.limit) ?? 8),
));

/**
 * One page of the Explore feed (SYNC-053). `types`/`tags` (comma lists) are
 * the browse category; sending either key (even empty) means "a category",
 * omitting both means "everything in the pool". No `radiusKm` = no ring.
 */
businessesRouter.get('/nearby', optionalAuth, route(async (req) => {
  const q = req.query as Record<string, unknown>;
  const types = list(q.types);
  const tags = list(q.tags);
  const query: NearbyQuery = {
    ...parseScope(q),
    intent: types || tags ? { tags: tags ?? [], types: (types ?? []) as NearbyIntent['types'] } : undefined,
    sort: (['shuffle', 'nearest', 'popular'].includes(String(q.sort)) ? q.sort : 'shuffle') as NearbyQuery['sort'],
    seed: num(q.seed) ?? 0,
    offset: num(q.offset) ?? 0,
    limit: num(q.limit) ?? 20,
  };
  return businessService.nearby(query);
}));

/** The feed header's numbers (SYNC-053). Body: `{ scope, intents }`. */
businessesRouter.post('/nearby/summary', optionalAuth, route(async (req) => {
  const body = (req.body ?? {}) as { scope?: NearbyScope; intents?: NearbyIntent[] };
  const scope = body.scope ?? { minCount: 0 };
  return businessService.nearbySummary(
    { ...scope, minCount: Number(scope.minCount ?? 0) },
    Array.isArray(body.intents) ? body.intents : [],
  );
}));

businessesRouter.get('/stall/owner/:ownerId', optionalAuth, route(async (req) =>
  businessService.getStallForOwner(req.params.ownerId),
));

businessesRouter.get('/:id', optionalAuth, route(async (req) => businessService.getById(req.params.id)));

businessesRouter.get('/:id/products/:productId', optionalAuth, route(async (req) =>
  businessService.getProduct(req.params.id, req.params.productId),
));

/** Count a view of an offer (SYNC-049). PUBLIC — anonymous viewers count. Always 204. */
businessesRouter.post('/:id/offers/:offerId/views', optionalAuth, route(async (req, res) => {
  await businessService.recordOfferView(req.params.id, req.params.offerId);
  res.status(204).end();
}));

/** Views per offer (SYNC-049): the business team, or a super-admin. */
businessesRouter.get('/:id/offer-views', requireAuth, route(async (req) => {
  const uid = optionalUserId(req);
  if (!(await isSuperAdmin(uid))) await requireBusinessMember(req.params.id, uid);
  return businessService.listOfferViews(req.params.id);
}));

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

/**
 * Keys that decide who can answer calls, read chats, and what the workspace
 * can do. Staff may edit the listing, but rewiring the TEAM is manager+ work —
 * otherwise a staff member could quietly make themselves the only call handler.
 * (`ownerId` needs no entry here: the service refuses to patch it at all.)
 */
const MANAGER_ONLY_KEYS = [
  'employeeIds',
  'callHandlerIds',
  'chatRecipientIds',
  'scanHandlerIds',
  'modules',
] as const;

businessesRouter.patch('/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.id, optionalUserId(req));
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (MANAGER_ONLY_KEYS.some((k) => k in body)) {
    await requireBusinessManager(req.params.id, optionalUserId(req));
  }
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

/**
 * Take a listing down for good. OWNER ONLY — the actor is the JWT's user, never
 * a body field, and the service refuses anyone else (403). Postgres cascades
 * the team, orders, bills, chats, calls, memberships, reviews, threads,
 * vehicles and ad campaigns behind it.
 */
businessesRouter.delete('/:id', requireAuth, route(async (req, res) => {
  await businessService.remove(req.params.id, userId(req));
  res.status(204).end();
}));
