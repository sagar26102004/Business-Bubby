/**
 * Supabase-backed BusinessRepository over the `businesses` table (public read),
 * with `employees` written alongside on create. Ratings are NOT stored on the
 * business (a customer can't update a business under RLS) — they're computed
 * live from the `reviews` table on read, which also keeps them drift-free.
 */
import type { Business, Employee, ProductItem } from '@/domain/types';
import { normalizeRole } from '@/domain/roles';
import type {
  BusinessQuery,
  BusinessRepository,
  NewBusinessInput,
} from '@/data/repositories';
import { haversineKm } from '@/lib/geo';
import { sb, uuid, nowIso, uuidOrNull } from './shared';

/** Stamp a stable id on any product that doesn't have one yet. */
const withProductIds = (products?: ProductItem[]): ProductItem[] | undefined =>
  products?.map((p) => (p.id ? p : { ...p, id: uuid() }));

/** Aggregate ratings from the reviews table: businessId → { avg, count }. */
async function ratingsFor(businessIds: string[]): Promise<Map<string, { avg: number; count: number }>> {
  const out = new Map<string, { sum: number; count: number }>();
  if (businessIds.length === 0) return new Map();
  const { data, error } = await sb()
    .from('reviews')
    .select('business_id, data')
    .in('business_id', businessIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const bid = row.business_id as string;
    const rating = (row.data as { rating: number }).rating ?? 0;
    const cur = out.get(bid) ?? { sum: 0, count: 0 };
    cur.sum += rating;
    cur.count += 1;
    out.set(bid, cur);
  }
  const result = new Map<string, { avg: number; count: number }>();
  out.forEach((v, k) => result.set(k, { avg: Math.round((v.sum / v.count) * 10) / 10, count: v.count }));
  return result;
}

function applyRatings(b: Business, ratings: Map<string, { avg: number; count: number }>): Business {
  const r = ratings.get(b.id);
  if (!r) return b;
  return { ...b, ratingAvg: r.avg, ratingCount: r.count };
}

export function createSupabaseBusinesses(): BusinessRepository {
  return {
    async list(query: BusinessQuery = {}): Promise<Business[]> {
      const term = query.search?.trim().toLowerCase();
      const { near, maxDistanceKm, sortByDistance } = query;
      const { data, error } = await sb().from('businesses').select('data');
      if (error) throw error;
      let results = (data ?? []).map((r) => r.data as Business);
      const ratings = await ratingsFor(results.map((b) => b.id));

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
      return results;
    },

    async getById(id: string): Promise<Business | null> {
      const { data, error } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const ratings = await ratingsFor([id]);
      return applyRatings(data.data as Business, ratings);
    },

    async create(input: NewBusinessInput, ownerId: string): Promise<Business> {
      // Personal stalls: a user has ONE 'item' listing. Adding another item folds
      // its products into the existing stall instead of creating a new listing.
      if (input.type === 'item') {
        const { data: existing } = await sb()
          .from('businesses')
          .select('data')
          .eq('owner_id', ownerId)
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
        ownerId,
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
        products: withProductIds(input.products),
        modules: input.modules,
        employeeIds,
        callHandlerIds: employeeIds,
        ownerHandlesCalls: true,
        chatRecipientIds: employeeIds,
        openNow: true,
        rentalBasis: input.rentalBasis,
        rentals: input.rentals,
        rentalStatus: input.rentalBasis ? 'available' : undefined,
        createdAt: nowIso(),
      };

      // Business first (RLS on employees checks membership, which needs the row).
      const { error: bErr } = await sb()
        .from('businesses')
        .insert({ id: businessId, owner_id: ownerId, type: input.type, data: business });
      if (bErr) throw bErr;

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
      const { error } = await sb().from('businesses').update({ data: next }).eq('id', id);
      if (error) throw error;
      return this.getById(id) as Promise<Business>;
    },
  };
}
