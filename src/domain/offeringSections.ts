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
import { joinSubcategoryPath } from './subcategoryPath';

/**
 * A folder inside a section, which may hold folders of its own — "Flat" holds
 * 1 BHK, 2 BHK…; "PG bed" holds For girls and For boys, and each of those holds
 * the beds themselves. One level was never enough for property: a customer
 * scanning a rental page is narrowing down, not reading a list.
 */
export interface OfferingFolder {
  name: string;
  children?: OfferingFolder[];
}

export interface OfferingSection {
  /** Stable key. The section's `name` is what lands on the item's `category`. */
  id: string;
  name: string;
  icon: string;
  /**
   * Flat, one-level groups inside the section — the simple case (a service
   * section's kinds of work). Offered as folders at the section root.
   */
  subcategories?: string[];
  /**
   * Nested groups, when one level isn't enough (property). Takes precedence
   * over `subcategories`; the editor and the business page both walk it.
   */
  folders?: OfferingFolder[];
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
 * Rentals — the shape a property page actually needs.
 *
 * Every section still files under one of the six browse chips
 * (`subcategoryId`), so the Rentals tile and its filters are unchanged, but the
 * sections themselves are what a renter looks for: a SHOP and an OFFICE are not
 * variants of each other, and neither belongs inside "flats & rooms", so they
 * are separate sections rather than two entries in one list.
 *
 * Where a thing narrows further it nests (`folders`): Flats & rooms holds Flat
 * (1 RK, 1 BHK, 2 BHK…) and Room; PG & hostel holds For girls and For boys, and
 * the beds sit inside those. The owner can nest their own folders deeper still.
 */
export const RENTAL_SECTIONS: OfferingSection[] = [
  {
    id: 'flats',
    name: 'Flats & rooms',
    icon: '🏠',
    subcategoryId: 'flats',
    folders: [
      {
        name: 'Flat',
        children: [
          { name: '1 RK' },
          { name: '1 BHK' },
          { name: '2 BHK' },
          { name: '3 BHK' },
          { name: '4 BHK & above' },
          { name: 'Duplex' },
        ],
      },
      {
        name: 'Room',
        children: [
          { name: 'Single room' },
          { name: 'Room with kitchen' },
          { name: 'Sharing room' },
          { name: 'Terrace room' },
        ],
      },
      {
        name: 'Independent house',
        children: [{ name: '2 BHK house' }, { name: '3 BHK house' }, { name: 'Bungalow / villa' }, { name: 'Farmhouse' }],
      },
    ],
  },
  {
    id: 'pg',
    name: 'PG & hostel',
    icon: '🛏️',
    subcategoryId: 'flats',
    folders: [
      {
        name: 'For girls',
        children: [
          { name: 'Single occupancy' },
          { name: 'Double sharing' },
          { name: 'Triple sharing' },
          { name: 'Dormitory' },
        ],
      },
      {
        name: 'For boys',
        children: [
          { name: 'Single occupancy' },
          { name: 'Double sharing' },
          { name: 'Triple sharing' },
          { name: 'Dormitory' },
        ],
      },
      { name: 'Co-ed', children: [{ name: 'Single occupancy' }, { name: 'Double sharing' }] },
    ],
  },
  {
    id: 'shops',
    // No "Shop" folder inside Shops — a plain shop is listed at the section
    // itself. A folder that repeats its section's name is a tap that tells the
    // customer nothing; only the variants that genuinely differ get one.
    name: 'Shops',
    icon: '🏪',
    subcategoryId: 'other',
    folders: [
      { name: 'Showroom' },
      { name: 'Kiosk / stall' },
      { name: 'Basement shop' },
      { name: 'Shop with godown' },
    ],
  },
  {
    id: 'offices',
    name: 'Offices',
    icon: '🏢',
    subcategoryId: 'other',
    folders: [
      { name: 'Private cabin' },
      { name: 'Coworking desk' },
      { name: 'Full floor' },
      { name: 'Meeting room' },
      { name: 'Virtual office' },
    ],
  },
  {
    id: 'godown',
    // Named for the family, not for one member, so "Godown" and "Warehouse"
    // can be folders inside it without either repeating the heading.
    name: 'Godown & storage',
    icon: '📦',
    subcategoryId: 'other',
    folders: [{ name: 'Godown' }, { name: 'Warehouse' }, { name: 'Cold storage' }, { name: 'Open plot' }],
  },
  {
    id: 'halls',
    name: 'Halls & venues',
    icon: '🎪',
    subcategoryId: 'other',
    folders: [{ name: 'Banquet hall' }, { name: 'Marriage garden' }, { name: 'Party lawn' }, { name: 'Conference hall' }],
  },
  {
    id: 'cars',
    name: 'Cars',
    icon: '🚗',
    subcategoryId: 'cars',
    folders: [
      { name: 'Hatchback' },
      { name: 'Sedan' },
      { name: 'SUV' },
      { name: 'Luxury' },
      { name: 'Tempo traveller' },
      { name: 'Self-drive' },
    ],
  },
  {
    id: 'bikes',
    name: 'Bikes',
    icon: '🚲',
    subcategoryId: 'bikes',
    folders: [{ name: 'Scooter' }, { name: 'Motorcycle' }, { name: 'Bicycle' }, { name: 'Electric' }],
  },
  {
    id: 'furniture',
    name: 'Furniture & appliances',
    icon: '🛋️',
    subcategoryId: 'furniture',
    folders: [
      { name: 'Beds & mattress' },
      { name: 'Sofa & seating' },
      { name: 'Tables & chairs' },
      { name: 'Wardrobe' },
      { name: 'Fridge' },
      { name: 'Washing machine' },
      { name: 'AC' },
      { name: 'TV' },
    ],
  },
  {
    id: 'equipment',
    name: 'Equipment & tools',
    icon: '🧰',
    subcategoryId: 'equipment',
    folders: [
      { name: 'Camera & drone' },
      { name: 'Sound & lighting' },
      { name: 'Power tools' },
      { name: 'Construction' },
      { name: 'Medical' },
      { name: 'Kitchen' },
    ],
  },
  {
    id: 'event_gear',
    name: 'Tent & event gear',
    icon: '⛺',
    subcategoryId: 'equipment',
    folders: [
      { name: 'Tent & canopy' },
      { name: 'Chairs & tables' },
      { name: 'Crockery' },
      { name: 'Stage & truss' },
      { name: 'Generator' },
    ],
  },
  {
    id: 'clothing',
    name: 'Clothing & costumes',
    icon: '👗',
    subcategoryId: 'other',
    folders: [{ name: 'Wedding wear' }, { name: 'Costumes' }, { name: 'Suits' }, { name: 'Jewellery' }],
  },
  { id: 'other_rental', name: 'Other', icon: '✨', subcategoryId: 'other' },
];

/**
 * Re-file a rental listed against the OLD rental library.
 *
 * That library folded everything property-shaped into one "Flats & rooms"
 * section, so a PG bed, a shop and a 2 BHK all sat in the same list — which is
 * exactly what made a property page unreadable. The sections are now split
 * (PG & hostel, Shops, Offices, Godown, Halls) and flats nest under Flat.
 *
 * Nothing is rewritten in the database by this function: it maps an old
 * `category`/`subcategory` pair to where it belongs now, so an existing listing
 * reads correctly the moment the app updates. Saving in Manage — which loads
 * items through here — is what makes it stick. Only the exact strings the old
 * library shipped are matched; anything the owner typed themselves is left
 * exactly as it is.
 */
const LEGACY_FLAT_SUBS: Record<string, { category: string; path: string[] }> = {
  '1 rk': { category: 'Flats & rooms', path: ['Flat', '1 RK'] },
  '1 bhk': { category: 'Flats & rooms', path: ['Flat', '1 BHK'] },
  '2 bhk': { category: 'Flats & rooms', path: ['Flat', '2 BHK'] },
  '3 bhk': { category: 'Flats & rooms', path: ['Flat', '3 BHK'] },
  'pg / hostel bed': { category: 'PG & hostel', path: [] },
  'shop / office': { category: 'Shops', path: [] },
  godown: { category: 'Godown & storage', path: ['Godown'] },
  'banquet hall': { category: 'Halls & venues', path: ['Banquet hall'] },
};

export function upgradeRentalFiling<T extends { category?: string; subcategory?: string }>(
  item: T,
): T {
  if ((item.category ?? '').trim().toLowerCase() !== 'flats & rooms') return item;
  const moved = LEGACY_FLAT_SUBS[(item.subcategory ?? '').trim().toLowerCase()];
  if (!moved) return item;
  return { ...item, category: moved.category, subcategory: joinSubcategoryPath(moved.path) };
}

/** The library folders directly inside `path` within a section ([] = its root). */
export function sectionFolders(section: OfferingSection, path: string[]): string[] {
  if (section.folders) {
    let level: OfferingFolder[] | undefined = section.folders;
    for (const seg of path) {
      const hit: OfferingFolder | undefined = level?.find(
        (f) => f.name.toLowerCase() === seg.trim().toLowerCase(),
      );
      level = hit?.children;
      if (!level) return [];
    }
    return (level ?? []).map((f) => f.name);
  }
  // Flat libraries only describe the first level.
  return path.length === 0 ? (section.subcategories ?? []) : [];
}

/**
 * Common JOBS inside a service section — the tap-to-fill suggestions the
 * services editor shows once you've opened a section, the way the dish catalog
 * fills a menu row. Tapping one writes it into the name box, where it stays
 * editable: the library saves the typing, it never decides the wording.
 *
 * Keyed by section id. Where a particular kind of work has its own vocabulary
 * (Repairs > AC is gas refills and servicing; Repairs > Mobile is screens and
 * batteries) `SERVICE_JOBS_BY_KIND` overrides the section's list.
 */
export const SERVICE_JOBS: Record<string, string[]> = {
  repairs: [
    'Inspection & diagnosis',
    'Repair visit',
    'Servicing & cleaning',
    'Part replacement',
    'Annual maintenance (AMC)',
    'Emergency / same-day visit',
  ],
  installation: [
    'Installation',
    'Uninstallation',
    'Shifting & re-installation',
    'Wall mounting',
    'Wiring & fitting',
    'Site visit & measurement',
  ],
  home: [
    'Visit charge',
    'Minor repair',
    'New fitting',
    'Full replacement',
    'Per point',
    'Per sq ft',
  ],
  cleaning: [
    'Deep clean — 1 BHK',
    'Deep clean — 2 BHK',
    'Deep clean — 3 BHK',
    'Kitchen clean',
    'Bathroom clean',
    'Per sofa seat',
    'Per visit',
  ],
  beauty: [
    'Haircut — men',
    'Haircut — women',
    'Hair colour',
    'Facial',
    'Threading',
    'Waxing — full arms',
    'Party makeup',
    'Bridal package',
    'Home visit',
  ],
  health: [
    'First consultation',
    'Follow-up visit',
    'Single session',
    'Package of 10 sessions',
    'Home visit',
    'Monthly membership',
  ],
  classes: [
    'Monthly fee',
    'Quarterly fee',
    'Per class',
    'One-to-one coaching',
    'Batch (group)',
    'Demo class',
    'Crash course',
  ],
  transport: [
    'Within city',
    'Outstation — per km',
    'Per trip',
    'Per day',
    'Loading & unloading',
    'Packing charges',
  ],
  events: [
    'Per event',
    'Half day',
    'Full day',
    'Per day package',
    'Advance booking',
    'Travel extra',
  ],
  tailoring: [
    'Stitching — shirt',
    'Stitching — trouser',
    'Stitching — blouse',
    'Stitching — suit',
    'Alteration',
    'Urgent (24 hr)',
  ],
  professional: [
    'Consultation',
    'Per hour',
    'Per project',
    'Monthly retainer',
    'Filing / paperwork',
    'Annual package',
  ],
  pets: [
    'Bath & grooming',
    'Haircut & trim',
    'Nail clipping',
    'Vaccination',
    'Consultation',
    'Boarding — per night',
  ],
  agri: [
    'Per acre',
    'Per bigha',
    'Per hour',
    'Per day',
    'With operator',
    'Material extra',
  ],
  other_service: ['Per visit', 'Per hour', 'Per day', 'Per piece', 'Consultation'],
};

/** Finer job lists for one kind of work inside a section. */
const SERVICE_JOBS_BY_KIND: Record<string, Record<string, string[]>> = {
  repairs: {
    AC: ['Servicing & cleaning', 'Gas refill', 'Cooling coil repair', 'PCB repair', 'Installation', 'Uninstallation', 'AMC'],
    Refrigerator: ['Gas refill', 'Compressor repair', 'Thermostat replacement', 'Door seal replacement', 'General servicing'],
    'Washing machine': ['Drum repair', 'Motor repair', 'Drain & pipe fix', 'PCB repair', 'General servicing'],
    TV: ['Panel repair', 'Backlight repair', 'Motherboard repair', 'Wall mount fitting'],
    Mobile: ['Screen replacement', 'Battery replacement', 'Charging port repair', 'Water damage service', 'Software / flashing'],
    'Laptop & computer': ['Screen replacement', 'Keyboard replacement', 'Battery replacement', 'SSD / RAM upgrade', 'OS install & format', 'Virus removal'],
    'Water purifier': ['Filter replacement', 'Membrane (RO) replacement', 'Servicing', 'AMC'],
    Vehicle: ['General service', 'Engine repair', 'Brake work', 'Clutch work', 'AC service', 'Denting & painting'],
  },
  beauty: {
    Hair: ['Haircut — men', 'Haircut — women', 'Hair colour', 'Hair spa', 'Straightening', 'Head massage'],
    'Skin & facial': ['Clean-up', 'Facial', 'De-tan', 'Bleach', 'Anti-ageing treatment'],
    Nails: ['Manicure', 'Pedicure', 'Nail extension', 'Nail art'],
    Makeup: ['Party makeup', 'Bridal makeup', 'Engagement makeup', 'Saree draping'],
    'Spa & massage': ['Full body massage', 'Head & shoulder', 'Foot reflexology', 'Couple spa'],
  },
  classes: {
    'School tuition': ['Monthly fee — per subject', 'All subjects', 'Home tuition', 'Batch'],
    'Competitive exams': ['Full course', 'Test series', 'Crash course', 'Doubt sessions'],
    Music: ['Per month', 'Per class', 'One-to-one', 'Instrument provided'],
  },
  transport: {
    'Packers & movers': ['Within city — 1 BHK', 'Within city — 2 BHK', 'Outstation — per km', 'Packing charges', 'Loading & unloading'],
    'Taxi & cab': ['Local — per km', 'Airport drop', 'Outstation — per km', 'Full day (8 hr / 80 km)', 'Waiting charge'],
  },
  events: {
    Photography: ['Per event', 'Full day', 'Pre-wedding shoot', 'Album extra', 'Drone extra'],
    Catering: ['Per plate — veg', 'Per plate — non-veg', 'Snacks counter', 'Live counter'],
    Decoration: ['Basic decor', 'Theme decor', 'Stage decor', 'Flower decor'],
  },
};

/**
 * The jobs to suggest inside a section, narrowed by the kind of work when the
 * library knows that kind. Anything not in the library gets the section's list,
 * so the suggestions never go empty on a kind the owner invented.
 */
export function serviceJobs(sectionId?: string, kind?: string): string[] {
  if (!sectionId) return [];
  const byKind = kind ? SERVICE_JOBS_BY_KIND[sectionId]?.[kind.trim()] : undefined;
  return byKind ?? SERVICE_JOBS[sectionId] ?? [];
}

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
