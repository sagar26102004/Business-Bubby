/**
 * Customer browse categories — COPIED from `src/domain/intents.ts` in the app
 * (colors dropped). Each category is a bundle of tags; a business belongs to
 * every category whose tags it carries. Rentals also match by listing type.
 * Keep in step with the app when categories change.
 */
import type { ListingType } from './types';

export interface Intent {
  id: string;
  label: string;
  icon: string;
  tags: string[];
  types?: ListingType[];
}

export const INTENT_CATEGORIES: Intent[] = [
  {
    id: 'food',
    label: 'Food',
    icon: '🍽️',
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
    tags: [
      'Hotel', 'Hostel', 'PG & Hostel', 'Lodge', 'Guest House', 'Homestay',
      'Resort', 'Farmhouse', 'Coworking Space',
    ],
  },
  // ON HOLD (redesign 2026-10): stall — the Stalls category is hidden from
  // Home, Deals and Browse while stalls are on hold (lib/onHold.ts).
  // {
  //   id: 'stalls',
  //   label: 'Stalls',
  //   icon: '🏷️',
  //   color: '#D97706',
  //   types: ['item'],
  //   tags: [],
  // },
  {
    id: 'agri',
    label: 'Agri & Industry',
    icon: '🚜',
    tags: [
      'Agriculture', 'Seeds & Fertilizers', 'Pesticides', 'Tractor Repair',
      'Dairy Farm', 'Poultry Farm', 'Rice Mill', 'Oil Mill', 'Ice Factory',
      'Warehouse', 'Cold Storage', 'Wholesale', 'Distributor',
      'Manufacturer', 'Machine Repair', 'Lathe Works', 'Industrial Supplies',
    ],
  },
];

export function getIntent(id: string | undefined): Intent | undefined {
  return INTENT_CATEGORIES.find((c) => c.id === id);
}

export function intentMatches(b: { tags: string[]; type: string }, intent: Intent): boolean {
  if (intent.types?.includes(b.type as ListingType)) return true;
  const tags = new Set(b.tags.map((t) => t.trim().toLowerCase()));
  return intent.tags.some((t) => tags.has(t.toLowerCase()));
}
