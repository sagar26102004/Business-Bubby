/**
 * The GOODS catalog — the prebuilt taxonomy a shop picks from when it lists
 * what it sells, the same idea as the restaurant menu library in
 * `domain/foodMenu.ts` and the service/rental libraries in
 * `domain/offeringSections.ts`, applied to physical products.
 *
 * Before this, a shop listing an air conditioner typed one free-text line and
 * the whole catalog came out as an undifferentiated pile: "split ac 1.5t",
 * "AC 2 ton samsung", "Voltas 1.5". Products now go in through four picks that
 * narrow each other:
 *
 *   Category            Home electronics
 *     +- Type           Air conditioner          -> lands on `subcategory`
 *        +- Brand       Samsung / Voltas / LG    -> lands on `brand`
 *           +- Spec     1.5 Ton, Split, 5 Star   -> lands on `variants`
 *
 * ...and only the price is typed. The model number is optional: with the picks
 * made, `composeProductName` writes the listing's name ("Samsung 1.5 Ton Split
 * Air conditioner"), so an owner adds a whole row of stock without typing a
 * name once, and every shop in the app files the same product the same way.
 *
 * A category's `name` lands on `ProductItem.category` and a type on
 * `.subcategory` — the two fields the business page's `OfferingsSection`
 * already groups by, so organising here shows up for customers with no extra
 * plumbing. Each category also carries `subcategoryId`, the `domain/catalog.ts`
 * STALL subcategory it files under, so the Stalls browse chips keep matching
 * (see `browse/[type].tsx`).
 *
 * The library is a head start, never a cage: every row of chips ends in
 * "＋ Own" and a typed value is kept as-is.
 */
import type { OfferingSection } from './offeringSections';

/** One kind of thing inside a category — "Air conditioner", "Tyres". */
export interface ProductType {
  name: string;
  /** Brands that actually sell this thing; falls back to the category's. */
  brands?: string[];
  /** Spec chips — capacity, size, pack. Multi-pick; falls back to the category's. */
  variants?: string[];
  /** Heading over the spec chips, e.g. "Capacity & type". */
  variantLabel?: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  icon: string;
  /** The `domain/catalog.ts` STALL subcategory this files under, for browse chips. */
  subcategoryId: string;
  /** Brands for types that don't name their own. */
  brands?: string[];
  /** Spec chips for types that don't name their own. */
  variants?: string[];
  variantLabel?: string;
  types: ProductType[];
}

/* --- Brand lists ---------------------------------------------------------
   Shared between the types that sell them, so "Samsung" is spelt one way
   across the whole app. Ordered roughly by how often an Indian local shop
   stocks them, because the first chips are the ones that get tapped.        */

const COOLING = ['Voltas', 'Blue Star', 'LG', 'Samsung', 'Daikin', 'Hitachi', 'Carrier', 'Lloyd', 'Panasonic', 'Godrej', 'Whirlpool', 'Haier', 'O General', 'Mitsubishi'];
const TV_BRANDS = ['Samsung', 'LG', 'Sony', 'TCL', 'Mi', 'Realme', 'OnePlus', 'Panasonic', 'Haier', 'VU', 'Toshiba', 'Croma'];
const WHITE_GOODS = ['LG', 'Samsung', 'Whirlpool', 'Godrej', 'Haier', 'Bosch', 'IFB', 'Panasonic', 'Voltas Beko', 'Croma'];
const FANS = ['Crompton', 'Havells', 'Orient', 'Usha', 'Bajaj', 'Atomberg', 'Luminous', 'V-Guard', 'Polycab', 'Khaitan'];
const PURIFIERS = ['Kent', 'Aquaguard', 'Pureit', 'Livpure', 'Blue Star', 'Havells', 'AO Smith'];
const PHONES = ['Samsung', 'Apple', 'Redmi', 'Realme', 'Vivo', 'Oppo', 'OnePlus', 'Motorola', 'Poco', 'iQOO', 'Nothing', 'Infinix', 'Tecno', 'Nokia'];
const COMPUTERS = ['HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'Apple', 'MSI', 'Samsung', 'Infinix'];
const AUDIO = ['boAt', 'JBL', 'Sony', 'Noise', 'Realme', 'Samsung', 'Boult', 'Zebronics', 'Philips'];
const KITCHEN = ['Prestige', 'Pigeon', 'Butterfly', 'Bajaj', 'Philips', 'Havells', 'Preethi', 'Sujata', 'Usha', 'Hawkins', 'Wonderchef', 'Borosil'];
const HOMEWARE = ['Milton', 'Cello', 'Borosil', 'Signoraware', 'Tupperware', 'Nayasa', 'Prestige', 'Local / unbranded'];
const FURNITURE = ['Nilkamal', 'Godrej Interio', 'Sleepwell', 'Kurlon', 'Duroflex', 'Wakefit', 'Supreme', 'Cello', 'Local / handmade'];
const SPICES = ['MDH', 'Everest', 'Catch', 'Tata Sampann', 'Badshah', 'Goldiee', 'Local / loose'];
const GROCERY = ['Aashirvaad', 'Fortune', 'Tata', 'ITC', 'Patanjali', 'Amul', 'Nestle', 'Britannia', 'Parle', 'Saffola', 'Daawat', 'India Gate', 'Local / loose'];
const PERSONAL = ['Himalaya', 'Dove', 'Nivea', 'Lakme', "L'Oreal", 'Patanjali', 'Mamaearth', 'Ponds', 'Vaseline', 'Garnier'];
const CLEANING = ['Surf Excel', 'Ariel', 'Tide', 'Rin', 'Ghadi', 'Nirma', 'Vim', 'Harpic', 'Lizol', 'Colin', 'Domex'];
const APPAREL = ['Levis', 'Peter England', 'Allen Solly', 'Van Heusen', 'US Polo', 'Jockey', 'Raymond', 'Puma', 'Nike', 'Adidas', 'Local / unbranded'];
const FOOTWEAR = ['Bata', 'Liberty', 'Campus', 'Sparx', 'Relaxo', 'Puma', 'Nike', 'Adidas', 'Woodland', 'Paragon'];
const TOOLS = ['Bosch', 'Makita', 'Stanley', 'Black+Decker', 'DeWalt', 'Taparia', 'Jon', 'Cumi', 'Ingco'];
const ELECTRICALS = ['Havells', 'Anchor', 'Legrand', 'Polycab', 'Finolex', 'V-Guard', 'Schneider', 'GM', 'Wipro', 'Syska'];
const PAINTS = ['Asian Paints', 'Berger', 'Nerolac', 'Dulux', 'Indigo', 'Shalimar', 'JSW'];
const BUILDING = ['UltraTech', 'ACC', 'Ambuja', 'Shree', 'Birla', 'Dalmia', 'JK Lakshmi'];
const SANITARY = ['Jaquar', 'Cera', 'Hindware', 'Parryware', 'Kajaria', 'Somany', 'Supreme', 'Astral'];
const TYRES = ['MRF', 'Apollo', 'CEAT', 'JK Tyre', 'Bridgestone', 'Michelin', 'Goodyear', 'Yokohama', 'TVS Eurogrip'];
const BATTERIES = ['Exide', 'Amaron', 'Luminous', 'SF Sonic', 'Livguard', 'Okaya'];
const LUBRICANTS = ['Castrol', 'Servo', 'Shell', 'Mobil', 'HP', 'Valvoline', 'Motul', 'Gulf'];
const STATIONERY = ['Classmate', 'Camlin', 'Apsara', 'Nataraj', 'Reynolds', 'Cello', 'Doms', 'Faber-Castell', 'Luxor'];
const SPORTS = ['SG', 'SS', 'Cosco', 'Nivia', 'Yonex', 'Vector X', 'Puma', 'Nike', 'Adidas'];
const PHARMA = ['Cipla', 'Sun Pharma', "Dr. Reddy's", 'Mankind', 'Abbott', 'Himalaya', 'Dabur', 'Baidyanath', 'Zandu'];
const PET = ['Pedigree', 'Drools', 'Royal Canin', 'Whiskas', 'Farmina', 'Himalaya'];
const AGRI = ['IFFCO', 'Coromandel', 'Syngenta', 'Bayer', 'UPL', 'Rallis', 'Mahyco', 'Nuziveedu', 'Kirloskar', 'Honda'];

/* --- Spec chips ---------------------------------------------------------- */

const PACK_SIZES = ['100 g', '250 g', '500 g', '1 kg', '5 kg', '10 kg', '25 kg', '500 ml', '1 L', '5 L'];
const CLOTH_SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size'];
const SHOE_SIZES = ['6', '7', '8', '9', '10', '11', 'Kids'];
const BED_SIZES = ['Single', 'Double', 'Queen', 'King'];

/** Compact row form — keeps a long catalog readable and diffable. */
type TypeRow = [name: string, brands?: string[], variants?: string[], variantLabel?: string];

function types(rows: TypeRow[]): ProductType[] {
  return rows.map(([name, brands, variants, variantLabel]) => ({ name, brands, variants, variantLabel }));
}

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: 'home_electronics',
    name: 'Home electronics',
    icon: '📺',
    subcategoryId: 'electronics',
    brands: TV_BRANDS,
    variantLabel: 'Size & type',
    types: types([
      ['Air conditioner', COOLING, ['1 Ton', '1.5 Ton', '2 Ton', 'Window', 'Split', 'Inverter', '3 Star', '5 Star'], 'Capacity & type'],
      ['Television', TV_BRANDS, ['32 inch', '43 inch', '50 inch', '55 inch', '65 inch', 'Smart', '4K', 'QLED'], 'Screen size'],
      ['Refrigerator', WHITE_GOODS, ['190 L', '230 L', '260 L', '340 L', 'Single door', 'Double door', 'Side by side'], 'Capacity & doors'],
      ['Washing machine', WHITE_GOODS, ['6 kg', '6.5 kg', '7 kg', '8 kg', 'Top load', 'Front load', 'Semi automatic', 'Fully automatic'], 'Capacity & type'],
      ['Fan', FANS, ['Ceiling', 'Table', 'Pedestal', 'Wall', 'Exhaust', '1200 mm', '900 mm', 'BLDC'], 'Type & sweep'],
      ['Air cooler', ['Symphony', 'Bajaj', 'Crompton', 'Havells', 'Voltas', 'Orient', 'Usha'], ['35 L', '50 L', '75 L', '100 L', 'Personal', 'Desert', 'Tower'], 'Tank & type'],
      ['Water purifier', PURIFIERS, ['RO', 'UV', 'RO + UV', 'Gravity', '7 L', '8 L', '10 L'], 'Purification & tank'],
      ['Microwave oven', WHITE_GOODS, ['20 L', '23 L', '28 L', '32 L', 'Solo', 'Grill', 'Convection'], 'Capacity & type'],
      ['Geyser / water heater', ['Havells', 'Bajaj', 'V-Guard', 'Racold', 'AO Smith', 'Crompton', 'Venus'], ['3 L', '10 L', '15 L', '25 L', 'Instant', 'Storage'], 'Capacity & type'],
      ['Inverter & battery', ['Luminous', 'Microtek', 'V-Guard', 'Exide', 'Amaron', 'Livguard', 'Okaya'], ['600 VA', '900 VA', '1100 VA', '1500 VA', '150 Ah', '200 Ah', 'Tubular'], 'Capacity'],
      ['Stabiliser', ['V-Guard', 'Microtek', 'Everest', 'Candes', 'Syska'], ['For AC', 'For fridge', 'For TV', '4 kVA', '5 kVA'], 'Made for'],
      ['Sewing machine', ['Usha', 'Singer', 'Brother', 'Merritt'], ['Manual', 'Electric', 'Portable'], 'Type'],
      ['Home theatre & speakers', AUDIO, ['Soundbar', 'Bluetooth', '2.1', '5.1', 'Party speaker'], 'Type'],
      ['Iron & garment steamer', ['Bajaj', 'Philips', 'Havells', 'Usha', 'Crompton'], ['Dry', 'Steam', 'Garment steamer'], 'Type'],
      ['Vacuum cleaner', ['Eureka Forbes', 'Philips', 'Bosch', 'Karcher', 'Agaro'], ['Handheld', 'Canister', 'Wet & dry', 'Robotic'], 'Type'],
      ['Spare parts & accessories'],
    ]),
  },
  {
    id: 'mobiles_computers',
    name: 'Mobiles & computers',
    icon: '📱',
    subcategoryId: 'electronics',
    brands: PHONES,
    variantLabel: 'Configuration',
    types: types([
      ['Mobile phone', PHONES, ['4 GB / 64 GB', '6 GB / 128 GB', '8 GB / 128 GB', '8 GB / 256 GB', '12 GB / 256 GB', '5G', 'Keypad'], 'RAM & storage'],
      ['Tablet', [...PHONES.slice(0, 6), 'Lenovo', 'HP'], ['Wi-Fi', '4G', '64 GB', '128 GB', '256 GB'], 'Configuration'],
      ['Laptop', COMPUTERS, ['i3', 'i5', 'i7', 'Ryzen 5', 'Ryzen 7', '8 GB RAM', '16 GB RAM', '512 GB SSD', '1 TB'], 'Processor & memory'],
      ['Desktop computer', COMPUTERS, ['i3', 'i5', 'i7', 'Ryzen 5', 'All-in-one', 'Assembled', 'Gaming'], 'Processor & build'],
      ['Monitor', [...COMPUTERS, 'BenQ', 'ViewSonic'], ['19 inch', '22 inch', '24 inch', '27 inch', 'IPS', 'Curved'], 'Screen size'],
      ['Printer', ['HP', 'Canon', 'Epson', 'Brother', 'Samsung'], ['Inkjet', 'Laser', 'All-in-one', 'Colour', 'Black & white'], 'Type'],
      ['Smartwatch & band', ['Noise', 'boAt', 'Fire-Boltt', 'Samsung', 'Apple', 'Amazfit', 'Realme'], ['Bluetooth calling', 'AMOLED', 'Fitness band'], 'Type'],
      ['Earphones & headphones', AUDIO, ['Wired', 'Wireless', 'TWS', 'Neckband', 'Over-ear'], 'Type'],
      ['Power bank', ['Mi', 'Realme', 'boAt', 'Ambrane', 'Syska', 'Anker'], ['10000 mAh', '20000 mAh', 'Fast charge'], 'Capacity'],
      ['Router & networking', ['TP-Link', 'D-Link', 'Netgear', 'Tenda', 'Mercusys'], ['Single band', 'Dual band', '4G SIM', 'Mesh'], 'Type'],
      ['Camera & CCTV', ['Canon', 'Nikon', 'Sony', 'GoPro', 'DJI', 'CP Plus', 'Hikvision'], ['DSLR', 'Mirrorless', 'Action', 'CCTV', 'Drone'], 'Type'],
      ['Storage & memory', ['SanDisk', 'Samsung', 'WD', 'Seagate', 'Kingston', 'Crucial'], ['32 GB', '64 GB', '128 GB', '256 GB', '1 TB', '2 TB', 'Pendrive', 'SSD', 'Hard disk'], 'Capacity & type'],
      ['Mobile accessories', [...PHONES.slice(0, 5), 'boAt', 'Spigen', 'Local / unbranded'], ['Cover', 'Screen guard', 'Charger', 'Cable', 'Holder'], 'Kind'],
      ['Repair parts'],
    ]),
  },
  {
    id: 'kitchen_appliances',
    name: 'Kitchen appliances',
    icon: '🍳',
    subcategoryId: 'appliances',
    brands: KITCHEN,
    variantLabel: 'Size & type',
    types: types([
      ['Mixer grinder', KITCHEN, ['500 W', '750 W', '1000 W', '2 jar', '3 jar', '4 jar'], 'Power & jars'],
      ['Gas stove', [...KITCHEN, 'Sunflame', 'Glen', 'Elica'], ['2 burner', '3 burner', '4 burner', 'Glass top', 'Stainless steel'], 'Burners & top'],
      ['Induction cooktop', KITCHEN, ['1200 W', '1800 W', '2000 W', 'Touch panel'], 'Power'],
      ['Chimney', ['Elica', 'Faber', 'Glen', 'Hindware', 'Sunflame'], ['60 cm', '90 cm', 'Auto clean', 'Filterless'], 'Size'],
      ['Pressure cooker', ['Hawkins', 'Prestige', 'Butterfly', 'Pigeon', 'United'], ['2 L', '3 L', '5 L', '7.5 L', '10 L', 'Aluminium', 'Stainless steel'], 'Capacity'],
      ['Cookware & utensils', [...HOMEWARE, 'Hawkins', 'Vinod'], ['Non-stick', 'Stainless steel', 'Aluminium', 'Cast iron', 'Set'], 'Material'],
      ['Water bottle & flask', HOMEWARE, ['500 ml', '750 ml', '1 L', 'Steel', 'Copper', 'Insulated'], 'Capacity & material'],
      ['Toaster, OTG & air fryer', KITCHEN, ['Pop-up toaster', 'Sandwich maker', 'OTG 20 L', 'OTG 30 L', 'Air fryer'], 'Type'],
      ['Electric kettle & juicer', KITCHEN, ['1 L', '1.5 L', 'Kettle', 'Juicer', 'Blender', 'Hand mixer'], 'Type'],
      ['Storage & containers', HOMEWARE, ['Set of 3', 'Set of 6', 'Steel', 'Plastic', 'Glass', 'Casserole'], 'Kind'],
      ['Water dispenser & cans', ['Bisleri', 'Kent', 'Blue Star', 'Voltas', 'Local / refill'], ['20 L can', 'Hot & cold', 'Table top'], 'Type'],
    ]),
  },
  {
    id: 'furniture',
    name: 'Furniture',
    icon: '🛋️',
    subcategoryId: 'furniture',
    brands: FURNITURE,
    variantLabel: 'Size & material',
    types: types([
      ['Bed', FURNITURE, [...BED_SIZES, 'With storage', 'Hydraulic', 'Wooden', 'Metal'], 'Size'],
      ['Mattress', ['Sleepwell', 'Kurlon', 'Duroflex', 'Wakefit', 'Springwel', 'Local / handmade'], ['3 inch', '4 inch', '5 inch', '6 inch', '8 inch', ...BED_SIZES, 'Foam', 'Spring', 'Coir'], 'Thickness & size'],
      ['Sofa & seating', FURNITURE, ['1 seater', '2 seater', '3 seater', 'L-shape', 'Recliner', 'Fabric', 'Leatherette'], 'Seats'],
      ['Chair', FURNITURE, ['Plastic', 'Office', 'Gaming', 'Dining', 'Folding', 'Executive'], 'Type'],
      ['Table', FURNITURE, ['Dining 4 seater', 'Dining 6 seater', 'Study', 'Centre', 'Computer', 'Folding'], 'Type'],
      ['Wardrobe & storage', FURNITURE, ['2 door', '3 door', '4 door', 'Sliding', 'Steel almirah', 'Chest of drawers'], 'Doors'],
      ['Shoe rack & shelves', FURNITURE, ['2 tier', '3 tier', '4 tier', 'Wall shelf', 'Bookshelf'], 'Tiers'],
      ['Office furniture', ['Godrej Interio', 'Featherlite', 'Nilkamal', 'Local / handmade'], ['Workstation', 'Conference table', 'Filing cabinet', 'Reception'], 'Kind'],
      ['Modular kitchen & wardrobe', ['Local / handmade', 'Sleek', 'Hettich', 'Ebco'], ['Per sq ft', 'Full kitchen', 'Loft', 'Accessories'], 'Sold as'],
      ['Furnishing accessories'],
    ]),
  },
  {
    id: 'grocery',
    name: 'Grocery & daily needs',
    icon: '🛒',
    subcategoryId: 'other',
    brands: GROCERY,
    variants: PACK_SIZES,
    variantLabel: 'Pack size',
    types: types([
      ['Rice & grains', ['Daawat', 'India Gate', 'Kohinoor', 'Fortune', 'Local / loose']],
      ['Atta & flour', ['Aashirvaad', 'Fortune', 'Pillsbury', 'Patanjali', 'Local / chakki']],
      ['Pulses & dal', ['Tata Sampann', 'Fortune', 'Aashirvaad', 'Local / loose']],
      ['Cooking oil & ghee', ['Fortune', 'Saffola', 'Dhara', 'Patanjali', 'Amul', 'Sundrop', 'Local / kachi ghani']],
      ['Spices & masala', SPICES],
      ['Sugar, salt & jaggery', ['Tata', 'Aashirvaad', 'Patanjali', 'Local / loose']],
      ['Tea & coffee', ['Tata Tea', 'Red Label', 'Taj Mahal', 'Society', 'Nescafe', 'Bru', 'Wagh Bakri']],
      ['Snacks & namkeen', ['Haldirams', 'Bikaji', 'Lays', 'Kurkure', 'Balaji', 'Local / homemade']],
      ['Biscuits & bakery', ['Parle', 'Britannia', 'Sunfeast', 'Unibic', 'Local / bakery']],
      ['Dairy & eggs', ['Amul', 'Mother Dairy', 'Sanchi', 'Nestle', 'Local / dairy']],
      ['Cold drinks & juices', ['Coca-Cola', 'Pepsi', 'Sprite', 'Thums Up', 'Real', 'Tropicana', 'Frooti', 'Bisleri']],
      ['Dry fruits & nuts', ['Happilo', 'Nutraj', 'Tata Sampann', 'Local / loose']],
      ['Instant food & noodles', ['Maggi', 'Yippee', 'Knorr', 'MTR', 'Gits', 'Top Ramen']],
      ['Fruits & vegetables', ['Local / farm fresh']],
      ['Puja & festive items', ['Cycle', 'Mangaldeep', 'Zed Black', 'Local / handmade']],
    ]),
  },
  {
    id: 'personal_care',
    name: 'Beauty & personal care',
    icon: '🧴',
    subcategoryId: 'other',
    brands: PERSONAL,
    variants: ['50 g', '100 g', '100 ml', '200 ml', '400 ml', 'Combo pack', 'Sachet'],
    variantLabel: 'Pack size',
    types: types([
      ['Soap & body wash', ['Lux', 'Lifebuoy', 'Dove', 'Santoor', 'Dettol', 'Cinthol', 'Patanjali']],
      ['Shampoo & hair care', ['Head & Shoulders', 'Clinic Plus', 'Dove', 'Sunsilk', 'Pantene', "L'Oreal", 'Indulekha']],
      ['Skin care', PERSONAL],
      ['Oral care', ['Colgate', 'Pepsodent', 'Closeup', 'Sensodyne', 'Dabur Red', 'Patanjali']],
      ['Deodorant & perfume', ['Fogg', 'Wild Stone', 'Park Avenue', 'Engage', 'Axe', 'Nivea']],
      ['Shaving & grooming', ['Gillette', 'Philips', 'Havells', 'Syska', 'Nova', 'Vega']],
      ['Cosmetics & makeup', ['Lakme', 'Maybelline', "L'Oreal", 'Sugar', 'Blue Heaven', 'Swiss Beauty']],
      ['Baby care', ['Johnson', 'Himalaya', 'Mamaearth', 'Pampers', 'Huggies', 'Sebamed']],
      ['Sanitary & hygiene', ['Whisper', 'Stayfree', 'Sofy', 'Dettol', 'Savlon']],
    ]),
  },
  {
    id: 'household',
    name: 'Home & cleaning',
    icon: '🧹',
    subcategoryId: 'home-goods',
    brands: CLEANING,
    variants: ['500 g', '1 kg', '500 ml', '1 L', '5 L', 'Refill', 'Combo pack'],
    variantLabel: 'Pack size',
    types: types([
      ['Detergent & laundry', ['Surf Excel', 'Ariel', 'Tide', 'Rin', 'Ghadi', 'Nirma', 'Ujala', 'Comfort']],
      ['Cleaning supplies', ['Vim', 'Harpic', 'Lizol', 'Colin', 'Domex', 'Dettol', 'Scotch-Brite']],
      ['Bedsheets & curtains', ['Bombay Dyeing', 'Raymond Home', 'Portico', 'Local / handmade'], ['Single', 'Double', 'King', 'Door', 'Window'], 'Size'],
      ['Home decor', ['Local / handmade', 'Hometown', 'Chumbak'], ['Wall art', 'Clock', 'Vase', 'Photo frame', 'Artificial plant'], 'Kind'],
      ['Lighting & lamps', ELECTRICALS, ['LED bulb 9 W', 'LED bulb 12 W', 'Tube light', 'Panel light', 'Emergency light', 'Decorative'], 'Kind'],
      ['Plastic ware & buckets', ['Nilkamal', 'Cello', 'Supreme', 'Nayasa', 'Milton']],
      ['Mops, brooms & bins', ['Scotch-Brite', 'Spotzero', 'Gala', 'Nilkamal', 'Cello']],
      ['Pooja items', ['Cycle', 'Mangaldeep', 'Zed Black', 'Local / handmade']],
      ['Mosquito & pest', ['Good Knight', 'All Out', 'Mortein', 'HIT', 'Maxo']],
    ]),
  },
  {
    id: 'clothing',
    name: 'Clothing & footwear',
    icon: '👕',
    subcategoryId: 'other',
    brands: APPAREL,
    variants: CLOTH_SIZES,
    variantLabel: 'Size',
    types: types([
      ["Men's wear", APPAREL, [...CLOTH_SIZES, 'Shirt', 'T-shirt', 'Trouser', 'Jeans', 'Kurta', 'Jacket'], 'Size & kind'],
      ["Women's wear", ['Biba', 'W', 'Aurelia', 'Fabindia', 'Local / boutique', ...APPAREL.slice(0, 4)], [...CLOTH_SIZES, 'Saree', 'Kurti', 'Suit', 'Top', 'Jeans', 'Dupatta'], 'Size & kind'],
      ['Kids wear', ['Local / unbranded', 'Babyhug', 'Max', 'Gini & Jony'], ['0-1 yr', '1-2 yr', '2-4 yr', '4-6 yr', '6-8 yr', '8-12 yr'], 'Age'],
      ['Ethnic & wedding wear', ['Manyavar', 'Local / boutique', 'Fabindia', 'Raymond'], [...CLOTH_SIZES, 'Sherwani', 'Lehenga', 'Saree', 'Suit set'], 'Size & kind'],
      ['Footwear', FOOTWEAR, [...SHOE_SIZES, 'Sports', 'Formal', 'Casual', 'Sandal', 'Slipper'], 'Size & kind'],
      ['Bags & luggage', ['Skybags', 'American Tourister', 'VIP', 'Wildcraft', 'Safari', 'Local / unbranded'], ['Backpack', 'Trolley 55 cm', 'Trolley 65 cm', 'Duffel', 'Laptop bag', 'School bag'], 'Kind'],
      ['Watches', ['Titan', 'Fastrack', 'Casio', 'Sonata', 'Timex', 'Fossil'], ['Analog', 'Digital', 'Chronograph', 'Mens', 'Womens'], 'Kind'],
      ['Jewellery & accessories', ['Local / handmade', 'Tanishq', 'Voylla', 'Giva'], ['Gold', 'Silver', 'Artificial', 'Imitation', 'Kundan'], 'Material'],
      ['Innerwear & nightwear', ['Jockey', 'Rupa', 'VIP', 'Dollar', 'Amul Macho'], CLOTH_SIZES, 'Size'],
      ['Fabric & cloth', ['Raymond', 'Siyaram', 'Local / mill'], ['Cotton', 'Linen', 'Silk', 'Polyester', 'Per metre'], 'Material'],
    ]),
  },
  {
    id: 'hardware',
    name: 'Hardware & building',
    icon: '🔩',
    subcategoryId: 'other',
    brands: TOOLS,
    variantLabel: 'Size & type',
    types: types([
      ['Power tools', TOOLS, ['Drill', 'Angle grinder', 'Cutter', 'Welding', 'Cordless'], 'Kind'],
      ['Hand tools', ['Taparia', 'Stanley', 'Jon', 'Venus', 'Local / unbranded'], ['Spanner set', 'Screwdriver set', 'Plier', 'Hammer', 'Tool kit'], 'Kind'],
      ['Paint & putty', PAINTS, ['1 L', '4 L', '10 L', '20 L', 'Interior', 'Exterior', 'Emulsion', 'Enamel', 'Primer', 'Putty'], 'Pack & type'],
      ['Cement & building material', BUILDING, ['50 kg bag', 'OPC 43', 'OPC 53', 'PPC', 'White cement'], 'Pack & grade'],
      ['Tiles & sanitary', SANITARY, ['2x2 ft', '1x1 ft', 'Floor', 'Wall', 'Wash basin', 'WC', 'Tap & fitting'], 'Kind'],
      ['Plumbing & pipes', ['Astral', 'Supreme', 'Finolex', 'Prince', 'Ashirvad'], ['1/2 inch', '3/4 inch', '1 inch', 'CPVC', 'UPVC', 'Fitting'], 'Size & material'],
      ['Electrical fittings', ELECTRICALS, ['Switch', 'Socket', 'MCB', 'Distribution box', 'Holder', 'Extension board'], 'Kind'],
      ['Wires & cables', ['Polycab', 'Finolex', 'Havells', 'RR Kabel', 'V-Guard'], ['1 sq mm', '1.5 sq mm', '2.5 sq mm', '4 sq mm', '90 m coil'], 'Gauge'],
      ['Locks & hardware', ['Godrej', 'Europa', 'Harrison', 'Yale', 'Dorset'], ['Door lock', 'Padlock', 'Hinge', 'Handle', 'Digital lock'], 'Kind'],
      ['Nuts, bolts & fasteners', ['Local / unbranded'], ['Per kg', 'Per piece', 'Box'], 'Sold as'],
      ['Safety & site gear', ['3M', 'Karam', 'Udyogi', 'Local / unbranded'], ['Helmet', 'Gloves', 'Goggles', 'Shoes', 'Harness'], 'Kind'],
    ]),
  },
  {
    id: 'auto',
    name: 'Auto parts & accessories',
    icon: '🔧',
    subcategoryId: 'vehicles',
    brands: TYRES,
    variantLabel: 'Size & fitment',
    types: types([
      ['Tyres', TYRES, ['145/80 R13', '165/80 R14', '185/65 R15', '205/55 R16', '90/90-12', '100/90-17', 'Tubeless', 'Tube type'], 'Size'],
      ['Batteries', BATTERIES, ['35 Ah', '45 Ah', '65 Ah', '5 Ah bike', '9 Ah bike', '2 yr warranty'], 'Capacity'],
      ['Engine oil & lubricants', LUBRICANTS, ['1 L', '3.5 L', '5 L', '10W-30', '15W-40', '20W-40', 'Synthetic'], 'Pack & grade'],
      ['Helmets & riding gear', ['Steelbird', 'Vega', 'Studds', 'SMK', 'Royal Enfield', 'LS2'], ['Half face', 'Full face', 'Open face', 'M', 'L', 'XL'], 'Type & size'],
      ['Car accessories', ['3M', 'Bosch', 'Sony', 'Pioneer', 'Local / unbranded'], ['Seat cover', 'Floor mat', 'Music system', 'Reverse camera', 'Body cover'], 'Kind'],
      ['Bike accessories', ['Studds', 'Zadon', 'Local / unbranded'], ['Seat cover', 'Crash guard', 'Mirror', 'Luggage carrier', 'Body cover'], 'Kind'],
      ['Spare parts', ['Bosch', 'Lumax', 'Uno Minda', 'OEM / genuine', 'Local / aftermarket'], ['Brake', 'Clutch', 'Filter', 'Bulb', 'Belt', 'Suspension'], 'Kind'],
      ['Vehicle care & cleaning', ['3M', 'Formula 1', 'Wavex', 'Turtle Wax'], ['Shampoo', 'Polish', 'Dashboard', 'Microfibre'], 'Kind'],
    ]),
  },
  {
    id: 'stationery',
    name: 'Stationery & books',
    icon: '📚',
    subcategoryId: 'other',
    brands: STATIONERY,
    variantLabel: 'Kind',
    types: types([
      ['Notebooks & registers', ['Classmate', 'Navneet', 'Local / unbranded'], ['100 pages', '200 pages', 'A4', 'Long book', 'Practical file'], 'Pages & size'],
      ['Pens & pencils', STATIONERY, ['Ball pen', 'Gel pen', 'Pencil', 'Marker', 'Highlighter', 'Pack of 10'], 'Kind'],
      ['School supplies', STATIONERY, ['Geometry box', 'Colour box', 'Scale', 'Eraser & sharpener', 'School bag'], 'Kind'],
      ['Art & craft', ['Camlin', 'Doms', 'Faber-Castell', 'Fevicol'], ['Colours', 'Sketch pens', 'Chart paper', 'Craft kit', 'Canvas'], 'Kind'],
      ['Office supplies', ['Kangaro', 'Solo', 'Oddy', '3M'], ['File & folder', 'Stapler', 'Punch', 'Sticky notes', 'Tape'], 'Kind'],
      ['Books', ['NCERT', 'Arihant', 'S. Chand', 'Oswaal', 'Local / second hand'], ['School', 'Competitive', 'Novel', 'Religious', 'Second hand'], 'Kind'],
      ['Printing & paper', ['JK Paper', 'Century', 'Bilt'], ['A4 75 GSM', 'A4 70 GSM', 'A3', 'Photocopy ream'], 'Size'],
    ]),
  },
  {
    id: 'sports',
    name: 'Sports & fitness',
    icon: '🏏',
    subcategoryId: 'other',
    brands: SPORTS,
    variantLabel: 'Size & type',
    types: types([
      ['Cricket', ['SG', 'SS', 'MRF', 'Kookaburra', 'Local / handmade'], ['Bat', 'Ball', 'Pads', 'Gloves', 'Kit bag', 'Size 5', 'Size 6'], 'Kind'],
      ['Football & volleyball', ['Nivia', 'Cosco', 'Vector X'], ['Size 3', 'Size 4', 'Size 5', 'Net', 'Pump'], 'Kind'],
      ['Badminton & tennis', ['Yonex', 'Cosco', 'Li-Ning', 'Head'], ['Racquet', 'Shuttlecock', 'Ball', 'Grip', 'Set of 2'], 'Kind'],
      ['Gym equipment', ['Kore', 'Cockatoo', 'Fitkit', 'Local / unbranded'], ['Dumbbell 5 kg', 'Dumbbell 10 kg', 'Weight plates', 'Bench', 'Treadmill', 'Cycle'], 'Kind'],
      ['Cycles', ['Hero', 'Atlas', 'Avon', 'Firefox', 'Btwin', 'Hercules'], ['Kids', '20 inch', '24 inch', '26 inch', 'Gear', 'Non-gear'], 'Size'],
      ['Fitness accessories', ['Boldfit', 'Nivia', 'Local / unbranded'], ['Yoga mat', 'Skipping rope', 'Resistance band', 'Gloves', 'Bottle'], 'Kind'],
      ['Indoor games', ['Cosco', 'Funskool', 'Local / handmade'], ['Carrom', 'Chess', 'Table tennis', 'Dart', 'Ludo'], 'Kind'],
    ]),
  },
  {
    id: 'toys_baby',
    name: 'Toys & baby',
    icon: '🧸',
    subcategoryId: 'other',
    brands: ['Funskool', 'Hot Wheels', 'Lego', 'Babyhug', 'Local / unbranded'],
    variantLabel: 'Age & kind',
    types: types([
      ['Toys', ['Funskool', 'Hot Wheels', 'Lego', 'Local / unbranded'], ['0-2 yr', '3-5 yr', '6-8 yr', '9+ yr', 'Soft toy', 'Remote control'], 'Age'],
      ['Games & puzzles', ['Funskool', 'Ravensburger', 'Local / unbranded'], ['Board game', 'Puzzle', 'Card game', 'Educational'], 'Kind'],
      ['Ride-ons & cycles', ['Toyzone', 'Babyhug', 'Local / unbranded'], ['Tricycle', 'Ride-on car', 'Scooter', 'Battery operated'], 'Kind'],
      ['Baby gear', ['Babyhug', 'LuvLap', 'R for Rabbit', 'Chicco'], ['Pram', 'Walker', 'Carrier', 'Car seat', 'High chair'], 'Kind'],
      ['Diapers & wipes', ['Pampers', 'Huggies', 'MamyPoko', 'Himalaya'], ['NB', 'S', 'M', 'L', 'XL', 'Pack of 30', 'Pack of 60'], 'Size'],
      ['Baby food & feeding', ['Cerelac', 'Nan', 'Nestle', 'Philips Avent', 'LuvLap'], ['Stage 1', 'Stage 2', 'Bottle', 'Steriliser'], 'Kind'],
    ]),
  },
  {
    id: 'medical',
    name: 'Medical & wellness',
    icon: '💊',
    subcategoryId: 'other',
    brands: PHARMA,
    variantLabel: 'Pack',
    types: types([
      ['Medicines', PHARMA, ['Strip of 10', 'Bottle', 'Syrup', 'Injection', 'Prescription only'], 'Pack'],
      ['Ayurvedic & herbal', ['Dabur', 'Patanjali', 'Himalaya', 'Baidyanath', 'Zandu'], ['Churna', 'Syrup', 'Tablet', 'Oil'], 'Form'],
      ['Health devices', ['Omron', 'Dr. Morepen', 'Accu-Chek', 'Beurer', 'Control D'], ['BP monitor', 'Glucometer', 'Thermometer', 'Nebuliser', 'Oximeter', 'Weighing scale'], 'Kind'],
      ['Supplements & nutrition', ['Optimum Nutrition', 'MuscleBlaze', 'Horlicks', 'Bournvita', 'Ensure', 'Protinex'], ['500 g', '1 kg', '2 kg', 'Protein', 'Vitamin'], 'Pack'],
      ['Surgical & first aid', ['Dettol', 'Band-Aid', 'Datt', 'Romsons'], ['Bandage', 'Cotton', 'Gloves', 'Syringe', 'First aid box'], 'Kind'],
      ['Mobility & care', ['Vissco', 'Karma', 'Tynor'], ['Wheelchair', 'Walker', 'Belt & support', 'Adult diaper'], 'Kind'],
    ]),
  },
  {
    id: 'pets',
    name: 'Pet supplies',
    icon: '🐾',
    subcategoryId: 'other',
    brands: PET,
    variantLabel: 'Pack & pet',
    types: types([
      ['Pet food', PET, ['Dog', 'Cat', 'Puppy', 'Kitten', '1 kg', '3 kg', '10 kg'], 'Pet & pack'],
      ['Pet accessories', ['Local / unbranded', 'Trixie', 'PetSutra'], ['Collar', 'Leash', 'Bowl', 'Bed', 'Toy', 'Cage'], 'Kind'],
      ['Pet grooming & care', ['Himalaya', 'Captain Zack', 'Bayer'], ['Shampoo', 'Tick & flea', 'Brush', 'Nail cutter'], 'Kind'],
      ['Aquarium & birds', ['Local / unbranded', 'Sera', 'Taiyo'], ['Tank', 'Filter', 'Fish food', 'Bird cage', 'Bird feed'], 'Kind'],
    ]),
  },
  {
    id: 'agri',
    name: 'Farm & garden',
    icon: '🌾',
    subcategoryId: 'home-goods',
    brands: AGRI,
    variantLabel: 'Pack & type',
    types: types([
      ['Seeds', ['Mahyco', 'Nuziveedu', 'Syngenta', 'Rasi', 'Local / desi'], ['Wheat', 'Soybean', 'Gram', 'Vegetable', '500 g', '1 kg', '5 kg'], 'Crop & pack'],
      ['Fertiliser', ['IFFCO', 'Coromandel', 'Chambal', 'Kribhco'], ['Urea', 'DAP', 'NPK', 'Organic', '45 kg bag', '50 kg bag'], 'Type & pack'],
      ['Pesticides & sprays', ['Bayer', 'Syngenta', 'UPL', 'Rallis', 'Dhanuka'], ['Insecticide', 'Herbicide', 'Fungicide', '250 ml', '1 L'], 'Type & pack'],
      ['Farm tools & machines', ['Kirloskar', 'Honda', 'Kisan Kraft', 'Local / handmade'], ['Sprayer', 'Pump set', 'Cutter', 'Plough', 'Hand tools'], 'Kind'],
      ['Irrigation & pipes', ['Jain', 'Finolex', 'Supreme', 'Netafim'], ['Drip', 'Sprinkler', 'HDPE pipe', 'Per metre'], 'Kind'],
      ['Plants, pots & garden', ['Local / nursery', 'Ugaoo', 'Trust Basket'], ['Indoor plant', 'Sapling', 'Pot', 'Potting soil', 'Manure'], 'Kind'],
      ['Cattle & poultry feed', ['Godrej', 'Amul', 'Local / mill'], ['Cattle feed', 'Poultry feed', '50 kg bag', 'Per kg'], 'Kind'],
    ]),
  },
  {
    id: 'other_goods',
    name: 'Other',
    icon: '✨',
    subcategoryId: 'other',
    types: [],
  },
];

/* --- Lookups ------------------------------------------------------------- */

const BY_NAME = new Map(PRODUCT_CATEGORIES.map((c) => [c.name.toLowerCase(), c]));

/** The library category with this display name (what lands on `category`). */
export function findProductCategory(name?: string): ProductCategory | undefined {
  return name ? BY_NAME.get(name.trim().toLowerCase()) : undefined;
}

/** The type inside a category, by display name (what lands on `subcategory`). */
export function findProductType(
  category?: ProductCategory,
  typeName?: string,
): ProductType | undefined {
  if (!category || !typeName) return undefined;
  const key = typeName.trim().toLowerCase();
  return category.types.find((t) => t.name.toLowerCase() === key);
}

/**
 * The category chips for `OfferingsEditor` — the goods library in the same
 * shape as the service/rental ones, each type offered as a subcategory.
 */
export const PRODUCT_SECTIONS: OfferingSection[] = PRODUCT_CATEGORIES.map((c) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  subcategories: c.types.map((t) => t.name),
  subcategoryId: c.subcategoryId,
}));

/** Brands to offer for a pick — the type's own, else the category's, else none. */
export function productBrands(categoryName?: string, typeName?: string): string[] {
  const category = findProductCategory(categoryName);
  if (!category) return [];
  return findProductType(category, typeName)?.brands ?? category.brands ?? [];
}

/** Spec chips (with their heading) for a pick — the type's own, else the category's. */
export function productVariants(
  categoryName?: string,
  typeName?: string,
): { label: string; options: string[] } | undefined {
  const category = findProductCategory(categoryName);
  if (!category) return undefined;
  const type = findProductType(category, typeName);
  const options = type?.variants ?? category.variants ?? [];
  if (options.length === 0) return undefined;
  return { label: type?.variantLabel ?? category.variantLabel ?? 'Which one?', options };
}

/**
 * The name a listing gets when the owner picks chips and leaves the name box
 * empty — "Samsung 1.5 Ton Split Air conditioner". A typed model always wins;
 * this only saves the typing when the picks already say it. A brand alone or a
 * spec alone is not a product name, so nothing is composed until the TYPE is
 * picked — that's the word the customer searches for.
 */
export function composeProductName(parts: {
  subcategory?: string;
  brand?: string;
  variants?: string[];
}): string | undefined {
  const thing = parts.subcategory?.trim();
  if (!thing) return undefined;
  const brand = parts.brand?.trim();
  const specs = (parts.variants ?? []).map((v) => v.trim()).filter(Boolean);
  const words = [brand, ...specs, thing].filter(Boolean);
  return words.length > 1 ? words.join(' ') : undefined;
}

/** "Air conditioner · Samsung · 1.5 Ton" — the detail line under a product. */
export function productDetailLine(item: {
  subcategory?: string;
  brand?: string;
  variants?: string[];
}): string | undefined {
  return (
    [item.subcategory, item.brand, ...(item.variants ?? [])].filter(Boolean).join(' · ') ||
    undefined
  );
}
