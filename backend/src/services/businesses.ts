/** Businesses + stall products — ports MockBusinessRepository. */
import { Prisma } from '@prisma/client';
import type { Business, Employee, GeoPoint, OfferViewStats, ProductItem } from '@/domain/types';
import type {
  BusinessQuery,
  NearbyIntent,
  NearbyQuery,
  NearbyScope,
  NearbySummary,
  NewBusinessInput,
  SearchResult,
  SearchSuggestion,
} from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, isUuid, toJson, uuidOrNull } from '@/lib/data';
import { normalizeRole } from '@/lib/roles';
import { haversineKm } from '@/lib/geo';
import { forbidden, notFound } from '@/http/errors';
import { captureBusinessOfferings } from './catalog';

/** Stamp stable ids onto products that don't have one yet. */
const withProductIds = (products?: ProductItem[]): ProductItem[] | undefined =>
  products?.map((p) => (p.id ? p : { ...p, id: newUuid() }));

/**
 * A business document with its rating joined on. Ratings are averaged in SQL
 * by the `business_ratings` view (migration 0026), the same source Path A
 * reads, never by loading review rows.
 */
type RatedRow = { data: Prisma.JsonValue; rating_avg: number | null; rating_count: number | null };

const withRating = (r: RatedRow): Business => {
  const b = r.data as unknown as Business;
  return r.rating_count
    ? { ...b, ratingAvg: Number(r.rating_avg ?? 0), ratingCount: Number(r.rating_count) }
    : b;
};

/**
 * The documents `list` works over, filtered in Postgres by ids / owner /
 * active (SYNC-053). Summary mode reads the `business_cards` view (the
 * document minus menu/products/services/plans/rentals/portfolio, 0026/0029),
 * so the catalogs never leave the database; full mode reads whole documents.
 */
async function readRows(query: BusinessQuery): Promise<Business[]> {
  const where: Prisma.Sql[] = [];
  if (query.ids) {
    // A non-uuid id can't name a business, and would fail the ::uuid cast.
    const ids = query.ids.filter(isUuid);
    if (ids.length === 0) return [];
    where.push(Prisma.sql`b.id = any(${ids}::uuid[])`);
  }
  if (query.ownerId && !isUuid(query.ownerId)) return [];
  if (query.ownerId) where.push(Prisma.sql`b.owner_id = ${query.ownerId}::uuid`);
  // The generated `listing_active` column (0029): a missing flag reads as active.
  if (query.activeOnly) where.push(Prisma.sql`b.listing_active`);
  const clause = where.length ? Prisma.sql`where ${Prisma.join(where, ' and ')}` : Prisma.empty;
  const rows = query.summary
    ? await prisma.$queryRaw<RatedRow[]>`
        select b.data, b.rating_avg, b.rating_count from public.business_cards b ${clause}`
    : await prisma.$queryRaw<RatedRow[]>`
        select b.data, r.rating_avg, r.rating_count
        from public.businesses b
        left join public.business_ratings r on r.business_id = b.id ${clause}`;
  return rows.map(withRating);
}

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

/** The India-time date: what "today" means to every business on the platform. */
const indiaToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Order two search results: words, tier, strength, nearest, score (src/domain/search.ts). */
function compareSearchResults(a: SearchResult, b: SearchResult): number {
  return (
    b.words - a.words ||
    b.tier - a.tier ||
    b.strength - a.strength ||
    (a.business.distanceKm ?? Infinity) - (b.business.distanceKm ?? Infinity) ||
    b.score - a.score
  );
}

type SearchRow = {
  business_id: string;
  words: number;
  tier: number;
  strength: number;
  score: number;
  hits: { name: string; price: string | null }[] | null;
};
type SuggestRow = { term: string; kind: SearchSuggestion['kind']; businesses: number; business_id: string | null };
type SummaryRow = { s: { total?: number; reachKm?: number | null; counts?: Record<string, number> } | null };

/** Persist a business's `data` (and keep the `type` scoping column in step). */
async function saveBusiness(business: Business): Promise<Business> {
  await prisma.business.update({
    where: { id: business.id },
    data: { type: business.type, data: toJson(business) },
  });
  return business;
}

export const businessService = {
  async list(query: BusinessQuery = {}): Promise<Business[]> {
    const term = query.search?.trim().toLowerCase();
    const { near, maxDistanceKm, sortByDistance, limit } = query;

    const results = (await readRows(query))
      .filter((b) => (query.type ? b.type === query.type : true))
      .filter((b) =>
        query.subcategoryId
          ? b.subcategoryId === query.subcategoryId ||
            (b.products ?? []).some((p) => p.subcategoryId === query.subcategoryId)
          : true,
      )
      .filter((b) => {
        if (!term) return true;
        return [
          b.name,
          b.tagline,
          b.description,
          b.providerType,
          ...(b.tags ?? []),
          ...(b.products ?? []).map((p) => p.name),
          ...(b.menu ?? []).map((m) => m.name),
          ...(b.services ?? []).map((s) => s.name),
          ...(b.plans ?? []).map((p) => p.name),
          ...(b.rentals ?? []).map((r) => r.name),
        ]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(term));
      })
      .map((b): Business => {
        const point = b.location?.point;
        const distanceKm = near && point ? haversineKm(near, point) : undefined;
        return { ...b, distanceKm };
      })
      .filter((b) => {
        if (typeof maxDistanceKm !== 'number' || !near) return true;
        return typeof b.distanceKm === 'number' && b.distanceKm <= maxDistanceKm;
      });

    results.sort((a, b) =>
      sortByDistance
        ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
        : b.createdAt.localeCompare(a.createdAt),
    );
    // After the sort, so `limit` + `sortByDistance` means "the N nearest".
    return typeof limit === 'number' ? results.slice(0, limit) : results;
  },

  async getById(id: string): Promise<Business | null> {
    if (!isUuid(id)) return null;
    const rows = await prisma.$queryRaw<RatedRow[]>`
      select b.data, r.rating_avg, r.rating_count
      from public.businesses b
      left join public.business_ratings r on r.business_id = b.id
      where b.id = ${id}::uuid`;
    return rows[0] ? withRating(rows[0]) : null;
  },

  /** Explore's feed, ranked and paged in the database (`nearby_cards`, 0029). */
  async nearby(q: NearbyQuery): Promise<Business[]> {
    const rows = await prisma.$queryRaw<(RatedRow & { distance_km: number | null })[]>`
      select * from public.nearby_cards(
        ${q.near?.latitude ?? null}::float8, ${q.near?.longitude ?? null}::float8,
        ${q.radiusKm ?? null}::float8, ${q.minCount}::int,
        ${q.excludeTypes ?? []}::text[],
        ${q.intent ? (q.intent.types ?? []) : null}::text[],
        ${q.intent ? q.intent.tags.map((t) => t.toLowerCase()) : null}::text[],
        ${q.sort}::text, ${q.seed}::int, ${q.offset}::int, ${q.limit}::int)`;
    return rows.map((r) => ({ ...withRating(r), distanceKm: r.distance_km ?? undefined }));
  },

  /** The feed header's numbers over the WHOLE pool (`nearby_summary`, 0029). */
  async nearbySummary(scope: NearbyScope, intents: NearbyIntent[]): Promise<NearbySummary> {
    const payload = JSON.stringify(
      intents.map((i) => ({ id: i.id, types: i.types ?? [], tags: i.tags.map((t) => t.toLowerCase()) })),
    );
    const rows = await prisma.$queryRaw<SummaryRow[]>`
      select public.nearby_summary(
        ${scope.near?.latitude ?? null}::float8, ${scope.near?.longitude ?? null}::float8,
        ${scope.radiusKm ?? null}::float8, ${scope.minCount}::int,
        ${scope.excludeTypes ?? []}::text[], ${payload}::jsonb) as s`;
    const s = rows[0]?.s ?? {};
    return { total: s.total ?? 0, reachKm: s.reachKm ?? undefined, counts: s.counts ?? {} };
  },

  /**
   * Ranked in the database (`search_businesses`, 0027); only the matching
   * businesses' cards are then read. Every match is fetched, not a top-N:
   * relevance ties break on DISTANCE, so a cut by score alone could drop the
   * café round the corner. The browse-category fold-in (`withIntentMatches`)
   * runs in the api client, where the intent catalog lives.
   */
  async search(query: string, options: { near?: GeoPoint; limit?: number } = {}): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const rows = await prisma.$queryRaw<SearchRow[]>`select * from public.search_businesses(${q}, 1000)`;
    const cards = await readRows({ ids: rows.map((r) => r.business_id), summary: true });
    const byId = new Map(cards.map((b) => [b.id, b]));
    const { near } = options;
    const found: SearchResult[] = [];
    for (const r of rows) {
      const b = byId.get(r.business_id);
      if (!b) continue;
      found.push({
        business: { ...b, distanceKm: near && b.location?.point ? haversineKm(near, b.location.point) : undefined },
        words: Number(r.words),
        tier: Number(r.tier),
        strength: Number(r.strength),
        score: Number(r.score),
        hits: (r.hits ?? []).map((h) => ({ name: h.name, price: h.price ?? undefined })),
      });
    }
    return found.sort(compareSearchResults).slice(0, options.limit ?? 100);
  },

  /** Autocomplete terms (`search_suggest`, 0027). */
  async suggest(query: string, limit = 8): Promise<SearchSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const rows = await prisma.$queryRaw<SuggestRow[]>`select * from public.search_suggest(${q}, ${limit}::int)`;
    return rows.map((r) => ({
      term: r.term,
      kind: r.kind,
      businesses: Number(r.businesses),
      businessId: r.business_id ?? undefined,
    }));
  },

  /**
   * Count one view of an offer (`offer_record_view`, 0025 — it ignores offers
   * the business doesn't have). Engagement, not billing: never throws.
   */
  async recordOfferView(businessId: string, offerId: string): Promise<void> {
    if (!isUuid(businessId)) return;
    try {
      await prisma.$executeRaw`select public.offer_record_view(${businessId}::uuid, ${offerId})`;
    } catch {
      /* best-effort */
    }
  },

  /** Views per offer, all-time and today (India time). */
  async listOfferViews(businessId: string): Promise<OfferViewStats[]> {
    if (!isUuid(businessId)) return [];
    const rows = await prisma.$queryRaw<{ offer_id: string; day: Date; views: bigint }[]>`
      select offer_id, day, views from public.offer_views where business_id = ${businessId}::uuid`;
    const today = indiaToday();
    const byOffer = new Map<string, OfferViewStats>();
    for (const r of rows) {
      const s = byOffer.get(r.offer_id) ?? { offerId: r.offer_id, total: 0, today: 0 };
      const views = Number(r.views);
      s.total += views;
      if (r.day.toISOString().slice(0, 10) === today) s.today += views;
      byOffer.set(r.offer_id, s);
    }
    return [...byOffer.values()];
  },

  async getStallForOwner(ownerId: string): Promise<Business | null> {
    const rows = await prisma.business.findMany({ where: { ownerId, type: 'item' } });
    return rows[0] ? asData<Business>(rows[0]) : null;
  },

  async create(input: NewBusinessInput, ownerId: string): Promise<Business> {
    // A super-admin can list on someone else's behalf (input.ownerId); the
    // router has already verified they're allowed to name a foreign owner.
    const effectiveOwnerId = input.ownerId?.trim() || ownerId;

    // Personal stalls: one 'item' listing per user; fold new products in.
    if (input.type === 'item') {
      const stall = await this.getStallForOwner(effectiveOwnerId);
      if (stall) {
        stall.products = [...(stall.products ?? []), ...(withProductIds(input.products) ?? [])];
        const saved = await saveBusiness(stall);
        await captureBusinessOfferings(saved);
        return saved;
      }
    }

    const businessId = newUuid();
    const newEmployees: Employee[] = input.employees.map((emp) => ({
      id: newUuid(),
      businessId,
      displayName: emp.displayName,
      role: normalizeRole(emp.role),
      level: emp.level ?? 'staff',
      userId: emp.userId,
    }));
    const employeeIds = newEmployees.map((e) => e.id);

    const business: Business = {
      id: businessId,
      ownerId: effectiveOwnerId,
      // Listed for someone else: inactive until they sign in (trigger, 0028).
      ...(effectiveOwnerId !== ownerId ? { listingActive: false } : {}),
      name: input.name,
      tagline: input.tagline,
      description: input.description,
      type: input.type,
      subcategoryId: input.subcategoryId,
      tags: input.tags,
      location: input.location,
      phone: input.phone,
      email: input.email,
      website: input.website,
      priceLabel: input.priceLabel,
      menu: input.menu,
      services: input.services,
      plans: input.plans,
      products: withProductIds(input.products),
      hours: input.hours,
      openingHours: input.openingHours,
      modules: input.modules,
      employeeIds,
      callHandlerIds: employeeIds,
      ownerHandlesCalls: true,
      chatRecipientIds: employeeIds,
      // ⚠️ `openNow` is deliberately NOT stamped. It is the LEGACY fallback the
      // open/closed badge uses when a listing has no structured `openingHours`
      // (`openState()` in src/domain/hours.ts) — and hours are an OPTIONAL step
      // in the register wizard, so writing `true` here marked every listing that
      // skipped it permanently "Open now", 3 a.m. included, with Manage showing
      // "Opening hours: Not set" right beside it. Left undefined, the page shows
      // no open/closed chip until the owner sets real hours.
      rentalBasis: input.rentalBasis,
      rentals: input.rentals,
      rentalStatus: input.rentalBasis ? 'available' : undefined,
      createdAt: new Date().toISOString(),
    };

    await prisma.business.create({
      data: { id: businessId, ownerId: effectiveOwnerId, type: business.type, data: toJson(business) },
    });
    if (newEmployees.length) {
      await prisma.employee.createMany({
        data: newEmployees.map((e) => ({
          id: e.id,
          businessId,
          userId: uuidOrNull(e.userId),
          data: toJson(e),
        })),
      });
    }
    await captureBusinessOfferings(business);
    return business;
  },

  async getProduct(businessId: string, productId: string): Promise<ProductItem | null> {
    const business = await findBusiness(businessId);
    return business?.products?.find((p) => p.id === productId) ?? null;
  },

  async setProductSold(
    businessId: string,
    productId: string,
    sold: boolean,
    actorId: string,
  ): Promise<ProductItem> {
    const business = await findBusiness(businessId);
    if (!business) throw notFound(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can mark an item sold.');
    const product = business.products?.find((p) => p.id === productId);
    if (!product) throw notFound(`Product ${productId} not found`);
    product.sold = sold;
    await saveBusiness(business);
    return product;
  },

  async removeProduct(businessId: string, productId: string, actorId: string): Promise<void> {
    const business = await findBusiness(businessId);
    if (!business) throw notFound(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can remove an item.');
    business.products = (business.products ?? []).filter((p) => p.id !== productId);
    await saveBusiness(business);
    // The item's public thread goes with it.
    await prisma.productMessage.deleteMany({ where: { businessId, productId } });
  },

  /**
   * Update a business.
   *
   * ⚠️ OWNERSHIP IS NOT PATCHABLE. `requireBusinessMember` on the route never
   * inspects who owns the listing, so without this a staff member could
   * `PATCH {"ownerId": "<me>"}` and simply take the shop — the app reads
   * `data.ownerId`, so rewriting the document alone was enough. Ownership moves
   * only through `reassignOwner`, and the document is force-synced to the
   * `owner_id` COLUMN on every write so the two can never drift apart.
   */
  async update(id: string, patch: Partial<Business>): Promise<Business> {
    const row = await prisma.business.findUnique({ where: { id }, select: { ownerId: true } });
    if (!row) throw notFound(`Business ${id} not found`);
    const business = await findBusiness(id);
    if (!business) throw notFound(`Business ${id} not found`);
    const { ownerId: _ignoredOwner, id: _ignoredId, ...safePatch } = patch;
    Object.assign(business, safePatch);
    // The column is the single source of truth for who owns this listing.
    business.ownerId = row.ownerId;
    business.id = id;
    // Derived on read, never stored (same as Path A): ratings come from
    // `business_ratings`, distance from the viewer, counts from the card. A
    // client saving back what it read must not freeze them into the document.
    delete business.ratingAvg;
    delete business.ratingCount;
    delete business.distanceKm;
    delete business.catalogCounts;
    if (patch.products) business.products = withProductIds(patch.products);
    const saved = await saveBusiness(business);
    // Capture new offerings when the listing's tags/menu/services/products change.
    if (patch.tags || patch.menu || patch.services || patch.plans || patch.products) {
      await captureBusinessOfferings(saved);
    }
    return saved;
  },

  /**
   * The OWNER takes a listing down for good.
   *
   * ⚠️ THE OWNER CHECK IS THE WHOLE GUARD. Prisma connects privileged and
   * bypasses RLS, so unlike Path A — where `businesses_delete` (migration 0002)
   * would refuse a stranger's delete on its own — nothing else stands between a
   * staff member and someone else's shop. Do NOT weaken this to
   * `isBusinessMember`, and do NOT add a super-admin bypass: an admin who needs
   * a stranger's listing gone uses `reassignOwner` first, deliberately, so the
   * deletion is always someone deleting their own thing.
   *
   * Everything scoped to the business (team, orders, bills, chats, calls,
   * memberships, reviews, product threads, vehicles, ad campaigns) goes with it
   * through the schema's `on delete cascade` — the mock's hand-written
   * `dropByBusiness` mirrors those same foreign keys.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const business = await findBusiness(id);
    if (!business) throw notFound(`Business ${id} not found`);
    if (business.ownerId !== actorId) {
      throw forbidden('Only the owner can take a listing down.');
    }
    await prisma.business.delete({ where: { id } });
  },

  async reassignOwner(id: string, newOwnerId: string): Promise<Business> {
    const business = await findBusiness(id);
    if (!business) throw notFound(`Business ${id} not found`);
    business.ownerId = newOwnerId;
    // Keep the scoping column in step so membership checks follow the new owner.
    await prisma.business.update({
      where: { id },
      data: { ownerId: newOwnerId, data: toJson(business) },
    });
    return business;
  },
};
