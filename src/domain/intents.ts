/**
 * Customer-facing browse categories ("intents") — what replaced the four
 * listing-type tiles. Customers think "food", "plumber", "rentals", not
 * "service vs shop", so the Home grid and /browse pages run on these.
 *
 * Each intent is a bundle of catalog tags (see tags.ts); a business belongs
 * to every intent whose tags it carries, so an electronics shop that also
 * repairs phones shows under Electronics AND when its tags say so, under
 * others too. Rentals and Stalls additionally match by listing type, since
 * those listings are shaped by type rather than tags.
 *
 * `ListingType` still exists INTERNALLY (register capability flow, stall
 * folding, rental basis) — it just isn't a customer-facing category anymore.
 */
import type { Business, ListingType } from './types';

export interface IntentCategory {
  id: string;
  label: string;
  icon: string;
  /** Tile accent, used at low opacity behind the icon (data, like catalog colors). */
  color: string;
  /** Catalog tags that place a business under this category. */
  tags: string[];
  /** Extra membership by listing type (rentals, personal stalls). */
  types?: ListingType[];
}

export const INTENT_CATEGORIES: IntentCategory[] = [
  {
    id: 'food',
    label: 'Food',
    icon: '🍽️',
    color: '#EF4444',
    tags: [
      'Restaurant', 'Cafe', 'Bakery', 'Sweet Shop', 'Tea Stall', 'Coffee',
      'Juice Shop', 'Ice Cream', 'Fast Food', 'Street Food', 'Chaat', 'Momos',
      'Rolls & Shawarma', 'Pizza', 'Burger', 'Biryani', 'Chinese',
      'South Indian', 'North Indian', 'Thali', 'Dhaba', 'Pure Veg', 'Non-Veg',
      'Seafood', 'Desserts', 'Cakes', 'Snacks', 'Breakfast', 'Family Dining',
      'Fine Dining', 'Buffet', 'Takeaway', 'Home Delivery', 'Cloud Kitchen',
      'Catering', 'Tiffin Service', 'Mess', 'Paan Shop',
    ],
  },
  {
    id: 'groceries',
    label: 'Groceries',
    icon: '🛒',
    color: '#22C55E',
    tags: [
      'Grocery', 'Kirana Store', 'General Store', 'Supermarket',
      'Vegetables & Fruits', 'Dairy', 'Milk Dairy', 'Meat Shop',
      'Chicken & Mutton', 'Fish Market', 'Eggs', 'Masala & Spices',
      'Dry Fruits', 'Organic Store', 'Flour Mill', 'Milk Delivery',
      'Water Supply', 'Newspaper Delivery',
    ],
  },
  {
    id: 'health',
    label: 'Health',
    icon: '🩺',
    color: '#0EA5E9',
    tags: [
      'Doctor', 'Clinic', 'Hospital', 'Dentist', 'Physiotherapy',
      'Pathology Lab', 'Diagnostics', 'Eye Clinic', 'Skin Clinic',
      'Homeopathy', 'Ayurveda', 'Counselling', 'Ambulance', 'Hearing Aids',
      'Medical Store', 'Pharmacy', 'Opticals', 'Dietician', 'Veterinary',
      'Pet Grooming',
    ],
  },
  {
    id: 'beauty',
    label: 'Beauty',
    icon: '💇',
    color: '#EC4899',
    tags: [
      'Salon', "Men's Salon", 'Ladies Salon', 'Haircut', 'Beauty Parlour',
      'Spa', 'Massage', 'Makeup Artist', 'Bridal Makeup', 'Nail Art',
      'Tattoo', 'Piercing', 'Mehndi', 'Gym', 'Fitness', 'Yoga', 'Zumba',
      'Personal Trainer',
    ],
  },
  {
    id: 'fashion',
    label: 'Fashion',
    icon: '👗',
    color: '#A855F7',
    tags: [
      'Fashion', 'Clothing', 'Menswear', 'Womenswear', 'Kidswear', 'Sarees',
      'Ethnic Wear', 'Boutique', 'Footwear', 'Bags & Luggage', 'Watches',
      'Jewelry', 'Artificial Jewellery', 'Tailor', 'Ladies Tailor',
      'Embroidery', 'Shoe Repair',
    ],
  },
  {
    id: 'home-services',
    label: 'Home Services',
    icon: '🔧',
    color: '#F97316',
    tags: [
      'Electrician', 'Plumber', 'Painter', 'Carpenter', 'Mason',
      'Welder & Fabricator', 'House Cleaning', 'Deep Cleaning',
      'Sofa & Carpet Cleaning', 'Water Tank Cleaning', 'Pest Control',
      'AC Repair', 'AC Installation', 'Fridge Repair',
      'Washing Machine Repair', 'TV Repair', 'Appliance Repair',
      'RO & Water Purifier', 'Geyser Repair', 'Inverter & Battery',
      'Solar Installation', 'CCTV Installation', 'Home Repair',
      'Waterproofing', 'False Ceiling', 'Modular Kitchen',
      'Interior Designer', 'Architect', 'Borewell', 'Gardener',
      'Landscaping', 'Locksmith', 'Glass & Aluminium', 'Curtains & Blinds',
      'Maid Service', 'Cook at Home', 'Babysitter', 'Elder Care',
      'Security Service', 'Pool Service', 'Laundry', 'Dry Cleaning',
      'Ironing', 'Key Maker',
    ],
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    icon: '🚗',
    color: '#3B82F6',
    tags: [
      'Mechanic', 'Car Repair', 'Bike Repair', 'Auto Garage', 'Tyres',
      'Wheel Alignment', 'Vehicle Service', 'Car Wash', 'Car Detailing',
      'Denting & Painting', 'Car AC', 'Battery Shop', 'Spare Parts',
      'Car Accessories', 'Bike Accessories', 'Puncture Repair', 'Towing',
      'Taxi', 'Auto Rickshaw', 'Transport', 'Truck', 'Tempo Service',
      'Packers & Movers', 'Courier', 'Logistics', 'School Bus Service',
      'Bus Service', 'Driving School', 'RTO Agent', 'Car Dealer',
      'Bike Dealer', 'Used Vehicles', 'EV Charging', 'Cycle Store',
    ],
  },
  {
    id: 'education',
    label: 'Education',
    icon: '📚',
    color: '#14B8A6',
    tags: [
      'Tutor', 'Home Tuition', 'Coaching', 'School', 'Preschool & Daycare',
      'College', 'Computer Classes', 'Coding Classes', 'Spoken English',
      'Competitive Exams', 'Abacus', 'Music Classes', 'Dance Classes',
      'Art Classes', 'Singing Classes', 'Swimming Classes',
      'Karate & Self Defence', 'Sports Coaching', 'Cricket Academy',
      'Library', 'Books', 'Stationery',
    ],
  },
  {
    id: 'electronics',
    label: 'Electronics',
    icon: '📱',
    color: '#6366F1',
    tags: [
      'Electronics', 'Mobile Shop', 'Computer Shop', 'Home Appliances',
      'Camera Shop', 'Mobile Repair', 'Laptop Repair', 'Watch Repair',
      'Cyber Cafe', 'Xerox & Photocopy',
    ],
  },
  {
    id: 'furniture',
    label: 'Furniture',
    icon: '🛋️',
    color: '#B45309',
    tags: [
      'Furniture', 'Home Decor', 'Kitchenware', 'Crockery & Utensils',
      'Hardware', 'Paint Store', 'Electrical Shop', 'Sanitaryware',
      'Tiles & Marble', 'Building Material',
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    icon: '🛍️',
    color: '#F59E0B',
    tags: [
      'Stationery', 'Books', 'Toys', 'Gifts', 'Florist', 'Plant Nursery',
      'Pet Shop', 'Aquarium', 'Handicrafts', 'Handmade', 'Art Supplies',
      'Sports Goods', 'Musical Instruments', 'Puja Store', 'Second Hand',
      'Scrap Dealer',
    ],
  },
  {
    id: 'events',
    label: 'Events',
    icon: '🎉',
    color: '#E11D48',
    tags: [
      'Event Planner', 'Wedding Planner', 'Wedding Decor', 'Tent House',
      'DJ & Sound', 'Sound System', 'Lighting & Decoration', 'Mehndi',
      'Band Baja', 'Dhol', 'Anchor & Host', 'Birthday Decoration',
      'Balloon Decoration', 'Party Hall', 'Banquet Hall', 'Marriage Garden',
      'Priest & Pandit', 'Astrologer', 'Invitation Cards', 'Choreographer',
      'Photography', 'Wedding Photography', 'Videography', 'Catering',
    ],
  },
  {
    id: 'digital',
    label: 'Digital',
    icon: '💻',
    color: '#8B5CF6',
    tags: [
      'Photography', 'Videography', 'Wedding Photography', 'Photo Studio',
      'Video Editor', 'Reel Editor', 'Graphic Designer', 'Web Designer',
      'Website Development', 'App Development', 'IT Services',
      'Digital Marketing', 'Social Media Manager', 'Content Writer',
      'Animator', 'Voice Over', 'Printing Press', 'Flex & Banner Printing',
      'T-Shirt Printing',
    ],
  },
  {
    id: 'professional',
    label: 'Professional',
    icon: '💼',
    color: '#0F766E',
    tags: [
      'Accountant', 'CA & Tax', 'GST Services', 'Lawyer', 'Notary',
      'Insurance Agent', 'Loan Agent', 'Real Estate', 'Property Dealer',
      'Broker', 'Builder', 'Travel Agency', 'Tours & Travels',
      'Visa & Passport', 'Ticket Booking', 'Money Transfer',
      'Aadhaar & CSC Services', 'Typing & Documentation', 'Job Placement',
      'Marketing Agency',
    ],
  },
  {
    id: 'rentals',
    label: 'Rentals',
    icon: '🔑',
    color: '#0369A1',
    types: ['rental'],
    tags: [
      'Flats & Rooms', 'Shop for Rent', 'Office Space', 'Car Rental',
      'Bike Rental', 'Cycle Rental', 'Furniture Rental', 'Appliance Rental',
      'Equipment Rental', 'Machinery Rental', 'Costume Rental',
      'Camera Rental', 'Projector Rental', 'Generator Rental', 'Wedding Car',
      'Crane Service', 'JCB & Earthmovers', 'Tractor Rental', 'Scaffolding',
    ],
  },
  {
    id: 'stay',
    label: 'Hotels & Stay',
    icon: '🏨',
    color: '#7C3AED',
    tags: [
      'Hotel', 'Hostel', 'PG & Hostel', 'Lodge', 'Guest House', 'Homestay',
      'Resort', 'Farmhouse', 'Coworking Space',
    ],
  },
  {
    id: 'stalls',
    label: 'Stalls',
    icon: '🏷️',
    color: '#D97706',
    types: ['item'],
    tags: [],
  },
  {
    id: 'agri',
    label: 'Agri & Industry',
    icon: '🚜',
    color: '#65A30D',
    tags: [
      'Agriculture', 'Seeds & Fertilizers', 'Pesticides', 'Tractor Repair',
      'Dairy Farm', 'Poultry Farm', 'Rice Mill', 'Oil Mill', 'Ice Factory',
      'Warehouse', 'Cold Storage', 'Wholesale', 'Distributor',
      'Manufacturer', 'Machine Repair', 'Lathe Works', 'Industrial Supplies',
    ],
  },
];

export function getIntent(id: string | undefined): IntentCategory | undefined {
  return INTENT_CATEGORIES.find((c) => c.id === id);
}

/**
 * Emoji for subcategory TILES (Home's Flipkart-style grid). Covers the
 * popular tags; anything missing falls back to its category's icon via
 * `tagEmoji`. Pure data — grow it as tags earn tiles.
 */
const TAG_EMOJI: Record<string, string> = {
  // Food
  restaurant: '🍽️', cafe: '☕', bakery: '🥐', 'sweet shop': '🍬', 'tea stall': '🫖',
  coffee: '☕', 'juice shop': '🧃', 'ice cream': '🍨', 'fast food': '🍟',
  'street food': '🌮', chaat: '🥗', momos: '🥟', pizza: '🍕', burger: '🍔',
  biryani: '🍛', chinese: '🥡', 'south indian': '🫓', 'north indian': '🍛',
  thali: '🍱', dhaba: '🍲', 'pure veg': '🥦', 'non-veg': '🍗', seafood: '🦐',
  desserts: '🍰', cakes: '🎂', snacks: '🍿', breakfast: '🍳',
  'family dining': '👨‍👩‍👧', 'fine dining': '🥂', buffet: '🍽️', takeaway: '🥡',
  'home delivery': '🛵', catering: '🍲', 'tiffin service': '🥡', mess: '🍚',
  // Groceries & daily
  grocery: '🛒', 'kirana store': '🏪', 'general store': '🏪', supermarket: '🛒',
  'vegetables & fruits': '🥕', dairy: '🥛', 'milk dairy': '🥛', 'meat shop': '🥩',
  'chicken & mutton': '🍗', 'fish market': '🐟', eggs: '🥚', 'masala & spices': '🌶️',
  'dry fruits': '🥜', 'organic store': '🌿', 'flour mill': '🌾', 'milk delivery': '🥛',
  // Health & beauty
  doctor: '🩺', clinic: '🏥', hospital: '🏥', dentist: '🦷', physiotherapy: '💆',
  'pathology lab': '🔬', 'eye clinic': '👁️', homeopathy: '🌼', ayurveda: '🌿',
  ambulance: '🚑', 'medical store': '💊', pharmacy: '💊', opticals: '👓',
  veterinary: '🐾', 'pet grooming': '🐩', salon: '💇', "men's salon": '💈',
  'ladies salon': '💇‍♀️', haircut: '✂️', 'beauty parlour': '💄', spa: '🧖',
  massage: '💆', 'makeup artist': '💄', 'bridal makeup': '👰', 'nail art': '💅',
  tattoo: '🖋️', mehndi: '🌿', gym: '🏋️', fitness: '💪', yoga: '🧘', zumba: '💃',
  'personal trainer': '🏋️', dietician: '🥗',
  // Fashion
  fashion: '👗', clothing: '👕', menswear: '👔', womenswear: '👗', kidswear: '🧒',
  sarees: '🥻', 'ethnic wear': '🥻', boutique: '👗', footwear: '👟',
  'bags & luggage': '🎒', watches: '⌚', jewelry: '💍', 'artificial jewellery': '📿',
  tailor: '🧵', 'ladies tailor': '🪡', embroidery: '🪡', 'shoe repair': '👞',
  // Home services
  electrician: '💡', plumber: '🔧', painter: '🎨', carpenter: '🪚', mason: '🧱',
  'house cleaning': '🧹', 'deep cleaning': '🧽', 'pest control': '🐜',
  'ac repair': '❄️', 'ac installation': '❄️', 'fridge repair': '🧊',
  'washing machine repair': '🌀', 'tv repair': '📺', 'appliance repair': '🔌',
  'ro & water purifier': '🚰', 'geyser repair': '♨️', 'inverter & battery': '🔋',
  'solar installation': '☀️', 'cctv installation': '📹', 'home repair': '🛠️',
  'interior designer': '🛋️', architect: '📐', gardener: '🌱', landscaping: '🌳',
  locksmith: '🔑', 'maid service': '🧹', 'cook at home': '👩‍🍳', babysitter: '🍼',
  'elder care': '🧓', 'security service': '🛡️', laundry: '🧺', 'dry cleaning': '👔',
  ironing: '🧺', 'key maker': '🔑',
  // Vehicles
  mechanic: '🔧', 'car repair': '🚗', 'bike repair': '🏍️', tyres: '🛞',
  'wheel alignment': '🛞', 'vehicle service': '🚗', 'car wash': '🚿',
  'battery shop': '🔋', 'spare parts': '⚙️', 'puncture repair': '🛞', towing: '🚛',
  taxi: '🚕', 'auto rickshaw': '🛺', transport: '🚚', truck: '🚛',
  'packers & movers': '📦', courier: '📦', logistics: '🚛',
  'school bus service': '🚌', 'bus service': '🚌', 'driving school': '🚦',
  'car dealer': '🚙', 'bike dealer': '🏍️', 'used vehicles': '🚗',
  'ev charging': '⚡', 'cycle store': '🚲',
  // Education
  tutor: '📚', 'home tuition': '📖', coaching: '🎯', school: '🏫',
  'preschool & daycare': '🧸', college: '🎓', 'computer classes': '💻',
  'coding classes': '👨‍💻', 'spoken english': '🗣️', 'music classes': '🎵',
  'dance classes': '💃', 'art classes': '🎨', 'singing classes': '🎤',
  'swimming classes': '🏊', 'karate & self defence': '🥋', 'cricket academy': '🏏',
  library: '📚', books: '📚', stationery: '✏️',
  // Electronics & digital
  electronics: '📺', 'mobile shop': '📱', 'computer shop': '💻',
  'home appliances': '🔌', 'camera shop': '📷', 'mobile repair': '🔧',
  'laptop repair': '💻', 'watch repair': '⌚', 'cyber cafe': '🖥️',
  'xerox & photocopy': '🖨️', photography: '📷', videography: '🎥',
  'wedding photography': '📸', 'photo studio': '📸', 'video editor': '🎬',
  'reel editor': '🎬', 'graphic designer': '🎨', 'website development': '🌐',
  'app development': '📱', 'it services': '🖥️', 'digital marketing': '📣',
  'printing press': '🖨️', 't-shirt printing': '👕',
  // Furniture & shopping
  furniture: '🛋️', 'home decor': '🖼️', kitchenware: '🍳',
  'crockery & utensils': '🍽️', hardware: '🔩', 'paint store': '🎨',
  'electrical shop': '💡', sanitaryware: '🚿', 'building material': '🧱',
  toys: '🧸', gifts: '🎁', florist: '💐', 'plant nursery': '🪴', 'pet shop': '🐶',
  aquarium: '🐠', handicrafts: '🧶', handmade: '🧶', 'sports goods': '🏏',
  'musical instruments': '🎸', 'puja store': '🪔', 'second hand': '♻️',
  // Events & professional
  'event planner': '🎪', 'wedding planner': '💒', 'wedding decor': '🌸',
  'tent house': '⛺', 'dj & sound': '🎧', 'sound system': '🔊', 'band baja': '🥁',
  dhol: '🥁', 'birthday decoration': '🎈', 'balloon decoration': '🎈',
  'party hall': '🎉', 'banquet hall': '🏛️', 'marriage garden': '🌳',
  'priest & pandit': '🕉️', astrologer: '🔮', choreographer: '💃',
  accountant: '🧮', 'ca & tax': '🧾', lawyer: '⚖️', 'insurance agent': '🛡️',
  'loan agent': '💰', 'real estate': '🏘️', 'property dealer': '🏘️', builder: '🏗️',
  'travel agency': '✈️', 'tours & travels': '🧳', 'visa & passport': '🛂',
  'ticket booking': '🎫', 'money transfer': '💸', 'job placement': '💼',
  // Rentals, stay, agri
  'flats & rooms': '🏠', 'shop for rent': '🏬', 'office space': '🏢',
  'car rental': '🚗', 'bike rental': '🛵', 'cycle rental': '🚲',
  'furniture rental': '🛋️', 'equipment rental': '🛠️', 'machinery rental': '⚙️',
  'costume rental': '🎭', 'camera rental': '📷', 'generator rental': '🔌',
  'wedding car': '🚘', 'jcb & earthmovers': '🚜', 'tractor rental': '🚜',
  hotel: '🏨', hostel: '🛏️', 'pg & hostel': '🛏️', lodge: '🛎️',
  'guest house': '🏡', homestay: '🏡', resort: '🏖️', farmhouse: '🌾',
  'coworking space': '💼', agriculture: '🌾', 'seeds & fertilizers': '🌱',
  'tractor repair': '🚜', 'dairy farm': '🐄', 'poultry farm': '🐔',
  warehouse: '🏭', 'cold storage': '❄️', wholesale: '📦', distributor: '🚚',
  manufacturer: '🏭', 'machine repair': '⚙️',
};

/** Tile emoji for a tag, falling back to the given category icon. */
export function tagEmoji(tag: string, fallback: string): string {
  return TAG_EMOJI[tag.trim().toLowerCase()] ?? fallback;
}

/** A business belongs to every intent whose tags (or types) it matches. */
export function intentMatches(
  business: Pick<Business, 'tags' | 'type'>,
  intent: IntentCategory,
): boolean {
  if (intent.types?.includes(business.type)) return true;
  const tags = new Set((business.tags ?? []).map((t) => t.trim().toLowerCase()));
  return intent.tags.some((t) => tags.has(t.toLowerCase()));
}
