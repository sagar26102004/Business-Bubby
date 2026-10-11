/**
 * Everything a business offers, flattened into one list shape.
 *
 * A read-only cousin of `src/domain/offerings.ts` in the app: the same five
 * buckets (menu, plans, services, rentals, products) in the same page order,
 * with the same per-bucket quirks (veg dot, product specs, per-day/per-month
 * stickers). It skips the app's library re-sorting and its ordering/cart keys —
 * the website only shows the list, every action happens in the app.
 *
 * One known simplification: a legacy membership business that kept its plans
 * in `services` shows them here as "Services" (the app re-reads them as plans).
 */
import type { Business, PlanBasis, RentalBasis } from './types';

export type Bucket = 'menu' | 'plans' | 'services' | 'rentals' | 'products';

export interface CatalogItem {
  name: string;
  price?: string;
  description?: string;
  /** Specs line, e.g. "1.5 Ton · Split". */
  detail?: string;
  imageUrl?: string;
  isVeg?: boolean;
  /** "per month", "per day". */
  badge?: string;
  sold?: boolean;
}

export interface CatalogFolder {
  /** Folder path inside the section, e.g. "Cold › Shake". Empty = section root. */
  path: string;
  items: CatalogItem[];
}

export interface CatalogSection {
  title: string;
  count: number;
  folders: CatalogFolder[];
}

export interface CatalogBucket {
  bucket: Bucket;
  title: string;
  icon: string;
  /** How you take one, in the app: Order, Request, Enroll… */
  action: string;
  count: number;
  sections: CatalogSection[];
}

const META: Record<Bucket, { title: string; icon: string; action: string; fallback: string }> = {
  menu: { title: 'Menu', icon: '🍽️', action: 'Order', fallback: 'Dishes' },
  plans: { title: 'Plans & memberships', icon: '🎟️', action: 'Enroll', fallback: 'Plans' },
  services: { title: 'Services', icon: '🛠️', action: 'Request', fallback: 'Services' },
  rentals: { title: 'For rent', icon: '🔑', action: 'Request to rent', fallback: 'For rent' },
  products: { title: 'Products', icon: '📦', action: 'Buy', fallback: 'Products' },
};

/** The app stores nested folders as one string joined with " › ". */
function splitPath(subcategory?: string): string[] {
  return (subcategory ?? '')
    .split('›')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rentalSticker(b?: RentalBasis): string | undefined {
  if (b === 'daily') return 'per day';
  if (b === 'monthly') return 'per month';
  if (b === 'both') return 'per day / month';
  return undefined;
}

function planSticker(b?: PlanBasis): string {
  if (b === 'quarterly') return 'per quarter';
  if (b === 'half_yearly') return 'per 6 months';
  if (b === 'yearly') return 'per year';
  return 'per month';
}

interface Raw {
  category?: string;
  path: string[];
  item: CatalogItem;
}

function rawItems(business: Business, bucket: Bucket): Raw[] {
  switch (bucket) {
    case 'menu':
      return (business.menu ?? []).map((m) => ({
        category: m.category,
        path: splitPath(m.subcategory),
        item: {
          name: m.name,
          price: m.price,
          description: m.description,
          imageUrl: m.imageUrl,
          isVeg: m.isVeg,
        },
      }));
    case 'plans':
      return (business.plans ?? []).map((p) => ({
        category: p.category,
        path: splitPath(p.subcategory),
        item: {
          name: p.name,
          price: p.price,
          description: p.description,
          imageUrl: p.imageUrl,
          badge: planSticker(p.basis),
        },
      }));
    case 'services':
      return (business.services ?? []).map((s) => ({
        category: s.category,
        path: splitPath(s.subcategory),
        item: { name: s.name, price: s.price, description: s.description, imageUrl: s.imageUrl },
      }));
    case 'rentals':
      return (business.rentals ?? []).map((r) => ({
        category: r.category,
        path: splitPath(r.subcategory),
        item: {
          name: r.name,
          price: r.price,
          description: r.description,
          imageUrl: r.imageUrl,
          badge: rentalSticker(r.basis ?? business.rentalBasis),
        },
      }));
    case 'products':
      // Goods are filed shelf › kind › brand; kind and brand become folders.
      return (business.products ?? []).map((p) => ({
        category: p.category,
        path: [p.subcategory?.trim(), p.brand?.trim()].filter(Boolean) as string[],
        item: {
          name: p.name,
          price: p.price,
          description: p.description,
          detail: (p.variants ?? []).filter(Boolean).join(' · ') || undefined,
          imageUrl: p.images?.[0],
          sold: p.sold,
        },
      }));
  }
}

/** Group a bucket by section, then by folder, keeping the owner's own order. */
function group(raws: Raw[], fallback: string): CatalogSection[] {
  const sections = new Map<string, Map<string, CatalogItem[]>>();
  for (const r of raws) {
    const title = r.category?.trim() || fallback;
    const folders = sections.get(title) ?? new Map<string, CatalogItem[]>();
    sections.set(title, folders);
    const key = r.path.join(' › ');
    folders.set(key, [...(folders.get(key) ?? []), r.item]);
  }
  return [...sections].map(([title, folders]) => {
    const list = [...folders].map(([path, items]) => ({ path, items }));
    // Loose items at the section root read first, then the folders.
    list.sort((a, b) => Number(a.path !== '') - Number(b.path !== ''));
    return { title, count: list.reduce((n, f) => n + f.items.length, 0), folders: list };
  });
}

/** Every non-empty bucket, in the order the app's business page shows them. */
export function catalogBuckets(business: Business): CatalogBucket[] {
  const order: Bucket[] = ['menu', 'plans', 'services', 'rentals', 'products'];
  return order.flatMap((bucket) => {
    const raws = rawItems(business, bucket).filter((r) => r.item.name?.trim());
    if (!raws.length) return [];
    const meta = META[bucket];
    return [
      {
        bucket,
        title: meta.title,
        icon: meta.icon,
        action: meta.action,
        count: raws.length,
        sections: group(raws, meta.fallback),
      },
    ];
  });
}

/** A price label as written; bare numbers get a rupee sign. */
export function priceLabel(price?: string): string | undefined {
  const p = price?.trim();
  if (!p) return undefined;
  return /^\d[\d,]*(\.\d+)?$/.test(p) ? `₹${p}` : p;
}
