/**
 * Prebuilt category libraries for SERVICES and RENTALS — the same idea as the
 * restaurant menu library in `domain/foodMenu.ts`, applied to the other two
 * things a business lists.
 *
 * Before this, a service provider typed its own section ("Repair" / "REPAIRS" /
 * "Repairing") and a rental lister picked from six very broad browse chips, so
 * two identical businesses organised their page completely differently and
 * nothing lined up. Owners now start from ready-made sections and subcategories
 * and only type when the library genuinely misses something.
 *
 * A section's `name` is what lands on `ServiceItem.category` / `RentalItem.category`,
 * and a picked subcategory lands on `.subcategory` — the same two fields the
 * business page's `OfferingsSection` groups by (its category chips), so
 * organising here shows up for customers with no extra plumbing.
 *
 * Rentals additionally carry `subcategoryId`: discovery (the Rentals browse tile
 * and its chips) runs on the rental catalog in `domain/catalog.ts`, so every
 * rental section maps to one of its ids. Several sections may share an id — the
 * library is finer-grained than the browse taxonomy on purpose.
 */
import { getSubcategory } from './catalog';

export interface OfferingSection {
  /** Stable key. The section's `name` is what lands on the item's `category`. */
  id: string;
  name: string;
  icon: string;
  /** Groups inside the section, offered as a second row of chips. */
  subcategories?: string[];
  /**
   * Rentals only: the `domain/catalog.ts` rental subcategory this section files
   * under, so browse chips keep working while the owner picks something precise.
   */
  subcategoryId?: string;
}

/**
 * Services — the families almost every Indian local-services business falls in.
 * Deliberately broad: a business tags itself for discovery (`domain/tags.ts`),
 * these only organise its own price list.
 */
export const SERVICE_SECTIONS: OfferingSection[] = [
  {
    id: 'repairs',
    name: 'Repairs',
    icon: '🔧',
    subcategories: [
      'AC',
      'Refrigerator',
      'Washing machine',
      'TV',
      'Mobile',
      'Laptop & computer',
      'Water purifier',
      'Vehicle',
    ],
  },
  {
    id: 'installation',
    name: 'Installation & fitting',
    icon: '🧰',
    subcategories: ['AC', 'Appliances', 'CCTV', 'Inverter & solar', 'Tyres & wheels', 'Modular kitchen'],
  },
  {
    id: 'home',
    name: 'Home services',
    icon: '🏠',
    subcategories: ['Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Masonry', 'Pest control'],
  },
  {
    id: 'cleaning',
    name: 'Cleaning',
    icon: '🧹',
    subcategories: ['Home deep clean', 'Sofa & carpet', 'Bathroom', 'Kitchen', 'Water tank', 'Car wash'],
  },
  {
    id: 'beauty',
    name: 'Beauty & grooming',
    icon: '💇',
    subcategories: ['Hair', 'Skin & facial', 'Nails', 'Waxing & threading', 'Makeup', 'Spa & massage'],
  },
  {
    id: 'health',
    name: 'Health & wellness',
    icon: '🩺',
    subcategories: ['Consultation', 'Physiotherapy', 'Dental', 'Lab tests', 'Yoga & fitness'],
  },
  {
    id: 'classes',
    name: 'Classes & coaching',
    icon: '📚',
    subcategories: ['School tuition', 'Competitive exams', 'Music', 'Dance', 'Languages', 'Computer skills'],
  },
  {
    id: 'transport',
    name: 'Transport & moving',
    icon: '🚚',
    subcategories: ['Packers & movers', 'Goods transport', 'Taxi & cab', 'Courier & delivery'],
  },
  {
    id: 'events',
    name: 'Events',
    icon: '🎉',
    subcategories: ['Photography', 'Videography', 'Decoration', 'Catering', 'Sound & lighting', 'Tent & furniture'],
  },
  {
    id: 'tailoring',
    name: 'Tailoring & alterations',
    icon: '🧵',
    subcategories: ['Stitching', 'Alterations', 'Embroidery'],
  },
  {
    id: 'professional',
    name: 'Professional',
    icon: '💼',
    subcategories: ['Legal', 'Accounts & tax', 'Design', 'Web & app', 'Marketing', 'Consulting'],
  },
  {
    id: 'pets',
    name: 'Pet care',
    icon: '🐾',
    subcategories: ['Grooming', 'Veterinary', 'Boarding', 'Training'],
  },
  {
    id: 'agri',
    name: 'Farm & agri',
    icon: '🌾',
    subcategories: ['Tractor & equipment', 'Borewell', 'Crop spraying', 'Dairy'],
  },
  { id: 'other_service', name: 'Other', icon: '✨' },
];

/**
 * Rentals — finer than the six browse chips, but every section still files under
 * one of them (`subcategoryId`) so the Rentals tile and its filters are unchanged.
 */
export const RENTAL_SECTIONS: OfferingSection[] = [
  {
    id: 'flats',
    name: 'Flats & rooms',
    icon: '🏠',
    subcategoryId: 'flats',
    subcategories: ['1 RK', '1 BHK', '2 BHK', '3 BHK', 'PG / hostel bed', 'Shop / office', 'Godown', 'Banquet hall'],
  },
  {
    id: 'cars',
    name: 'Cars',
    icon: '🚗',
    subcategoryId: 'cars',
    subcategories: ['Hatchback', 'Sedan', 'SUV', 'Luxury', 'Tempo traveller', 'Self-drive'],
  },
  {
    id: 'bikes',
    name: 'Bikes',
    icon: '🚲',
    subcategoryId: 'bikes',
    subcategories: ['Scooter', 'Motorcycle', 'Bicycle', 'Electric'],
  },
  {
    id: 'furniture',
    name: 'Furniture & appliances',
    icon: '🛋️',
    subcategoryId: 'furniture',
    subcategories: ['Beds & mattress', 'Sofa & seating', 'Tables & chairs', 'Wardrobe', 'Fridge', 'Washing machine', 'AC', 'TV'],
  },
  {
    id: 'equipment',
    name: 'Equipment & tools',
    icon: '🧰',
    subcategoryId: 'equipment',
    subcategories: ['Camera & drone', 'Sound & lighting', 'Power tools', 'Construction', 'Medical', 'Kitchen'],
  },
  {
    id: 'event_gear',
    name: 'Tent & event gear',
    icon: '🎪',
    subcategoryId: 'equipment',
    subcategories: ['Tent & canopy', 'Chairs & tables', 'Crockery', 'Stage & truss', 'Generator'],
  },
  {
    id: 'clothing',
    name: 'Clothing & costumes',
    icon: '👗',
    subcategoryId: 'other',
    subcategories: ['Wedding wear', 'Costumes', 'Suits', 'Jewellery'],
  },
  { id: 'other_rental', name: 'Other', icon: '✨', subcategoryId: 'other' },
];

/** The library section an item's `category` came from, if any. */
export function findSection(
  sections: OfferingSection[],
  category?: string,
): OfferingSection | undefined {
  if (!category) return undefined;
  const key = category.trim().toLowerCase();
  return sections.find((s) => s.name.toLowerCase() === key);
}

/**
 * Sort key for a category — its position in the library. Sections the owner
 * invented sort after the library ones.
 */
function sectionOrder(sections: OfferingSection[], category?: string): number {
  const section = findSection(sections, category);
  return section ? sections.indexOf(section) : sections.length;
}

/**
 * Order a list so its sections read in library order — every business's
 * services come out Repairs → Installation → … however they were entered, the
 * way `foodSectionOrder` does it for menus. Sorting is stable, so items keep
 * the owner's order within a section.
 */
export function sortBySection<T extends { category?: string }>(
  items: T[],
  sections: OfferingSection[],
): T[] {
  return [...items].sort(
    (a, b) => sectionOrder(sections, a.category) - sectionOrder(sections, b.category),
  );
}

/**
 * The display category for a rental, falling back to its browse subcategory for
 * items listed before the library existed (they only ever carried a
 * `subcategoryId`), so old listings still group instead of piling up ungrouped.
 */
export function rentalCategory(item: { category?: string; subcategoryId?: string }): string | undefined {
  if (item.category?.trim()) return item.category.trim();
  return getSubcategory('rental', item.subcategoryId)?.name;
}
