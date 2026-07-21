/**
 * Workspace modules — the opt-in tools a business runs its operations with
 * (see docs/modules.md). At registration the owner picks what they want to
 * manage; the workspace renders only those sections, and Manage toggles them
 * later. Chat, calls, notifications and reviews are UNIVERSAL — every
 * business has them, they are never modules.
 *
 * Plain data, like the tag catalog: new modules are added here first, then
 * get their repository interface + workspace section.
 */
import type { Business, ListingType } from './types';
import { commerceVocab } from './catalog';

export type ModuleId =
  | 'orders'
  | 'billing'
  | 'bookings'
  | 'customers'
  | 'tracking'
  | 'inventory'
  | 'delivery'
  | 'memberships'
  | 'subscriptions'
  | 'coupons'
  | 'loyalty'
  | 'attendance'
  | 'expenses'
  | 'analytics';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: string;
  /** One line for the registration picker and Manage toggles. */
  description: string;
  /** False = shown as "coming soon" and can't be enabled yet. */
  available: boolean;
}

export const MODULE_CATALOG: ModuleDef[] = [
  {
    id: 'orders',
    label: 'Orders',
    icon: '🛒',
    description: 'Take product & service orders, counter-propose, run dine-in tabs.',
    available: true,
  },
  {
    id: 'billing',
    label: 'Billing & invoices',
    icon: '🧾',
    description: 'Bill customers by hand or automatically when you accept an order.',
    available: true,
  },
  {
    id: 'bookings',
    label: 'Appointments & bookings',
    icon: '📅',
    description: 'Customers request a date/time for your services; you accept or decline.',
    available: true,
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: '👥',
    description: 'Everyone who ever did business with you, with favourites on top.',
    available: true,
  },
  {
    id: 'tracking',
    label: 'Fleet & live tracking',
    icon: '🚌',
    description: 'Vehicles, drivers and live location — school buses, goods, deliveries.',
    available: true,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: '📦',
    description: 'Stock counts and low-stock alerts.',
    available: false,
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: '🛵',
    description: 'Assign orders to riders and track them to the door.',
    available: false,
  },
  {
    id: 'memberships',
    label: 'Memberships',
    icon: '🎫',
    description: 'Enroll customers into monthly plans — gym, yoga batch, tuition, bus seat.',
    available: true,
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: '🔁',
    description: 'Recurring daily/weekly orders — milk, tiffin, newspaper.',
    available: false,
  },
  {
    id: 'coupons',
    label: 'Coupons & deals',
    icon: '🏷️',
    description: 'Limited-time offers and promo codes.',
    available: false,
  },
  {
    id: 'loyalty',
    label: 'Loyalty program',
    icon: '⭐',
    description: 'Points or stamps per visit or spend.',
    available: false,
  },
  {
    id: 'attendance',
    label: 'Staff attendance',
    icon: '🕐',
    description: 'Check-in/out, leave and shifts for your team.',
    available: false,
  },
  {
    id: 'expenses',
    label: 'Expenses',
    icon: '💸',
    description: 'Track money going out alongside your bills.',
    available: false,
  },
  {
    id: 'analytics',
    label: 'Analytics & reports',
    icon: '📈',
    description: 'Sales, top items and exportable reports.',
    available: false,
  },
];

export const AVAILABLE_MODULES = MODULE_CATALOG.filter((m) => m.available);
export const COMING_SOON_MODULES = MODULE_CATALOG.filter((m) => !m.available);

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_CATALOG.find((m) => m.id === id);
}

/**
 * Pre-ticked defaults for the registration picker, inferred from what the
 * wizard already learned. Tags only SUGGEST modules — the owner keeps the
 * final say, and nothing outside this picker keys off them.
 */
export function suggestModules(input: {
  type: ListingType;
  tags?: string[];
  hasProducts?: boolean;
  hasServices?: boolean;
  hasMenu?: boolean;
}): ModuleId[] {
  const picked = new Set<ModuleId>(['billing', 'customers']);
  if (input.type === 'shop' || input.type === 'item' || input.hasProducts || input.hasMenu) {
    picked.add('orders');
  }
  if (input.type === 'service' || input.hasServices) picked.add('bookings');

  const tagSet = new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()));
  const fleetTags = [
    'taxi', 'transport', 'truck', 'tempo service', 'school bus service',
    'bus service', 'packers & movers', 'courier', 'logistics',
  ];
  if (fleetTags.some((t) => tagSet.has(t))) picked.add('tracking');
  // A gym/class "Enroll" and a recurring "Subscribe" both ride on the order
  // flow (see commerceVocab). Derive the mode from the SAME classifier that
  // draws the button label, so the two never diverge: any tag that makes the
  // page say "Enroll"/"Subscribe" must also pre-tick Orders, otherwise that
  // button is gated out (needs the orders module) and vanishes.
  const mode = commerceVocab({ type: input.type, tags: input.tags }).mode;
  if (mode === 'enroll' || mode === 'subscribe') {
    picked.add('memberships');
    picked.add('orders');
  }

  return AVAILABLE_MODULES.filter((m) => picked.has(m.id)).map((m) => m.id);
}

/**
 * The modules a business actually runs. Businesses created before the opt-in
 * step (including the mock seed) carry no explicit list — they keep every
 * available module, which is exactly the pre-modules workspace.
 */
export function enabledModules(business: Pick<Business, 'modules'>): ModuleId[] {
  if (!business.modules) return AVAILABLE_MODULES.map((m) => m.id);
  return AVAILABLE_MODULES.filter((m) => business.modules!.includes(m.id)).map((m) => m.id);
}

export function hasModule(business: Pick<Business, 'modules'>, id: ModuleId): boolean {
  return enabledModules(business).includes(id);
}
