/**
 * The slice of the app's domain the website reads.
 *
 * COPIED, NOT IMPORTED — trimmed from `src/domain/types.ts` and
 * `src/domain/hours.ts` in the Expo app. The website is its own project
 * (Vercel builds it with Root Directory = `website`) and must not reach into
 * `../src`. Every field here is optional-or-identical to the app's, so when the
 * app adds a field nothing breaks; when the app RENAMES one, update it here.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type ListingType = 'service' | 'shop' | 'item' | 'rental';

export interface BusinessLocation {
  kind: 'office' | 'home' | 'service_area';
  label?: string;
  addressLine?: string;
  city?: string;
  region?: string;
  country?: string;
  point?: GeoPoint;
  /** Run from the owner's home — never show the exact spot. */
  isHome: boolean;
  /** Show only the city / general area. */
  hidePreciseLocation: boolean;
}

export interface Shift {
  open: string;
  close: string;
}

export interface DayHours {
  closed?: boolean;
  shifts?: Shift[];
  open?: string;
  close?: string;
}

/** `days` has 7 entries, index 0=Mon…6=Sun. */
export interface OpeningHours {
  days: DayHours[];
  note?: string;
}

export interface MenuItem {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  isVeg?: boolean;
}

export interface ServiceItem {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
}

export type PlanBasis = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface PlanItem extends ServiceItem {
  basis?: PlanBasis;
}

export interface ProductItem {
  id?: string;
  name: string;
  price?: string;
  description?: string;
  images?: string[];
  sold?: boolean;
  category?: string;
  subcategory?: string;
  brand?: string;
  variants?: string[];
}

export type RentalBasis = 'daily' | 'monthly' | 'both';

export interface RentalItem {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  basis?: RentalBasis;
}

export interface PortfolioItem {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  thumbnailUrl?: string;
  title?: string;
  createdAt: string;
}

export interface ShowcaseLink {
  id: string;
  kind: 'drive' | 'photos' | 'instagram' | 'youtube' | 'facebook' | 'pinterest' | 'website';
  url: string;
  createdAt: string;
}

/** A business's own promotion — a bundle of what it sells at a special price. */
export interface Offer {
  id: string;
  title: string;
  description?: string;
  /** Shout label, e.g. "COMBO", "40% OFF". */
  tag?: string;
  emoji?: string;
  imageUrl?: string;
  videoUrl?: string;
  lines?: { name: string; price?: string; quantity?: number }[];
  price?: string;
  wasPrice?: string;
  /** Off = hidden from customers. */
  active: boolean;
  /** ISO date it stops showing. */
  endsAt?: string;
  createdAt: string;
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  tagline?: string;
  description?: string;
  type: ListingType;
  coverImageUrl?: string;
  location: BusinessLocation;
  website?: string;
  demo?: boolean;
  menu?: MenuItem[];
  services?: ServiceItem[];
  plans?: PlanItem[];
  products?: ProductItem[];
  rentals?: RentalItem[];
  rentalBasis?: RentalBasis;
  portfolio?: PortfolioItem[];
  showcaseLinks?: ShowcaseLink[];
  offers?: Offer[];
  providerType?: string;
  tags?: string[];
  priceLabel?: string;
  openNow?: boolean;
  hours?: string;
  openingHours?: OpeningHours;
  createdAt: string;
}

export interface Review {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  rating: number;
  comment?: string;
  createdAt: string;
  updatedAt?: string;
}
