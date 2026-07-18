/**
 * The tag system — discovery is driven by WHAT A BUSINESS OFFERS, not a
 * single category it's forced into. A business carries many tags (an MRF
 * dealer is Tyres + Wheel alignment + Vehicle service; a cafe is Cafe +
 * Coffee + Desserts), customers search and filter by them, and one business
 * can surface under many chips.
 *
 * Plain data: grow the vocabulary by editing this file. Custom tags typed by
 * owners are allowed too — the catalog is a suggestion list and the curated
 * set browse chips draw from, not a wall.
 */
import type { ListingType } from './types';

export const TAG_CATALOG: string[] = [
  // Food & drink — cuisines and formats are pinpoint tags a place stacks
  // on top of its broad one (Restaurant + Biryani + Family Dining).
  'Restaurant', 'Cafe', 'Bakery', 'Sweet Shop', 'Tea Stall', 'Coffee',
  'Juice Shop', 'Ice Cream', 'Fast Food', 'Street Food', 'Chaat', 'Momos',
  'Rolls & Shawarma', 'Pizza', 'Burger', 'Biryani', 'Chinese',
  'South Indian', 'North Indian', 'Thali', 'Dhaba', 'Pure Veg', 'Non-Veg',
  'Seafood', 'Desserts', 'Cakes', 'Snacks', 'Breakfast', 'Family Dining',
  'Fine Dining', 'Buffet', 'Takeaway', 'Home Delivery', 'Cloud Kitchen',
  'Catering', 'Tiffin Service', 'Mess', 'Paan Shop',
  // Groceries & daily needs
  'Grocery', 'Kirana Store', 'General Store', 'Supermarket',
  'Vegetables & Fruits', 'Dairy', 'Milk Dairy', 'Meat Shop',
  'Chicken & Mutton', 'Fish Market', 'Eggs', 'Masala & Spices', 'Dry Fruits',
  'Organic Store', 'Flour Mill',
  // Shops & retail
  'Medical Store', 'Pharmacy', 'Electronics', 'Mobile Shop', 'Computer Shop',
  'Home Appliances', 'Camera Shop', 'Fashion', 'Clothing', 'Menswear',
  'Womenswear', 'Kidswear', 'Sarees', 'Ethnic Wear', 'Boutique', 'Footwear',
  'Bags & Luggage', 'Watches', 'Opticals', 'Jewelry', 'Artificial Jewellery',
  'Furniture', 'Home Decor', 'Kitchenware', 'Crockery & Utensils', 'Hardware',
  'Paint Store', 'Electrical Shop', 'Sanitaryware', 'Tiles & Marble',
  'Building Material', 'Stationery', 'Books', 'Toys', 'Gifts', 'Florist',
  'Plant Nursery', 'Pet Shop', 'Aquarium', 'Handicrafts', 'Handmade',
  'Art Supplies', 'Sports Goods', 'Cycle Store', 'Musical Instruments',
  'Puja Store', 'Second Hand', 'Scrap Dealer',
  // Home & repair services
  'Electrician', 'Plumber', 'Painter', 'Carpenter', 'Mason',
  'Welder & Fabricator', 'House Cleaning', 'Deep Cleaning',
  'Sofa & Carpet Cleaning', 'Water Tank Cleaning', 'Pest Control',
  'AC Repair', 'AC Installation', 'Fridge Repair', 'Washing Machine Repair',
  'TV Repair', 'Appliance Repair', 'RO & Water Purifier', 'Geyser Repair',
  'Inverter & Battery', 'Solar Installation', 'CCTV Installation',
  'Home Repair', 'Waterproofing', 'False Ceiling', 'Modular Kitchen',
  'Interior Designer', 'Architect', 'Borewell', 'Water Supply', 'Gardener',
  'Landscaping', 'Locksmith', 'Glass & Aluminium', 'Curtains & Blinds',
  'Maid Service', 'Cook at Home', 'Babysitter', 'Elder Care',
  'Security Service', 'Pool Service', 'Laundry', 'Dry Cleaning', 'Ironing',
  'Milk Delivery', 'Newspaper Delivery',
  // Vehicles & transport
  'Mechanic', 'Car Repair', 'Bike Repair', 'Auto Garage', 'Tyres',
  'Wheel Alignment', 'Vehicle Service', 'Car Wash', 'Car Detailing',
  'Denting & Painting', 'Car AC', 'Battery Shop', 'Spare Parts',
  'Car Accessories', 'Bike Accessories', 'Puncture Repair', 'Towing',
  'Taxi', 'Auto Rickshaw', 'Transport', 'Truck', 'Tempo Service',
  'Packers & Movers', 'Courier', 'Logistics', 'School Bus Service',
  'Bus Service', 'Driving School', 'RTO Agent', 'Car Dealer', 'Bike Dealer',
  'Used Vehicles', 'EV Charging',
  // Personal care & wellness
  'Salon', "Men's Salon", 'Ladies Salon', 'Haircut', 'Beauty Parlour', 'Spa',
  'Massage', 'Makeup Artist', 'Bridal Makeup', 'Nail Art', 'Tattoo',
  'Piercing', 'Gym', 'Fitness', 'Yoga', 'Zumba', 'Personal Trainer',
  'Dietician',
  // Health
  'Doctor', 'Clinic', 'Hospital', 'Dentist', 'Physiotherapy',
  'Pathology Lab', 'Diagnostics', 'Eye Clinic', 'Skin Clinic', 'Homeopathy',
  'Ayurveda', 'Counselling', 'Veterinary', 'Pet Grooming', 'Ambulance',
  'Hearing Aids',
  // Education & training
  'Tutor', 'Home Tuition', 'Coaching', 'School', 'Preschool & Daycare',
  'College', 'Computer Classes', 'Coding Classes', 'Spoken English',
  'Competitive Exams', 'Abacus', 'Music Classes', 'Dance Classes',
  'Art Classes', 'Singing Classes', 'Swimming Classes',
  'Karate & Self Defence', 'Sports Coaching', 'Cricket Academy', 'Library',
  // Creative & digital
  'Photography', 'Videography', 'Wedding Photography', 'Photo Studio',
  'Video Editor', 'Reel Editor', 'Graphic Designer', 'Web Designer',
  'Website Development', 'App Development', 'IT Services',
  'Digital Marketing', 'Social Media Manager', 'Content Writer', 'Animator',
  'Voice Over', 'Printing Press', 'Flex & Banner Printing',
  'T-Shirt Printing', 'Xerox & Photocopy', 'Cyber Cafe',
  // Events & occasions
  'Event Planner', 'Wedding Planner', 'Wedding Decor', 'Tent House',
  'DJ & Sound', 'Sound System', 'Lighting & Decoration', 'Mehndi',
  'Band Baja', 'Dhol', 'Anchor & Host', 'Birthday Decoration',
  'Balloon Decoration', 'Party Hall', 'Banquet Hall', 'Marriage Garden',
  'Priest & Pandit', 'Astrologer', 'Invitation Cards', 'Choreographer',
  // Professional & financial
  'Accountant', 'CA & Tax', 'GST Services', 'Lawyer', 'Notary',
  'Insurance Agent', 'Loan Agent', 'Real Estate', 'Property Dealer',
  'Broker', 'Builder', 'Travel Agency', 'Tours & Travels', 'Visa & Passport',
  'Ticket Booking', 'Money Transfer', 'Aadhaar & CSC Services',
  'Typing & Documentation', 'Job Placement', 'Marketing Agency',
  // Repairs & alterations
  'Tailor', 'Ladies Tailor', 'Embroidery', 'Shoe Repair', 'Watch Repair',
  'Mobile Repair', 'Laptop Repair', 'Key Maker',
  // Stay & spaces
  'Hotel', 'Hostel', 'PG & Hostel', 'Lodge', 'Guest House', 'Homestay',
  'Resort', 'Farmhouse', 'Coworking Space',
  // Rentals
  'Flats & Rooms', 'Shop for Rent', 'Office Space', 'Car Rental',
  'Bike Rental', 'Cycle Rental', 'Furniture Rental', 'Appliance Rental',
  'Equipment Rental', 'Machinery Rental', 'Costume Rental', 'Camera Rental',
  'Projector Rental', 'Generator Rental', 'Wedding Car', 'Crane Service',
  'JCB & Earthmovers', 'Tractor Rental', 'Scaffolding',
  // Agriculture & industry
  'Agriculture', 'Seeds & Fertilizers', 'Pesticides', 'Tractor Repair',
  'Dairy Farm', 'Poultry Farm', 'Rice Mill', 'Oil Mill', 'Ice Factory',
  'Warehouse', 'Cold Storage', 'Wholesale', 'Distributor', 'Manufacturer',
  'Machine Repair', 'Lathe Works', 'Industrial Supplies',
];

/**
 * Quick-picks for the register tag step. Registration no longer asks "what
 * category is your business" — owners just tag what they do, so this list
 * spans every kind of business.
 */
export const SUGGESTED_BUSINESS_TAGS: string[] = [
  'Cafe', 'Restaurant', 'Bakery', 'Grocery', 'Clothing', 'Electronics',
  'Medical Store', 'Salon', 'Gym', 'Electrician', 'Plumber', 'AC Repair',
  'Mechanic', 'Tyres', 'Tutor', 'Photography', 'Video Editor',
  'Event Planner', 'Tent House', 'Tailor', 'Taxi', 'Transport', 'Laundry',
  'Real Estate', 'Hotel', 'Flats & Rooms', 'Car Rental', 'Bike Rental',
];

/** Quick-pick suggestions per listing type, shown as chips while registering. */
export const SUGGESTED_TAGS: Record<ListingType, string[]> = {
  service: [
    'Electrician', 'Plumber', 'House Cleaning', 'AC Repair', 'Mechanic',
    'Salon', 'Tutor', 'Photography', 'Video Editor', 'Event Planner',
    'Insurance Agent', 'Taxi', 'Transport', 'Tailor', 'Laundry',
  ],
  shop: [
    'Cafe', 'Restaurant', 'Bakery', 'Grocery', 'Clothing', 'Electronics',
    'Stationery', 'Medical Store', 'Hardware', 'Florist', 'Handmade', 'Dairy',
  ],
  item: [],
  rental: [
    'Flats & Rooms', 'PG & Hostel', 'Car Rental', 'Bike Rental',
    'Furniture Rental', 'Equipment Rental', 'Tent House', 'Costume Rental',
  ],
};

/** Case-insensitive "does this business carry this tag". */
export function hasTag(tags: string[] | undefined, name: string): boolean {
  const target = name.trim().toLowerCase();
  return !!tags?.some((t) => t.trim().toLowerCase() === target);
}

/** True when a tag exists in the curated catalog (any casing). */
export function isCatalogTag(name: string): boolean {
  const target = name.trim().toLowerCase();
  return TAG_CATALOG.some((t) => t.toLowerCase() === target);
}

const FOOD_SHOP_TAGS = [
  'cafe', 'restaurant', 'bakery', 'sweet shop', 'tea stall', 'juice shop',
  'ice cream', 'fast food', 'pizza', 'burger', 'biryani', 'chinese',
  'family dining', 'catering', 'tiffin service', 'street food', 'chaat',
  'momos', 'rolls & shawarma', 'south indian', 'north indian', 'thali',
  'dhaba', 'fine dining', 'buffet', 'cloud kitchen', 'mess', 'seafood',
];

/**
 * Food-tagged shops get a "menu"; every other shop's items read as a product
 * catalog. Same registration question, routed to the right shape.
 */
export function isFoodShop(tags: string[]): boolean {
  return tags.some((t) => FOOD_SHOP_TAGS.includes(t.trim().toLowerCase()));
}
