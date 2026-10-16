/// <reference types="node" />
/**
 * Every collector's raw category words → Localo tags (names from TAG_CATALOG in
 * src/domain/tags.ts) + the listing type. Google says "Hardware store", OSM
 * says "shop=hardware", JustDial says "Hardware Shops" — one table maps them all.
 *
 * Rules are tried in order and EVERY matching rule adds its tags (an MRF
 * dealer is Tyres + Wheel Alignment). A category no rule matches is reported
 * by merge-listings.ts with its count, so the table grows from real data —
 * add a rule here, re-run the merge. A business with no tag is never published.
 */
import { TAG_CATALOG, isFoodShop } from '@/domain/tags';
import type { ListingType } from '@/domain/types';

type Rule = [RegExp, string[]];

/** Matched against each raw category, lower-cased. OSM's are "key=value". */
export const CATEGORY_RULES: Rule[] = [
  // ── food (kept so the merge can recognise and skip them — Zomato owns food) ──
  [/\b(restaurant|diner|eatery|bistro|family restaurant|amenity=restaurant|food court|amenity=food_court)\b/, ['Restaurant']],
  [/\b(cafe|café|coffee shop|amenity=cafe|coffee)\b/, ['Cafe']],
  [/\bbaker(y|ies)\b|shop=bakery|cake shop|patisserie|shop=pastry/, ['Bakery']],
  [/sweet shop|mithai|shop=confectionery|confectioner|craft=confectionery/, ['Sweet Shop']],
  [/fast food|amenity=fast_food|burger|pizza/, ['Fast Food']],
  [/\bdhaba\b/, ['Dhaba']],
  [/tea (stall|house|shop)/, ['Tea Stall']],
  [/juice/, ['Juice Shop']],
  [/ice cream|amenity=ice_cream|shop=ice_cream/, ['Ice Cream']],
  [/tiffin/, ['Tiffin Service']],
  [/caterer|catering/, ['Catering']],
  [/cloud kitchen/, ['Cloud Kitchen']],
  [/paan|pan shop|shop=tobacco/, ['Paan Shop']],

  // ── groceries & daily needs ──
  [/supermarket|shop=supermarket|hypermarket/, ['Supermarket', 'Grocery']],
  [/grocery|shop=grocery|shop=convenience|convenience store|kirana/, ['Grocery', 'Kirana Store']],
  [/general store|shop=general|variety store|shop=variety_store|department store/, ['General Store']],
  [/vegetable|greengrocer|fruit/, ['Vegetables & Fruits']],
  [/\bdairy\b|shop=dairy|milk/, ['Dairy']],
  [/butcher|meat|chicken shop|shop=butcher|poultry/, ['Meat Shop']],
  [/fish (store|market|shop)|seafood market/, ['Fish Market']],
  [/dry fruit|nut store/, ['Dry Fruits']],
  [/spice/, ['Masala & Spices']],
  [/organic|health food|shop=health_food/, ['Organic Store']],
  [/flour mill|atta chakki/, ['Flour Mill']],

  // ── shops & retail ──
  [/pharmacy|chemist|medical store|drugstore|amenity=pharmacy|healthcare=pharmacy|shop=chemist|shop=pharmacy/, ['Medical Store', 'Pharmacy']],
  [/medical (supply|equipment)|surgical|shop=medical_supply/, ['Medical Store']],
  [/electronics|shop=electronics|shop=hifi|audio visual/, ['Electronics']],
  [/mobile phone|cell phone|shop=mobile_phone|mobile (shop|store)/, ['Mobile Shop']],
  [/computer (store|shop)|shop=computer|laptop (store|shop)/, ['Computer Shop']],
  [/appliance (store|shop)|shop=appliance|home appliance/, ['Home Appliances']],
  [/camera store|shop=photo\b|photography store/, ['Camera Shop']],
  [/clothing|shop=clothes|garment|apparel|fashion/, ['Clothing']],
  [/men'?s clothing|menswear/, ['Menswear']],
  [/women'?s clothing|ladies (clothing|wear|garment)/, ['Womenswear']],
  [/children'?s clothing|kids/, ['Kidswear']],
  [/saree|sari\b/, ['Sarees']],
  [/ethnic|sherwani|lehenga/, ['Ethnic Wear']],
  [/boutique|shop=boutique/, ['Boutique']],
  [/shoe store|footwear|shop=shoes/, ['Footwear']],
  [/\bbag|luggage|shop=bag/, ['Bags & Luggage']],
  [/watch (store|shop)|shop=watches/, ['Watches']],
  [/optician|optical|eyewear|shop=optician|spectacles/, ['Opticals']],
  [/jewel(le)?ry|jeweler|jeweller|shop=jewelry|goldsmith/, ['Jewelry']],
  [/imitation jewel|artificial jewel/, ['Artificial Jewellery']],
  [/furniture|shop=furniture|shop=bed|mattress/, ['Furniture']],
  [/home decor|home goods|shop=interior_decoration|furnishing/, ['Home Decor']],
  [/kitchen (supply|ware)|shop=houseware|shop=kitchenware|utensil|crockery/, ['Kitchenware', 'Crockery & Utensils']],
  [/hardware|shop=hardware|shop=doityourself|tool store/, ['Hardware']],
  [/paint (store|shop)|shop=paint|\bpaints\b/, ['Paint Store']],
  [/electrical (supply|shop|store|goods)|shop=electrical|electric shop/, ['Electrical Shop']],
  [/sanitary|bathroom supply|plumbing supply|shop=bathroom_furnishing/, ['Sanitaryware']],
  [/\btiles?\b|marble|granite|shop=tiles/, ['Tiles & Marble']],
  [/building material|cement|construction material|plywood|timber|steel|shop=trade/, ['Building Material']],
  [/stationery|shop=stationery|office supplies|shop=office_supplies/, ['Stationery']],
  [/book (store|shop)|shop=books|bookstore/, ['Books']],
  [/toy store|shop=toys|toy shop/, ['Toys']],
  [/gift|shop=gift|souvenir/, ['Gifts']],
  [/florist|flower|shop=florist/, ['Florist']],
  [/plant nursery|garden cent|shop=garden_centre|nursery\b(?!.*school)/, ['Plant Nursery']],
  [/pet (store|shop|supply)|shop=pet/, ['Pet Shop']],
  [/aquarium/, ['Aquarium']],
  [/handicraft|craft store|shop=craft/, ['Handicrafts']],
  [/art supply|shop=art/, ['Art Supplies']],
  [/sporting goods|sports (store|shop)|shop=sports|shop=outdoor/, ['Sports Goods']],
  [/bicycle (store|shop)|shop=bicycle|cycle (store|shop)/, ['Cycle Store']],
  [/musical instrument|shop=musical_instrument/, ['Musical Instruments']],
  [/puja|pooja|religious goods|shop=religion/, ['Puja Store']],
  [/second ?hand|thrift|used goods|shop=second_hand/, ['Second Hand']],
  [/scrap/, ['Scrap Dealer']],
  [/auto parts|spare parts|shop=car_parts|motorcycle parts/, ['Spare Parts']],
  [/tyre|tire|shop=tyres/, ['Tyres']],
  [/battery/, ['Battery Shop']],
  [/car accessor/, ['Car Accessories']],
  [/motorcycle accessor|bike accessor/, ['Bike Accessories']],
  [/car dealer|shop=car\b|used car/, ['Car Dealer']],
  [/motorcycle dealer|shop=motorcycle\b|scooter dealer|two wheeler/, ['Bike Dealer']],
  [/wholesale|shop=wholesale|wholesaler/, ['Wholesale']],
  [/distributor/, ['Distributor']],
  [/manufacturer/, ['Manufacturer']],
  [/seed|fertili[sz]er|agro|shop=agrarian/, ['Seeds & Fertilizers']],
  [/pesticide/, ['Pesticides']],
  [/shopping mall|shop=mall/, ['General Store']],

  // ── home & repair services ──
  [/electrician|craft=electrician/, ['Electrician']],
  [/plumb/, ['Plumber']],
  [/\bpainter|painting contractor|craft=painter/, ['Painter']],
  [/carpent|craft=carpenter|woodwork/, ['Carpenter']],
  [/mason|craft=tiler/, ['Mason']],
  [/weld|fabricat|craft=metal_construction/, ['Welder & Fabricator']],
  [/house cleaning|cleaning service|janitorial/, ['House Cleaning']],
  [/pest control/, ['Pest Control']],
  [/air condition|ac repair|hvac|\bac service/, ['AC Repair']],
  [/refrigerator|fridge/, ['Fridge Repair']],
  [/washing machine/, ['Washing Machine Repair']],
  [/tv repair|television repair/, ['TV Repair']],
  [/appliance repair/, ['Appliance Repair']],
  [/water purif|\bro\b/, ['RO & Water Purifier']],
  [/inverter|\bups\b/, ['Inverter & Battery']],
  [/solar/, ['Solar Installation']],
  [/cctv|security system/, ['CCTV Installation']],
  [/interior design/, ['Interior Designer']],
  [/architect/, ['Architect']],
  [/modular kitchen|kitchen remodel/, ['Modular Kitchen']],
  [/locksmith/, ['Locksmith']],
  [/glass|aluminium|aluminum/, ['Glass & Aluminium']],
  [/curtain|blind/, ['Curtains & Blinds']],
  [/borewell|drilling/, ['Borewell']],
  [/water (supplier|tanker)/, ['Water Supply']],
  [/maid|domestic help/, ['Maid Service']],
  [/security (service|guard|agency)/, ['Security Service']],
  [/laundry|shop=laundry|laundromat/, ['Laundry']],
  [/dry clean|shop=dry_cleaning/, ['Dry Cleaning']],
  [/landscap|gardener/, ['Gardener']],

  // ── vehicles & transport ──
  [/car repair|auto repair|auto garage|mechanic|shop=car_repair|car service/, ['Mechanic', 'Car Repair']],
  [/motorcycle repair|bike repair|two wheeler repair|scooter repair/, ['Bike Repair']],
  [/car wash/, ['Car Wash']],
  [/car detail/, ['Car Detailing']],
  [/wheel alignment/, ['Wheel Alignment']],
  [/towing/, ['Towing']],
  [/taxi|cab service|amenity=taxi/, ['Taxi']],
  [/packers|movers|moving company/, ['Packers & Movers']],
  [/courier|office=courier|parcel/, ['Courier']],
  [/logistic|transport(ation)? service|truck/, ['Transport', 'Logistics']],
  [/driving school|amenity=driving_school/, ['Driving School']],
  [/car rental|car hire/, ['Car Rental']],
  [/bike rental|scooter rental|motorcycle rental/, ['Bike Rental']],
  [/ev charging|charging station/, ['EV Charging']],

  // ── personal care & fitness ──
  [/hair salon|hairdresser|shop=hairdresser|unisex salon|\bsalon\b/, ['Salon']],
  [/barber|men'?s salon/, ["Men's Salon"]],
  [/beauty (salon|parlou?r)|shop=beauty|beautician/, ['Beauty Parlour']],
  [/\bspa\b|day spa|leisure=spa/, ['Spa']],
  [/massage/, ['Massage']],
  [/makeup artist/, ['Makeup Artist']],
  [/bridal/, ['Bridal Makeup']],
  [/nail salon/, ['Nail Art']],
  [/tattoo|shop=tattoo/, ['Tattoo']],
  [/piercing/, ['Piercing']],
  [/\bgym\b|fitness cent|leisure=fitness_centre|health club|weight ?lifting/, ['Gym', 'Fitness']],
  [/yoga|meditation/, ['Yoga']],
  [/physical fitness|fitness program/, ['Fitness']],
  [/gymnastic|boxing|club=sport|sports club/, ['Sports Coaching']],
  [/zumba|aerobics/, ['Zumba']],
  [/personal trainer/, ['Personal Trainer']],
  [/dietitian|nutritionist|weight loss/, ['Dietician']],
  [/mehndi|henna/, ['Mehndi']],

  // ── health ──
  [/^(?!.*(animal|veterinar|pet )).*hospital|amenity=hospital|healthcare=hospital|nursing home|amenity=nursing_home/, ['Hospital']],
  [/clinic|amenity=clinic|healthcare=clinic|healthcare=centre|medical cent/, ['Clinic']],
  [/doctor|physician|amenity=doctors|healthcare=doctor|general practitioner|specialist|gynecolog|pediatric|paediatric|orthop|cardiolog|neurolog|urolog|\bent\b|healthcare=general/, ['Doctor']],
  [/dentist|dental|amenity=dentist|healthcare=dentist|orthodont/, ['Dentist']],
  [/physiotherap|healthcare=physiotherapist|occupational therap/, ['Physiotherapy']],
  [/patholog|laboratory|healthcare=laboratory|blood test/, ['Pathology Lab']],
  [/diagnostic|imaging|x-ray|mri|ultrasound|radiolog/, ['Diagnostics']],
  [/eye (care|hospital|clinic)|ophthalm/, ['Eye Clinic']],
  [/skin (care|clinic)|dermatolog/, ['Skin Clinic']],
  [/homeopath/, ['Homeopathy']],
  [/ayurved/, ['Ayurveda']],
  [/psycholog|psychiatr|counsel/, ['Counselling']],
  [/veterinar|amenity=veterinary|animal hospital|pet clinic/, ['Veterinary']],
  [/pet groom/, ['Pet Grooming']],
  [/ambulance/, ['Ambulance']],
  [/hearing aid|audiolog/, ['Hearing Aids']],
  [/blood bank|amenity=blood_bank|healthcare=blood_bank/, ['Hospital']],

  // ── education ──
  [/^(?!.*(driving|music|dance|art|swimming|martial|language|coding|computer|play|pre)).*(\bschool\b|amenity=school|cbse)/, ['School']],
  [/preschool|play ?school|kindergarten|daycare|day care|amenity=kindergarten|amenity=prep_school|creche/, ['Preschool & Daycare']],
  [/college|amenity=college|university|amenity=university|educational_institution/, ['College']],
  [/coaching|tutor|tuition|test prep|educational institut/, ['Coaching']],
  [/competitive exam|\b(ias|upsc|jee|neet|ssc)\b/, ['Competitive Exams']],
  [/computer (training|institute|class)/, ['Computer Classes']],
  [/coding|programming/, ['Coding Classes']],
  [/english|language school/, ['Spoken English']],
  [/abacus/, ['Abacus']],
  [/music (school|class|teacher)|amenity=music_school/, ['Music Classes']],
  [/danc(e|ing)|leisure=dance/, ['Dance Classes']],
  [/art (school|class)|drawing/, ['Art Classes']],
  [/swimming/, ['Swimming Classes']],
  [/martial arts|karate|taekwondo|self.defen/, ['Karate & Self Defence']],
  [/sports (academy|coaching|club)|leisure=sports_centre/, ['Sports Coaching']],
  [/cricket/, ['Cricket Academy']],
  [/library|amenity=library/, ['Library']],

  // ── creative & digital ──
  [/photograph|craft=photographer|photo studio|photographic/, ['Photography']],
  [/video(graph| production)/, ['Videography']],
  [/printing|print shop|printer|craft=printer/, ['Printing Press']],
  [/flex|banner|sign ?board|signage/, ['Flex & Banner Printing']],
  [/photocop|xerox|shop=copyshop/, ['Xerox & Photocopy']],
  [/internet cafe|cyber cafe|amenity=internet_cafe/, ['Cyber Cafe']],
  [/web design|website design/, ['Web Designer']],
  [/software|it (company|services)|office=it|app develop/, ['IT Services']],
  [/digital marketing|advertising|office=advertising_agency|marketing agency/, ['Digital Marketing']],

  // ── events ──
  [/event[ _](planner|management|organi[sz]er)/, ['Event Planner']],
  [/wedding planner/, ['Wedding Planner']],
  [/\btent\b/, ['Tent House']],
  [/\bdj\b|disc jockey/, ['DJ & Sound']],
  [/sound system|sound service/, ['Sound System']],
  [/decorat/, ['Lighting & Decoration']],
  [/banquet|amenity=events_venue|event venue|function hall|wedding venue/, ['Banquet Hall']],
  [/marriage garden|lawn/, ['Marriage Garden']],
  [/party hall/, ['Party Hall']],
  [/astrolog/, ['Astrologer']],
  [/pandit|priest/, ['Priest & Pandit']],
  [/wedding card|invitation/, ['Invitation Cards']],

  // ── professional & financial ──
  [/chartered accountant|accountant|office=accountant|tax consult|\bca\b/, ['CA & Tax']],
  [/\bgst\b/, ['GST Services']],
  [/lawyer|advocate|attorney|legal|office=lawyer/, ['Lawyer']],
  [/notary|office=notary/, ['Notary']],
  [/insurance|office=insurance/, ['Insurance Agent']],
  [/loan|finance|financial|office=financial/, ['Loan Agent']],
  [/real[ _]estate|property|office=estate_agent/, ['Real Estate', 'Property Dealer']],
  [/builder|construction company|real estate developer/, ['Builder']],
  [/travel agen|shop=travel_agency|tour (operator|agency)|tours and travels|office=travel_agent/, ['Travel Agency', 'Tours & Travels']],
  [/visa|passport/, ['Visa & Passport']],
  [/ticket/, ['Ticket Booking']],
  [/money transfer|bureau_de_change|currency exchange/, ['Money Transfer']],
  [/aadhaar|csc|common service/, ['Aadhaar & CSC Services']],
  [/employment agency|placement|recruit|office=employment_agency/, ['Job Placement']],

  // ── repairs & alterations ──
  [/tailor|shop=tailor|alteration|stitching/, ['Tailor']],
  [/embroider/, ['Embroidery']],
  [/shoe repair|cobbler/, ['Shoe Repair']],
  [/watch repair/, ['Watch Repair']],
  [/mobile (phone )?repair|cell phone repair|phone repair/, ['Mobile Repair']],
  [/computer repair|laptop repair|computer service/, ['Laptop Repair']],
  [/key duplication|key maker/, ['Key Maker']],

  // ── stay & spaces ──
  [/\bhotel\b|tourism=hotel|tourism=motel/, ['Hotel']],
  [/hostel|tourism=hostel/, ['Hostel']],
  [/\bpg\b|paying guest/, ['PG & Hostel']],
  [/lodg/, ['Lodge']],
  [/guest ?house|tourism=guest_house/, ['Guest House']],
  [/homestay/, ['Homestay']],
  [/resort|leisure=resort/, ['Resort']],
  [/farm ?house/, ['Farmhouse']],
  [/coworking|co-working/, ['Coworking Space']],
  [/serviced apartment|tourism=apartment/, ['Flats & Rooms']],

  // ── rentals & industry ──
  [/furniture rental/, ['Furniture Rental']],
  [/equipment rental|tool rental/, ['Equipment Rental']],
  [/costume/, ['Costume Rental']],
  [/generator/, ['Generator Rental']],
  [/crane/, ['Crane Service']],
  [/jcb|earth ?mov|excavat/, ['JCB & Earthmovers']],
  [/warehouse|godown/, ['Warehouse']],
  [/cold storage/, ['Cold Storage']],
  [/lathe/, ['Lathe Works']],
  [/machine (repair|shop)|machinery/, ['Machine Repair']],
  [/industrial (supply|equipment)/, ['Industrial Supplies']],
];

/**
 * FALLBACK rules: tried only when no rule above matched ANY of a business's
 * categories. They are broad guesses for otherwise-untagged places — applied to
 * everything, they over-tag (a hospital that is also a "Health consultant"
 * would gain Ayurveda; Lotus Electronics' "Corporate office" would add IT Services).
 */
export const FALLBACK_RULES: Rule[] = [
  // ── added 16 Oct 2026 from the merge's "no tag" list (Magicpin's bare group names, Google's long tail).
  //    Deliberately NOT tagged: housing societies/complexes, temples, parks, bus stops, post/government
  //    offices, banks, "Store"/"Service establishment"/"Building" — not listable businesses, or too vague. ──
  [/^fitness$|body ?building|crossfit|sports nutrition/, ['Gym', 'Fitness']],
  [/^beauty$|health and beauty|beauty (product|supply)|cosmetics (store|industry)|perfume/, ['Beauty Parlour']],
  [/make-?up artist/, ['Makeup Artist']],
  [/^hair ?cut$|^hair (colour|color|wash|smoothening|straightening|extension)$|^beard |^shave$/, ['Salon', 'Haircut']],
  [/vacation rental|home ?stay|farmstay|cottage|^villa$|holiday apartment|service apartment/, ['Homestay']],
  [/^apartment$|^house$|condominium rental|apartment rental/, ['Flats & Rooms']],
  [/student dormitory/, ['Hostel', 'PG & Hostel']],
  [/office space rental/, ['Office Space']],
  [/education(al)? (center|centre|consultant)|training (center|centre)|studying center|tutoring/, ['Coaching']],
  [/playgroup|charter school/, ['School']],
  [/music instructor|musician/, ['Music Classes']],
  [/mehandi class/, ['Mehndi']],
  [/car leasing|car rental|chauffeur/, ['Car Rental', 'Taxi']],
  [/automation company/, ['Industrial Supplies']],
  [/internet marketing|marketing consultant|e-commerce service/, ['Digital Marketing', 'Marketing Agency']],
  [/graphic designer|design agency/, ['Graphic Designer']],
  [/video editing|film production|recording studio/, ['Video Editor', 'Videography']],
  [/web hosting/, ['Website Development', 'IT Services']],
  [/computer support|computer accessories/, ['Computer Shop', 'Laptop Repair']],
  [/auto accessories|car stereo/, ['Car Accessories']],
  [/auto body|auto painting|auto restoration/, ['Denting & Painting', 'Car Repair']],
  [/oil change|^garage$/, ['Auto Garage', 'Vehicle Service']],
  [/bicycle repair/, ['Bike Repair']],
  [/electric motor vehicle dealer/, ['Bike Dealer', 'EV Charging']],
  [/water (filter|pump|works equipment)|water treatment|mineral water|cooler supplier/, ['RO & Water Purifier', 'Distributor']],
  [/electrical (installation|repair|engineer)/, ['Electrician']],
  [/washer & dryer repair/, ['Washing Machine Repair']],
  [/^repair service$/, ['Appliance Repair']],
  [/moving service|delivery service/, ['Packers & Movers', 'Transport']],
  [/chicken & mutton/, ['Meat Shop', 'Chicken & Mutton']],
  [/produce market/, ['Vegetables & Fruits']],
  [/beverage store/, ['General Store']],
  [/household needs|personal care|^drug store$/, ['General Store']],
  [/sportswear|casual (tops|trousers)|dress material|fabric store|handbags/, ['Clothing']],
  [/sofa store|countertop/, ['Furniture']],
  [/lumber|pipe supplier/, ['Building Material', 'Hardware']],
  [/sewing machine|game store|video game|baby store/, ['General Store']],
  [/photo shop|copy shop/, ['Photo Studio', 'Xerox & Photocopy']],
  [/packaging company|^supplier$/, ['Wholesale', 'Distributor']],
  [/^contractor$/, ['Builder']],
  [/law firm/, ['Lawyer']],
  [/employment (consultant|center)|human resource/, ['Job Placement']],
  [/home health care|nursing agency|assisted living|old age home|home help/, ['Elder Care']],
  [/health consultant|wellness cent|alternative medicine|herbal medicine/, ['Ayurveda', 'Counselling']],
  [/child health care|community health|medical group|gastroenterologist|surgeon/, ['Clinic', 'Doctor']],
  [/^artist$|art (studio|center)/, ['Art Classes', 'Handicrafts']],
  [/badminton club|sports complex/, ['Sports Coaching']],
  [/wedding service/, ['Wedding Planner']],
  [/^farm$/, ['Agriculture']],
];

const CATALOG = new Set(TAG_CATALOG);
// A rule naming a tag the catalog doesn't have is a typo — fail loudly, not silently.
for (const [, tags] of [...CATEGORY_RULES, ...FALLBACK_RULES]) for (const t of tags) if (!CATALOG.has(t)) throw new Error(`category-tags: "${t}" is not in TAG_CATALOG`);

/** Tags that are retail: a listing whose tags are mostly these is a `shop`. */
const SHOP_TAGS = new Set(TAG_CATALOG.slice(TAG_CATALOG.indexOf('Grocery'), TAG_CATALOG.indexOf('Electrician')));
['Spare Parts', 'Tyres', 'Battery Shop', 'Car Accessories', 'Bike Accessories', 'Car Dealer', 'Bike Dealer', 'Wholesale', 'Distributor', 'Seeds & Fertilizers', 'Pesticides', 'Industrial Supplies'].forEach((t) =>
  SHOP_TAGS.add(t),
);

export interface TagResult {
  tags: string[];
  type: ListingType;
  food: boolean;
  /** Raw categories no rule matched (for the merge report). */
  unmatched: string[];
}

export function tagsFor(categories: string[]): TagResult {
  const tags = new Set<string>();
  const unmatched: string[] = [];
  const apply = (rules: Rule[], list: string[]) => {
    const missed: string[] = [];
    for (const raw of list) {
      // OSM writes spaces as underscores (amenity=car_wash): try both spellings.
      const c = raw.toLowerCase();
      const spaced = c.replace(/_/g, ' ');
      let hit = false;
      for (const [re, t] of rules) {
        if (re.test(c) || re.test(spaced)) {
          t.forEach((x) => tags.add(x));
          hit = true;
        }
      }
      if (!hit) missed.push(raw);
    }
    return missed;
  };
  const missed = apply(CATEGORY_RULES, categories);
  unmatched.push(...(tags.size ? missed : apply(FALLBACK_RULES, missed)));
  const list = [...tags];
  const shopish = list.filter((t) => SHOP_TAGS.has(t) || isFoodShop([t])).length;
  return {
    tags: list,
    type: list.length && shopish * 2 >= list.length ? 'shop' : 'service',
    food: isFoodShop(list),
    unmatched,
  };
}
