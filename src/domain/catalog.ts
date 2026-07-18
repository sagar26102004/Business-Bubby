/**
 * The catalog of the four listing types and their subcategories.
 *
 * Plain data so the taxonomy grows by editing this file only — no screen or
 * type changes required. A real backend can later serve this exact shape.
 */
import type { ListingType, ListingTypeDef, RentalBasis, VehicleKind } from './types';

export const LISTING_TYPES: ListingTypeDef[] = [
  {
    id: 'service',
    label: 'Services',
    singular: 'Service',
    icon: '🛠️',
    color: '#3B82F6',
    actionLabel: 'Enquire',
    subcategories: [
      { id: 'transport', name: 'Transport', icon: '🚐' },
      { id: 'home-repair', name: 'Home & repair', icon: '🔧' },
      { id: 'cleaning', name: 'Cleaning', icon: '🧽' },
      { id: 'beauty', name: 'Beauty & grooming', icon: '💇' },
      { id: 'health', name: 'Health & fitness', icon: '🩺' },
      { id: 'tutoring', name: 'Tutoring', icon: '📚' },
      { id: 'events', name: 'Events', icon: '🎉' },
      { id: 'other', name: 'Other', icon: '✨' },
    ],
  },
  {
    id: 'shop',
    label: 'Shops',
    singular: 'Shop',
    icon: '🏪',
    color: '#14B8A6',
    actionLabel: 'Contact shop',
    subcategories: [
      { id: 'cafe', name: 'Cafe', icon: '☕' },
      { id: 'restaurant', name: 'Restaurant', icon: '🍽️' },
      { id: 'bakery', name: 'Bakery', icon: '🥖' },
      { id: 'grocery', name: 'Grocery', icon: '🛒' },
      { id: 'handcrafts', name: 'Handcrafts', icon: '🧶' },
      { id: 'clothing', name: 'Clothing', icon: '👗' },
      { id: 'electronics', name: 'Electronics', icon: '📱' },
      { id: 'florist', name: 'Florist', icon: '💐' },
      { id: 'other', name: 'Other', icon: '✨' },
    ],
  },
  {
    id: 'item',
    label: 'Stalls',
    singular: 'Stall',
    icon: '🏷️',
    color: '#F59E0B',
    actionLabel: 'Contact seller',
    subcategories: [
      { id: 'vehicles', name: 'Vehicles', icon: '🚗' },
      { id: 'electronics', name: 'Electronics', icon: '📱' },
      { id: 'furniture', name: 'Furniture', icon: '🛋️' },
      { id: 'appliances', name: 'Appliances', icon: '🔌' },
      { id: 'home-goods', name: 'Home & garden', icon: '🪴' },
      { id: 'other', name: 'Other', icon: '✨' },
    ],
  },
  {
    id: 'rental',
    label: 'Rentals',
    singular: 'Rental',
    icon: '🔑',
    color: '#0EA5E9',
    actionLabel: 'Check availability',
    subcategories: [
      { id: 'flats', name: 'Flats & rooms', icon: '🏠' },
      { id: 'cars', name: 'Cars', icon: '🚗' },
      { id: 'bikes', name: 'Bikes', icon: '🚲' },
      { id: 'furniture', name: 'Furniture', icon: '🛋️' },
      { id: 'equipment', name: 'Equipment', icon: '🧰' },
      { id: 'other', name: 'Other', icon: '✨' },
    ],
  },
];

const typeById = new Map(LISTING_TYPES.map((t) => [t.id, t]));

export function getType(id: ListingType): ListingTypeDef | undefined {
  return typeById.get(id);
}

export function getSubcategory(typeId: ListingType, subId?: string) {
  if (!subId) return undefined;
  return typeById.get(typeId)?.subcategories.find((s) => s.id === subId);
}

export function actionLabelFor(typeId: ListingType): string {
  return typeById.get(typeId)?.actionLabel ?? 'Contact';
}

/**
 * Shop subcategories that seat customers, so ordering asks dine-in vs
 * takeaway. Data, not code — extend the list to give more shop kinds tables.
 */
const DINE_IN_SUBCATEGORY_IDS = ['cafe', 'restaurant'];

const DINE_IN_TAGS = [
  'cafe', 'restaurant', 'family dining', 'fast food', 'dhaba', 'fine dining',
  'buffet', 'thali', 'mess',
];

/** True when orders from this business should ask dine-in or takeaway. */
export function offersDineIn(business: {
  type: ListingType;
  subcategoryId?: string;
  tags?: string[];
}): boolean {
  if (business.type !== 'shop') return false;
  if (DINE_IN_SUBCATEGORY_IDS.includes(business.subcategoryId ?? '')) return true;
  return (business.tags ?? []).some((t) => DINE_IN_TAGS.includes(t.trim().toLowerCase()));
}

/**
 * Businesses you JOIN rather than buy a one-off from — a gym you enrol at, a
 * class you take a seat in. The order plumbing is identical underneath; only
 * the words on top change (see `commerceVocab`).
 */
const ENROLL_TAGS = [
  'gym', 'fitness', 'yoga', 'zumba', 'personal trainer', 'dietician',
  'tutor', 'home tuition', 'coaching', 'computer classes', 'coding classes',
  'spoken english', 'competitive exams', 'abacus', 'music classes',
  'dance classes', 'art classes', 'singing classes', 'swimming classes',
  'karate & self defence', 'sports coaching', 'cricket academy', 'library',
];

/** Recurring services a customer SUBSCRIBES to — a seat/plan that renews. */
const SUBSCRIBE_TAGS = [
  'school bus service', 'bus service', 'tiffin service', 'mess',
  'milk delivery', 'newspaper delivery',
];

export type CommerceMode = 'order' | 'enroll' | 'subscribe' | 'rent';

/**
 * The words a business uses for taking custom — most sell, so they "Order";
 * gyms/classes "Enroll"; recurring services (school bus, tiffin) "Subscribe".
 * Same order flow underneath, so requests still route through OrderRepository;
 * only the labels differ. Derived from tags, like `offersDineIn` — data, not
 * a category the owner has to pick.
 */
export interface CommerceVocab {
  mode: CommerceMode;
  /** Customer-facing action button on the business page. */
  customerAction: string;
  /** Bare verb — 'Order' | 'Enroll' | 'Subscribe'. */
  verb: string;
  /** Heading for the request list, on the business page and the workspace. */
  requestsTitle: string;
  /** Singular noun for counts — 'order' | 'enrollment' | 'subscription'. */
  requestNoun: string;
}

export function commerceVocab(business: {
  type: ListingType;
  subcategoryId?: string;
  tags?: string[];
}): CommerceVocab {
  const tags = (business.tags ?? []).map((t) => t.trim().toLowerCase());
  // Rentals hand the item back — you "Rent" it, you don't order/buy it.
  if (business.type === 'rental') {
    return {
      mode: 'rent',
      customerAction: '🔑 Rent',
      verb: 'Rent',
      requestsTitle: 'Rental requests',
      requestNoun: 'rental',
    };
  }
  // Stalls always "buy"; a tagged membership business overrides "order".
  if (business.type !== 'item') {
    if (tags.some((t) => SUBSCRIBE_TAGS.includes(t))) {
      return {
        mode: 'subscribe',
        customerAction: '🔁 Subscribe',
        verb: 'Subscribe',
        requestsTitle: 'Membership requests',
        requestNoun: 'subscription',
      };
    }
    if (tags.some((t) => ENROLL_TAGS.includes(t))) {
      return {
        mode: 'enroll',
        customerAction: '🎟️ Enroll',
        verb: 'Enroll',
        requestsTitle: 'Membership requests',
        requestNoun: 'enrollment',
      };
    }
  }
  return {
    mode: 'order',
    customerAction: business.type === 'item' ? 'Buy an item' : 'Order',
    verb: 'Order',
    requestsTitle: 'Orders',
    requestNoun: 'order',
  };
}

/**
 * Personal stall — an individual seller's single 'item' listing that holds
 * everything they're selling as products. Created automatically the first
 * time someone lists an item and named after them until they rename it.
 */
export const STALL_PROVIDER_TYPE = 'Personal stall';

/** Default stall name when the seller hasn't picked one, e.g. "Sagar’s Stall". */
export function defaultStallName(ownerName: string): string {
  return `${ownerName}’s Stall`;
}

/** How a rental can be offered — asked once at listing time, as data. */
export const RENTAL_BASES: { id: RentalBasis; label: string; icon: string }[] = [
  { id: 'daily', label: 'Per day', icon: '📅' },
  { id: 'monthly', label: 'Per month', icon: '🗓️' },
  { id: 'both', label: 'Day or month', icon: '🔁' },
];

/** Short card label for a rental basis, e.g. "Per day or per month". */
export function rentalBasisLabel(id?: RentalBasis): string | undefined {
  if (!id) return undefined;
  if (id === 'both') return 'Per day or per month';
  return RENTAL_BASES.find((b) => b.id === id)?.label;
}

/** The kinds of vehicle a business can add to its fleet, as data. */
export const VEHICLE_KINDS: { id: VehicleKind; name: string; icon: string }[] = [
  { id: 'bus', name: 'Bus', icon: '🚌' },
  { id: 'van', name: 'Van', icon: '🚐' },
  { id: 'truck', name: 'Truck', icon: '🚚' },
  { id: 'car', name: 'Car', icon: '🚗' },
  { id: 'bike', name: 'Bike', icon: '🏍️' },
  { id: 'other', name: 'Other', icon: '📦' },
];

export function getVehicleKind(id: VehicleKind) {
  return VEHICLE_KINDS.find((k) => k.id === id) ?? VEHICLE_KINDS[VEHICLE_KINDS.length - 1];
}

/** "$", "$$", "$$$" for a coarse price level. */
export function priceLevelLabel(level?: 1 | 2 | 3): string {
  return level ? '$'.repeat(level) : '';
}

/** Human distance label, e.g. "0.4 km" / "1.2 km". */
export function formatDistance(km?: number): string | undefined {
  if (typeof km !== 'number') return undefined;
  return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`;
}
