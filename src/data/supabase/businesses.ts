/**
 * Supabase-backed BusinessRepository over the `businesses` table (public read),
 * with `employees` written alongside on create. Ratings are NOT stored on the
 * business (a customer can't update a business under RLS) — they're computed
 * live from the `reviews` table on read, which also keeps them drift-free.
 */
import type { Business, Employee, GeoPoint, OfferViewStats, ProductItem } from '@/domain/types';
import {
  compareSearchResults,
  intentSuggestion,
  withIntentMatches,
  type SearchResult,
  type SearchSuggestion,
} from '@/domain/search';
import { normalizeRole } from '@/domain/roles';
import type {
  BusinessQuery,
  BusinessRepository,
  NewBusinessInput,
} from '@/data/repositories';
import { haversineKm } from '@/lib/geo';
import type { NearbyQuery, NearbyScope, NearbySummary } from '@/domain/nearby';
import type { IntentCategory } from '@/domain/intents';
import { captureBusinessOfferings } from './catalog';
import { cardRows, forgetCardRows, peekCardRows, sb, uuid, nowIso, uuidOrNull } from './shared';

/** Stamp a stable id on any product that doesn't have one yet. */
const withProductIds = (products?: ProductItem[]): ProductItem[] | undefined =>
  products?.map((p) => (p.id ? p : { ...p, id: uuid() }));

/**
 * Ratings per business: businessId → { avg, count }. Averaged in SQL by the
 * `business_ratings` view (migration 0026) — never by downloading every review.
 * Without `ids` it returns every rated business (one small row each), which is
 * cheaper than an `IN` list of the whole directory in the URL.
 */
async function ratingsFor(ids?: string[]): Promise<Map<string, { avg: number; count: number }>> {
  const result = new Map<string, { avg: number; count: number }>();
  if (ids && ids.length === 0) return result;
  let q = sb().from('business_ratings').select('business_id, rating_avg, rating_count');
  if (ids) q = q.in('business_id', ids);
  const { data, error } = await q;
  if (error) throw error;
  for (const row of data ?? []) {
    result.set(row.business_id as string, {
      avg: Number(row.rating_avg ?? 0),
      count: Number(row.rating_count ?? 0),
    });
  }
  return result;
}

/** A row of `nearby_cards` (migration 0029). */
type NearbyRow = { data: Business; rating_avg: number | null; rating_count: number | null; distance_km: number | null };

/** Ids per request: a uuid list in the URL has to stay well under its length limit. */
const IDS_PER_READ = 150;

/** The cards (0026, rating joined on) of just these businesses, in parallel batches. */
async function cardsByIds(ids: string[]): Promise<Business[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) chunks.push(ids.slice(i, i + IDS_PER_READ));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await sb().from('business_cards').select('data, rating_avg, rating_count').in('id', chunk);
      if (error) throw error;
      return ((data ?? []) as Omit<NearbyRow, 'distance_km'>[]).map((r) =>
        r.rating_count ? { ...r.data, ratingAvg: r.rating_avg ?? 0, ratingCount: r.rating_count } : r.data,
      );
    }),
  );
  return pages.flat();
}

/**
 * `list` with `ids` / `ownerId` / `activeOnly`: filtered by Postgres, not on
 * the phone. Cards come from `business_cards` (0026, its `owner_id` added in
 * 0029), full documents from `businesses`; either way paged under PostgREST's
 * 1000-row cap.
 */
async function scopedRows(query: BusinessQuery): Promise<Business[]> {
  const table = query.summary ? 'business_cards' : 'businesses';
  const read = async (ids?: string[]): Promise<Business[]> => {
    const out: Business[] = [];
    for (let from = 0; ; from += 1000) {
      let q = sb().from(table).select(query.summary ? 'data, rating_avg, rating_count' : 'data');
      if (ids) q = q.in('id', ids);
      if (query.ownerId) q = q.eq('owner_id', query.ownerId);
      // The `listing_active` column (0029): the flag, missing = active (domain/listingActive.ts).
      if (query.activeOnly) q = q.eq('listing_active', true);
      const { data, error } = await q.order('id').range(from, from + 999);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<NearbyRow, 'distance_km'>[];
      for (const r of rows) out.push(r.rating_count ? { ...r.data, ratingAvg: r.rating_avg ?? 0, ratingCount: r.rating_count } : r.data);
      if (rows.length < 1000) break;
    }
    return out;
  };
  if (!query.ids) return read();
  const chunks: string[][] = [];
  for (let i = 0; i < query.ids.length; i += IDS_PER_READ) chunks.push(query.ids.slice(i, i + IDS_PER_READ));
  return (await Promise.all(chunks.map((c) => read(c)))).flat();
}

/** A row of `search_businesses` / `search_suggest` (migration 0027). */
type SearchRow = {
  business_id: string;
  words: number;
  tier: number;
  strength: number;
  score: number;
  hits: { name: string; price: string | null }[] | null;
};
type SuggestRow = {
  term: string;
  kind: SearchSuggestion['kind'];
  businesses: number;
  business_id: string | null;
};

function applyRatings(b: Business, ratings: Map<string, { avg: number; count: number }>): Business {
  const r = ratings.get(b.id);
  if (!r) return b;
  return { ...b, ratingAvg: r.avg, ratingCount: r.count };
}

export function createSupabaseBusinesses(): BusinessRepository {
  return {
    async list(query: BusinessQuery = {}): Promise<Business[]> {
      const term = query.search?.trim().toLowerCase();
      const { near, maxDistanceKm, sortByDistance, limit } = query;
      let results: Business[];
      let ratings = new Map<string, { avg: number; count: number }>();
      if (query.ids || query.ownerId || query.activeOnly) {
        // Scoped in the database (ratings joined on, like the cards).
        results = await scopedRows(query);
      } else if (query.summary) {
        // Cards only: the shared, catalog-free read with ratings already on it.
        results = await cardRows();
      } else {
        const [rowsR, r] = await Promise.all([
          sb().from('businesses').select('data'),
          ratingsFor(),
        ]);
        if (rowsR.error) throw rowsR.error;
        results = (rowsR.data ?? []).map((row) => row.data as Business);
        ratings = r;
      }

      results = results
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
          return { ...applyRatings(b, ratings), distanceKm };
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
      // After the sort, so `limit` with `sortByDistance` means "the N nearest".
      // Distance lives inside the `data` jsonb document, so it can only be
      // computed here — the trim has to happen after that, not as a PostgREST
      // `.limit()`, which would cut an arbitrary 100 rows before we know which
      // are close.
      return typeof limit === 'number' ? results.slice(0, limit) : results;
    },

    // Explore's feed, ranked and paged in the database (migration 0029, rules
    // in domain/nearby.ts) — the phone gets 20 cards, not the directory.
    async nearby(query: NearbyQuery): Promise<Business[]> {
      const { data, error } = await sb().rpc('nearby_cards', {
        p_lat: query.near?.latitude ?? null,
        p_lng: query.near?.longitude ?? null,
        p_radius_km: query.radiusKm ?? null,
        p_min_count: query.minCount,
        p_exclude_types: query.excludeTypes ?? [],
        p_types: query.intent ? (query.intent.types ?? []) : null,
        p_tags: query.intent ? query.intent.tags.map((t) => t.toLowerCase()) : null,
        p_sort: query.sort,
        p_seed: query.seed,
        p_offset: query.offset,
        p_limit: query.limit,
      });
      if (error) throw error;
      return ((data ?? []) as NearbyRow[]).map((r) => ({
        ...r.data,
        ...(r.rating_count ? { ratingAvg: r.rating_avg ?? 0, ratingCount: r.rating_count } : {}),
        distanceKm: r.distance_km ?? undefined,
      }));
    },

    async nearbySummary(scope: NearbyScope, intents: IntentCategory[]): Promise<NearbySummary> {
      const { data, error } = await sb().rpc('nearby_summary', {
        p_lat: scope.near?.latitude ?? null,
        p_lng: scope.near?.longitude ?? null,
        p_radius_km: scope.radiusKm ?? null,
        p_min_count: scope.minCount,
        p_exclude_types: scope.excludeTypes ?? [],
        p_intents: intents.map((i) => ({ id: i.id, types: i.types ?? [], tags: i.tags.map((t) => t.toLowerCase()) })),
      });
      if (error) throw error;
      const s = (data ?? {}) as { total?: number; reachKm?: number | null; counts?: Record<string, number> };
      return { total: s.total ?? 0, reachKm: s.reachKm ?? undefined, counts: s.counts ?? {} };
    },

    // Ranked in the database (migration 0027, rules in domain/search.ts); only
    // the matching businesses' cards are then read (0026), never the whole
    // directory — at 40,000 listings that was ~60 MB per search.
    async search(
      query: string,
      options: { near?: GeoPoint; limit?: number } = {},
    ): Promise<SearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      // Every match, not a top-N: relevance ties are broken by DISTANCE here,
      // and a cut made by score alone could drop the café round the corner.
      const rpc = await sb().rpc('search_businesses', { q, max_results: 1000 });
      if (rpc.error) throw rpc.error;
      const cards = await cardsByIds(((rpc.data ?? []) as SearchRow[]).map((r) => r.business_id));
      const { near } = options;
      const placed = (b: Business): Business => ({
        ...b,
        distanceKm: near && b.location?.point ? haversineKm(near, b.location.point) : undefined,
      });
      const byId = new Map(cards.map((b) => [b.id, b]));
      const found: SearchResult[] = [];
      for (const r of (rpc.data ?? []) as SearchRow[]) {
        const b = byId.get(r.business_id);
        if (!b) continue;
        found.push({
          business: placed(b),
          words: r.words,
          tier: r.tier,
          strength: r.strength,
          score: r.score,
          hits: (r.hits ?? []).map((h) => ({ name: h.name, price: h.price ?? undefined })),
        });
      }
      return withIntentMatches(found, cards.map(placed), q)
        .sort(compareSearchResults)
        .slice(0, options.limit ?? 100);
    },

    async suggest(query: string, limit = 8): Promise<SearchSuggestion[]> {
      const q = query.trim();
      if (q.length < 2) return [];
      const { data, error } = await sb().rpc('search_suggest', { q, max_results: limit });
      if (error) throw error;
      const terms = ((data ?? []) as SuggestRow[]).map(
        (r): SearchSuggestion => ({
          term: r.term,
          kind: r.kind,
          businesses: r.businesses,
          businessId: r.business_id ?? undefined,
        }),
      );
      // A browse category ("Food") stands for many tags; it leads when named.
      // Counted from the card list only if it's already loaded — a suggestion
      // must never wait on the whole directory.
      const intent = intentSuggestion(q, peekCardRows() ?? []);
      if (!intent) return terms;
      const rest = terms.filter((t) => t.term.toLowerCase() !== intent.term.toLowerCase());
      return [intent, ...rest].slice(0, limit);
    },

    async getById(id: string): Promise<Business | null> {
      const { data, error } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const ratings = await ratingsFor([id]);
      return applyRatings(data.data as Business, ratings);
    },

    async create(input: NewBusinessInput, ownerId: string): Promise<Business> {
      // A super-admin can list on someone else's behalf by naming the target
      // owner; the insert with a foreign owner_id is allowed only for them (see
      // migration 0004's businesses_insert policy). Ordinary registration
      // leaves it unset and the row is self-owned.
      const effectiveOwnerId = input.ownerId?.trim() || ownerId;

      // Personal stalls: a user has ONE 'item' listing. Adding another item folds
      // its products into the existing stall instead of creating a new listing.
      if (input.type === 'item') {
        const { data: existing } = await sb()
          .from('businesses')
          .select('data')
          .eq('owner_id', effectiveOwnerId)
          .eq('type', 'item')
          .maybeSingle();
        if (existing) {
          const stall = existing.data as Business;
          const next: Business = {
            ...stall,
            products: [...(stall.products ?? []), ...(withProductIds(input.products) ?? [])],
          };
          const { error } = await sb().from('businesses').update({ data: next }).eq('id', stall.id);
          if (error) throw error;
          forgetCardRows();
          await captureBusinessOfferings(next);
          return next;
        }
      }

      const businessId = uuid();
      const newEmployees: Employee[] = input.employees.map((emp) => ({
        id: uuid(),
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
        // Listed for someone else: inactive until they sign in (migration 0028).
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
        // `openNow` is deliberately NOT set. It is the legacy fallback badge for
        // listings with no structured hours (domain/hours.ts), so stamping it
        // `true` at creation made every listing that skipped the optional hours
        // step claim "Open now" round the clock, for good. Left undefined, the
        // page shows no open/closed chip until the owner sets real hours.
        rentalBasis: input.rentalBasis,
        rentals: input.rentals,
        rentalStatus: input.rentalBasis ? 'available' : undefined,
        createdAt: nowIso(),
      };

      // Business first (RLS on employees checks membership, which needs the row).
      const { error: bErr } = await sb()
        .from('businesses')
        .insert({ id: businessId, owner_id: effectiveOwnerId, type: input.type, data: business });
      if (bErr) throw bErr;
      forgetCardRows();

      if (newEmployees.length > 0) {
        const { error: eErr } = await sb().from('employees').insert(
          newEmployees.map((e) => ({
            id: e.id,
            business_id: businessId,
            user_id: uuidOrNull(e.userId),
            data: e,
          })),
        );
        if (eErr) throw eErr;
      }
      // Grow the collection with anything new this listing offers.
      await captureBusinessOfferings(business);
      return business;
    },

    async getStallForOwner(ownerId: string): Promise<Business | null> {
      const { data, error } = await sb()
        .from('businesses')
        .select('data')
        .eq('owner_id', ownerId)
        .eq('type', 'item')
        .maybeSingle();
      if (error) throw error;
      return data ? (data.data as Business) : null;
    },

    async getProduct(businessId: string, productId: string): Promise<ProductItem | null> {
      const { data, error } = await sb()
        .from('businesses')
        .select('data')
        .eq('id', businessId)
        .maybeSingle();
      if (error) throw error;
      const product = (data?.data as Business | undefined)?.products?.find((p) => p.id === productId);
      return product ?? null;
    },

    async setProductSold(
      businessId: string,
      productId: string,
      sold: boolean,
      actorId: string,
    ): Promise<ProductItem> {
      const business = await this.getById(businessId);
      if (!business) throw new Error(`Business ${businessId} not found`);
      if (business.ownerId !== actorId) throw new Error('Only the seller can mark an item sold.');
      const products = business.products ?? [];
      const product = products.find((p) => p.id === productId);
      if (!product) throw new Error(`Product ${productId} not found`);
      const nextProducts = products.map((p) => (p.id === productId ? { ...p, sold } : p));
      const { error } = await sb()
        .from('businesses')
        .update({ data: { ...business, products: nextProducts } })
        .eq('id', businessId);
      if (error) throw error;
      forgetCardRows();
      return { ...product, sold };
    },

    async removeProduct(businessId: string, productId: string, actorId: string): Promise<void> {
      const business = await this.getById(businessId);
      if (!business) throw new Error(`Business ${businessId} not found`);
      if (business.ownerId !== actorId) throw new Error('Only the seller can remove an item.');
      const nextProducts = (business.products ?? []).filter((p) => p.id !== productId);
      const { error } = await sb()
        .from('businesses')
        .update({ data: { ...business, products: nextProducts } })
        .eq('id', businessId);
      if (error) throw error;
      forgetCardRows();
      // The item's public thread goes with it — nothing left to read.
      await sb()
        .from('product_messages')
        .delete()
        .eq('business_id', businessId)
        .eq('product_id', productId);
    },

    async update(id: string, patch: Partial<Business>): Promise<Business> {
      const current = await this.getById(id);
      if (!current) throw new Error(`Business ${id} not found`);
      const next: Business = { ...current, ...patch };
      if (patch.products) next.products = withProductIds(patch.products);
      // ratingAvg/ratingCount are derived on read — never persist them.
      delete (next as { ratingAvg?: number }).ratingAvg;
      delete (next as { ratingCount?: number }).ratingCount;
      delete (next as { distanceKm?: number }).distanceKm;
      delete (next as { catalogCounts?: unknown }).catalogCounts;
      const { error } = await sb().from('businesses').update({ data: next }).eq('id', id);
      if (error) throw error;
      forgetCardRows();
      // Manage edits add new tags/menu/services/products — capture those too.
      if (patch.tags || patch.menu || patch.services || patch.plans || patch.products) {
        await captureBusinessOfferings(next);
      }
      return this.getById(id) as Promise<Business>;
    },

    // Viewers are strangers to the business and can't write its row, so a view
    // goes through the SECURITY DEFINER `offer_record_view` RPC (migration
    // 0025), which only ever adds 1 to an offer that exists. Never throws.
    async recordOfferView(businessId: string, offerId: string): Promise<void> {
      try {
        await sb().rpc('offer_record_view', { p_business_id: businessId, p_offer_id: offerId });
      } catch {
        /* engagement, not billing */
      }
    },

    // RLS lets only the business's team read `offer_views`.
    async listOfferViews(businessId: string): Promise<OfferViewStats[]> {
      const { data, error } = await sb()
        .from('offer_views')
        .select('offer_id, day, views')
        .eq('business_id', businessId);
      if (error) throw error;
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const byOffer = new Map<string, OfferViewStats>();
      for (const row of (data ?? []) as { offer_id: string; day: string; views: number }[]) {
        const s = byOffer.get(row.offer_id) ?? { offerId: row.offer_id, total: 0, today: 0 };
        s.total += Number(row.views);
        if (row.day === today) s.today += Number(row.views);
        byOffer.set(row.offer_id, s);
      }
      return [...byOffer.values()];
    },

    async reassignOwner(id: string, newOwnerId: string): Promise<Business> {
      const current = await this.getById(id);
      if (!current) throw new Error(`Business ${id} not found`);
      const next: Business = { ...current, ownerId: newOwnerId };
      delete (next as { ratingAvg?: number }).ratingAvg;
      delete (next as { ratingCount?: number }).ratingCount;
      delete (next as { distanceKm?: number }).distanceKm;
      delete (next as { catalogCounts?: unknown }).catalogCounts;
      // Update BOTH the scoping column and the document — is_business_member and
      // getStallForOwner key on the column, everything else reads data.ownerId.
      // RLS allows this only for a super-admin (migration 0004).
      const { error } = await sb()
        .from('businesses')
        .update({ owner_id: newOwnerId, data: next })
        .eq('id', id);
      if (error) throw error;
      forgetCardRows();
      return this.getById(id) as Promise<Business>;
    },

    async remove(id: string, actorId: string): Promise<void> {
      const current = await this.getById(id);
      if (!current) throw new Error(`Business ${id} not found`);
      // RLS (`businesses_delete`, migration 0002) allows the owner only, and a
      // blocked delete comes back as 0 rows rather than an error — so say what
      // happened instead of reporting a silent success.
      if (current.ownerId !== actorId) {
        throw new Error('Only the owner can take a listing down.');
      }
      const { error } = await sb().from('businesses').delete().eq('id', id);
      if (error) throw error;
      forgetCardRows();
      // Everything scoped to the business (team, orders, bills, chats, calls,
      // campaigns) is removed by the schema's `on delete cascade`.
    },
  };
}
