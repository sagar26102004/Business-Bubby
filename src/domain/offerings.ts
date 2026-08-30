/**
 * ONE model for everything a business offers.
 *
 * A menu, a product catalog, a service list and a rental list are the same
 * kind of thing — a priced list, filed in sections and nested folders. The app
 * only splits them so a business can fill them in separately ("my menu", "my
 * services"); to a customer they are all just "what this place offers", and
 * they are therefore built the same way (the folder editors) and shown the
 * same way (`features/offerings/OfferingCatalog`).
 *
 * This module is the join: it flattens `Business.menu`, `.products`,
 * `.services` and `.rentals` into ONE shape — `CatalogItem` — applying each
 * bucket's own library order and its own quirks (a dish's veg dot, a product's
 * spec line, a rental's per-day sticker) once, here, so no screen has to know
 * which of the four it is holding.
 *
 * The folder path is the part that matters: every bucket encodes its nesting
 * the same way (`domain/subcategoryPath.ts`), so "South Indian › Dosa › Plain"
 * and "Repairs › Washing machine › Front load" and "Home electronics › Air
 * conditioner › Samsung" all fold open identically.
 */
import type { Business, OfferingKind, PlanItem } from './types';
import { commerceVocab, planBasisSticker, rentalBasisSticker } from './catalog';
import { foodSectionOrder } from './foodMenu';
import { PRODUCT_SECTIONS } from './goods';
import {
  PLAN_SECTIONS,
  RENTAL_SECTIONS,
  SERVICE_SECTIONS,
  rentalCategory,
  sortBySection,
  upgradeRentalFiling,
} from './offeringSections';
import { subcategoryPath } from './subcategoryPath';

/**
 * Which of a business's lists an item came out of.
 *
 * `services` and `plans` are the same shape and are shown identically — they
 * are two lists because they are AVAILED differently: a service is requested
 * one-off, a plan is enrolled in and renews. See `BUCKET_META.action`.
 */
export type OfferingBucket = 'menu' | 'products' | 'services' | 'plans' | 'rentals';

/** One offering, whichever list it came from. */
export interface CatalogItem {
  /**
   * Stable identity inside its business. The cart and the quantity maps key on
   * it, and it carries the bucket so a dish and a service of the same name are
   * never the same line.
   */
  key: string;
  bucket: OfferingBucket;
  /** What an ORDER line calls it: goods are products, work and rentals are services. */
  kind: OfferingKind;
  name: string;
  price?: string;
  description?: string;
  /** Top-level section — "Starters", "Home electronics", "Repairs", "Flats & rooms". */
  category?: string;
  /** Where it sits inside that section, as folder segments. Empty = filed at the section root. */
  path: string[];
  /** One grey line under the name — a product's specs ("1.5 Ton · Split"). */
  detail?: string;
  /** Photo, if the business added one. */
  imageUrl?: string;
  /** Veg (green) / non-veg (red) dot. Dishes only. */
  isVeg?: boolean;
  /** Sticker beside the price — "per day", "per month". Rentals only. */
  badge?: string;
}

/** A whole bucket, ready to render: what to call it and what's in it. */
export interface OfferingBucketView {
  bucket: OfferingBucket;
  /** Heading — "Menu", "Products", "Services", "For rent". */
  title: string;
  /** Line under it — "12 dishes". */
  subtitle: string;
  /** Emoji stand-in shown where an item has no photo. */
  icon: string;
  /** The "see the whole thing" link's wording — "Full menu", "Everything for rent". */
  seeAllLabel: string;
  /** The customer's button for this list — "🛒 Order", "🛠️ Request", "🎟️ Enroll". */
  actionLabel: string;
  /** The same action at the foot of the full catalog — "Place order". */
  ctaLabel: string;
  /** The workspace module that has to be on, or the action lands nowhere. */
  module: 'orders' | 'memberships';
  items: CatalogItem[];
}

/**
 * Everything that differs between the buckets, in one table.
 *
 * `action` is the point of the whole split: lists that LOOK identical and are
 * filled identically, each with the one word that says how you take it — a
 * dish is ordered, a product is bought, a service is requested, a plan is
 * enrolled in. Same room, several doors, each labelled.
 */
const BUCKET_META: Record<
  OfferingBucket,
  {
    title: string;
    icon: string;
    noun: string;
    seeAll: string;
    kind: OfferingKind;
    action: string;
    cta: string;
    module: 'orders' | 'memberships';
  }
> = {
  menu: {
    title: 'Menu',
    icon: '🍽️',
    noun: 'dish',
    seeAll: 'Full menu',
    kind: 'product',
    action: '🛒 Order',
    cta: 'Place order',
    module: 'orders',
  },
  products: {
    title: 'Products',
    icon: '📦',
    noun: 'item',
    seeAll: 'All products',
    kind: 'product',
    action: '🛍️ Buy',
    cta: 'Place order',
    module: 'orders',
  },
  services: {
    title: 'Services',
    icon: '🛠️',
    noun: 'service',
    seeAll: 'All services',
    kind: 'service',
    // Nothing changes hands until the business agrees a time and a price, so a
    // one-off service is REQUESTED, not bought off a shelf.
    action: '🛠️ Request',
    cta: 'Send request',
    module: 'orders',
  },
  plans: {
    title: 'Plans & memberships',
    icon: '🎟️',
    noun: 'plan',
    seeAll: 'All plans',
    kind: 'service',
    // A plan never becomes an order: enrolling lands as a pending Membership in
    // the workspace's Members section (app/enroll).
    action: '🎟️ Enroll',
    cta: 'Enroll',
    module: 'memberships',
  },
  // A rental is PROVIDED rather than handed over, so an order line calls it a
  // service — the same way the order screen has always filed them.
  rentals: {
    title: 'For rent',
    icon: '🔑',
    noun: 'item',
    seeAll: 'Everything for rent',
    kind: 'service',
    action: '🔑 Request to rent',
    cta: 'Send request',
    module: 'orders',
  },
};

/** "12 dishes", "1 service". */
function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : noun === 'dish' ? 'es' : 's'}`;
}

/**
 * Identity for a cart line and a list key.
 *
 * Nothing in these lists carries an id of its own, and a name is NOT unique —
 * a "Tempo" can be both a service and a rental, and one rental listing really
 * does hold two different "Swift"s at two different prices. So the position in
 * its own list goes in too: it is stable for as long as the list is (nothing
 * reorders these between the catalog screen and the cart), and without it two
 * same-named rows collide as one React child and as one cart line.
 */
function itemKey(
  bucket: OfferingBucket,
  index: number,
  category: string | undefined,
  path: string[],
  name: string,
): string {
  return `${bucket}|${index}|${category ?? ''}|${path.join('›')}|${name}`;
}

/** The dishes, in the library's canonical order (Appetizers → … → Beverages). */
function menuItems(business: Business): CatalogItem[] {
  const menu = [...(business.menu ?? [])].sort(
    (a, b) => foodSectionOrder(a.category) - foodSectionOrder(b.category),
  );
  return menu.map((m, i) => {
    const path = subcategoryPath(m.subcategory);
    return {
      key: itemKey('menu', i, m.category, path, m.name),
      bucket: 'menu' as const,
      kind: 'product' as const,
      name: m.name,
      price: m.price,
      description: m.description,
      category: m.category,
      path,
      imageUrl: m.imageUrl,
      isVeg: m.isVeg,
    };
  });
}

/**
 * The products. The goods library files a product three deep — shelf › kind ›
 * brand — so the kind and the brand become folder segments, exactly the way a
 * dish's subcategories do; only the specs are left as the grey line.
 */
function productItems(business: Business): CatalogItem[] {
  return sortBySection(business.products ?? [], PRODUCT_SECTIONS).map((p, i) => {
    const path = [p.subcategory?.trim(), p.brand?.trim()].filter(Boolean) as string[];
    return {
      key: p.id ?? itemKey('products', i, p.category, path, p.name),
      bucket: 'products' as const,
      kind: 'product' as const,
      name: p.name,
      price: p.price,
      description: p.description,
      category: p.category,
      path,
      detail: (p.variants ?? []).filter(Boolean).join(' · ') || undefined,
      imageUrl: p.images?.[0],
    };
  });
}

/**
 * The plans a business is offering, wherever they are kept.
 *
 * Membership businesses (gyms, classes, tiffin, bus) listed their plans as
 * `services` before plans had a list of their own — the whole app treated a
 * joinable business's services AS its plans. That reading is kept here, so
 * every listing made before the split still enrols exactly as it did and
 * nothing had to be migrated. The moment a business fills in a real `plans`
 * list, its services go back to being services.
 */
export function planOfferings(business: Business): PlanItem[] {
  if ((business.plans?.length ?? 0) > 0) return business.plans!;
  return usesServicesAsPlans(business) ? (business.services as PlanItem[]) : [];
}

/**
 * Is this listing's `services` list standing in for its plans? True only for a
 * legacy membership business — one whose tags make it joinable, that never
 * filled in `plans`. When true the services bucket is EMPTY: the same list
 * must not appear twice under two different buttons, which is the exact
 * confusion the split exists to end.
 */
export function usesServicesAsPlans(business: Business): boolean {
  if ((business.plans?.length ?? 0) > 0) return false;
  if ((business.services?.length ?? 0) === 0) return false;
  const mode = commerceVocab(business).mode;
  return mode === 'enroll' || mode === 'subscribe';
}

/** The plans — "Gym & fitness › Membership › Annual", each with its period. */
function planItems(business: Business): CatalogItem[] {
  return sortBySection(planOfferings(business), PLAN_SECTIONS).map((p, i) => {
    const path = subcategoryPath(p.subcategory);
    return {
      key: itemKey('plans', i, p.category, path, p.name),
      bucket: 'plans' as const,
      kind: 'service' as const,
      name: p.name,
      price: p.price,
      description: p.description,
      category: p.category,
      path,
      imageUrl: p.imageUrl,
      badge: planBasisSticker(p.basis),
    };
  });
}

/** The one-off services — "Repairs › Washing machine › Front load". */
function serviceItems(business: Business): CatalogItem[] {
  // A legacy membership listing keeps its plans here; they read as plans.
  if (usesServicesAsPlans(business)) return [];
  return sortBySection(business.services ?? [], SERVICE_SECTIONS).map((s, i) => {
    const path = subcategoryPath(s.subcategory);
    return {
      key: itemKey('services', i, s.category, path, s.name),
      bucket: 'services' as const,
      kind: 'service' as const,
      name: s.name,
      price: s.price,
      description: s.description,
      category: s.category,
      path,
      imageUrl: s.imageUrl,
    };
  });
}

/**
 * What's for rent. Listings made against the old flat library are re-filed as
 * they load (`upgradeRentalFiling`), and each one carries its own per-day /
 * per-month sticker — one lister's flat is monthly while their scooter is daily.
 */
function rentalItems(business: Business): CatalogItem[] {
  const rentals = (business.rentals ?? [])
    .map(upgradeRentalFiling)
    .map((item) => ({ ...item, category: rentalCategory(item) }));
  return sortBySection(rentals, RENTAL_SECTIONS).map((r, i) => {
    const path = subcategoryPath(r.subcategory);
    return {
      key: itemKey('rentals', i, r.category, path, r.name),
      bucket: 'rentals' as const,
      kind: 'service' as const,
      name: r.name,
      price: r.price,
      description: r.description,
      category: r.category,
      path,
      imageUrl: r.imageUrl,
      badge: rentalBasisSticker(r.basis ?? business.rentalBasis),
    };
  });
}

const READERS: Record<OfferingBucket, (b: Business) => CatalogItem[]> = {
  menu: menuItems,
  products: productItems,
  services: serviceItems,
  plans: planItems,
  rentals: rentalItems,
};

/** One bucket of a business, normalised. An empty bucket comes back as `null`. */
export function offeringBucket(
  business: Business,
  bucket: OfferingBucket,
): OfferingBucketView | null {
  const items = READERS[bucket](business);
  if (items.length === 0) return null;
  const meta = BUCKET_META[bucket];
  return {
    bucket,
    title: meta.title,
    subtitle: countLabel(items.length, meta.noun),
    icon: meta.icon,
    seeAllLabel: meta.seeAll,
    actionLabel: meta.action,
    ctaLabel: meta.cta,
    module: meta.module,
    items,
  };
}

/** Every non-empty bucket, in the order the business page lays them out. */
export function offeringBuckets(business: Business): OfferingBucketView[] {
  const order: OfferingBucket[] = ['menu', 'plans', 'services', 'rentals', 'products'];
  return order
    .map((bucket) => offeringBucket(business, bucket))
    .filter((view): view is OfferingBucketView => view !== null);
}

/** Is this a real bucket name? Guards the `bucket` route param. */
export function isOfferingBucket(value: unknown): value is OfferingBucket {
  return (
    value === 'menu' ||
    value === 'products' ||
    value === 'services' ||
    value === 'plans' ||
    value === 'rentals'
  );
}
