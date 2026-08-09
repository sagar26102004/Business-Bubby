/** Businesses + stall products — ports MockBusinessRepository. */
import type { Business, Employee, ProductItem } from '@/domain/types';
import type { BusinessQuery, NewBusinessInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { normalizeRole } from '@/lib/roles';
import { haversineKm } from '@/lib/geo';
import { notFound } from '@/http/errors';
import { captureBusinessOfferings } from './catalog';

/** Stamp stable ids onto products that don't have one yet. */
const withProductIds = (products?: ProductItem[]): ProductItem[] | undefined =>
  products?.map((p) => (p.id ? p : { ...p, id: newUuid() }));

async function allBusinesses(): Promise<Business[]> {
  return rowsData<Business>(await prisma.business.findMany());
}

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

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
    const { near, maxDistanceKm, sortByDistance } = query;

    const results = (await allBusinesses())
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
        const point = b.location.point;
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
    return results;
  },

  getById: (id: string) => findBusiness(id),

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
      hours: input.hours,
      openingHours: input.openingHours,
      modules: input.modules,
      employeeIds,
      callHandlerIds: employeeIds,
      ownerHandlesCalls: true,
      chatRecipientIds: employeeIds,
      openNow: true,
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
    if (patch.products) business.products = withProductIds(patch.products);
    const saved = await saveBusiness(business);
    // Capture new offerings when the listing's tags/menu/services/products change.
    if (patch.tags || patch.menu || patch.services || patch.products) {
      await captureBusinessOfferings(saved);
    }
    return saved;
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
