/**
 * Seed data for the in-memory mock backend — a realistic Indore test set.
 *
 * Nine businesses cover every listing type and feature: services (insurance
 * agent, school transport with live tracking, tent house with a fleet, a gym
 * with monthly memberships), a fully-staffed cafe and restaurant with
 * complete menus, an electronics shop, a personal stall, and a vehicle
 * rental. EVERY employee is a distinct
 * registered user (switch identities in /dev to test chats, calls, driver
 * sharing, and workspaces from their side). The demo sign-in account is Sagar,
 * a plain customer with a child on the school bus.
 */
import type {
  BizChatMessage,
  Business,
  Employee,
  EmployeeLevel,
  LocationShare,
  LogEntry,
  Membership,
  ProductMessage,
  Review,
  SavedPlace,
  TrackedItem,
  User,
  Vehicle,
} from '@/domain/types';

/** The mocked "current location" — Indore city centre. Replaced by GPS later. */
export const CURRENT_POINT = { latitude: 22.7196, longitude: 75.8577 };

export const seedPlaces: SavedPlace[] = [
  { id: 'p_current', label: 'Current location', kind: 'current', point: CURRENT_POINT },
  {
    id: 'p_home',
    label: 'Home',
    kind: 'home',
    point: { latitude: 22.7532, longitude: 75.8937 },
    address: 'Vijay Nagar',
  },
  {
    id: 'p_work',
    label: 'Work',
    kind: 'work',
    point: { latitude: 22.7244, longitude: 75.8839 },
    address: 'Palasia',
  },
];

// ── Teams ───────────────────────────────────────────────────────────────────
// Team rosters as data; users and employee records are derived from these so
// every member is guaranteed a matching account with a public profile.

interface Member {
  slug: string;
  name: string;
  role: string;
  level?: EmployeeLevel;
  /** Featured staff — shown to customers on the business page under their designation. */
  showOnPage?: boolean;
}

const SCHOOLBUS_TEAM: Member[] = [
  { slug: 'ramesh', name: 'Ramesh Kumar', role: 'Driver — School bus MP-09 SB 4521' },
  { slug: 'suresh', name: 'Suresh Verma', role: 'Driver — Mini van MP-09 KV 1101' },
  { slug: 'dinesh', name: 'Dinesh Pal', role: 'Driver — Mini van MP-09 KV 2202' },
  { slug: 'mahesh', name: 'Mahesh Rawat', role: 'Driver — Mini van MP-09 KV 3303' },
];

const TENTHOUSE_TEAM: Member[] = [
  { slug: 'manoj', name: 'Manoj Tiwari', role: 'Manager', level: 'manager' },
  { slug: 'sunita', name: 'Sunita Chouhan', role: 'Decorator' },
  { slug: 'kamlesh', name: 'Kamlesh Meena', role: 'Lighting technician' },
  { slug: 'raju', name: 'Raju Prajapati', role: 'Pickup driver & setup' },
  { slug: 'deepaks', name: 'Deepak Solanki', role: 'Pickup driver & setup' },
];

const CAFE_TEAM: Member[] = [
  { slug: 'priya', name: 'Priya Nair', role: 'Cafe manager', level: 'manager' },
  // Waiters
  { slug: 'amit', name: 'Amit Sen', role: 'Senior waiter' },
  { slug: 'rahul', name: 'Rahul Dubey', role: 'Waiter' },
  { slug: 'snehai', name: 'Sneha Iyer', role: 'Waiter' },
  { slug: 'karan', name: 'Karan Thakur', role: 'Waiter' },
  { slug: 'nikhil', name: 'Nikhil Bose', role: 'Waiter' },
  { slug: 'tanvi', name: 'Tanvi Kapoor', role: 'Waiter' },
  { slug: 'varun', name: 'Varun Khanna', role: 'Waiter' },
  { slug: 'ishita', name: 'Ishita Roy', role: 'Waiter' },
  { slug: 'sameer', name: 'Sameer Shaikh', role: 'Waiter' },
  { slug: 'ritu', name: 'Ritu Saxena', role: 'Waiter' },
  // Chefs
  { slug: 'anilr', name: 'Anil Rawal', role: 'Head chef', showOnPage: true },
  { slug: 'meghna', name: 'Meghna Pillai', role: 'Chef' },
  { slug: 'sanjayb', name: 'Sanjay Bhosle', role: 'Chef' },
  { slug: 'farida', name: 'Farida Khan', role: 'Chef' },
  { slug: 'devnath', name: 'Devendra Nath', role: 'Chef' },
  // Staff
  { slug: 'gopal', name: 'Gopal Das', role: 'Cashier' },
  { slug: 'rekha', name: 'Rekha Pawar', role: 'Kitchen helper' },
  { slug: 'mohitc', name: 'Mohit Chandel', role: 'Delivery rider' },
  { slug: 'swati', name: 'Swati Ghosh', role: 'Housekeeping' },
  { slug: 'imran', name: 'Imran Qureshi', role: 'Dishwasher' },
  { slug: 'bhavna', name: 'Bhavna Trivedi', role: 'Counter staff' },
];

const RESTAURANT_TEAM: Member[] = [
  { slug: 'ashok', name: 'Ashok Malhotra', role: 'Restaurant manager', level: 'manager' },
  // Waiters
  { slug: 'deepika', name: 'Deepika Reddy', role: 'Senior waiter' },
  { slug: 'harsh', name: 'Harsh Vora', role: 'Waiter' },
  { slug: 'payal', name: 'Payal Shah', role: 'Waiter' },
  { slug: 'rohitg', name: 'Rohit Gaikwad', role: 'Waiter' },
  { slug: 'ankita', name: 'Ankita Mishra', role: 'Waiter' },
  { slug: 'sidrao', name: 'Siddharth Rao', role: 'Waiter' },
  { slug: 'kavita', name: 'Kavita Bhatt', role: 'Waiter' },
  { slug: 'naveen', name: 'Naveen Menon', role: 'Waiter' },
  { slug: 'arjunn', name: 'Arjun Nambiar', role: 'Waiter' },
  { slug: 'zoya', name: 'Zoya Ansari', role: 'Waiter' },
  // Chefs
  { slug: 'ratan', name: 'Ratan Thakre', role: 'Head chef', showOnPage: true },
  { slug: 'shabnam', name: 'Shabnam Sheikh', role: 'Tandoor chef', showOnPage: true },
  { slug: 'girish', name: 'Girish Kamat', role: 'Chef' },
  { slug: 'lata', name: 'Lata Kadam', role: 'Chef' },
  { slug: 'mukeshc', name: 'Mukesh Chauhan', role: 'Chef' },
  // Staff
  { slug: 'seema', name: 'Seema Bhatia', role: 'Billing counter' },
  { slug: 'tarun', name: 'Tarun Kohli', role: 'Kitchen helper' },
  { slug: 'nisha', name: 'Nisha Parmar', role: 'Housekeeping' },
  { slug: 'balram', name: 'Balram Bishnoi', role: 'Valet' },
  { slug: 'asha', name: 'Asha Naik', role: 'Cleaner' },
  { slug: 'prakashl', name: 'Prakash Lele', role: 'Security' },
];

const memberUsers = (members: Member[], workplace: string): User[] =>
  members.map((m) => ({
    id: `u_${m.slug}`,
    name: m.name,
    email: `${m.slug}@localo.app`,
    bio: `${m.role} at ${workplace}.`,
    isProfilePublic: true,
  }));

const memberEmployees = (businessId: string, members: Member[]): Employee[] =>
  members.map((m) => ({
    id: `e_${m.slug}`,
    businessId,
    displayName: m.name,
    role: m.role,
    level: m.level ?? 'staff',
    userId: `u_${m.slug}`,
    showOnPage: m.showOnPage,
  }));

const employeeIdsOf = (members: Member[]) => members.map((m) => `e_${m.slug}`);

// ── Users ───────────────────────────────────────────────────────────────────

export const seedUsers: User[] = [
  // Sagar — the demo sign-in account. A plain customer: no business of his
  // own, a child on the school bus, free to register/order/review anything.
  {
    id: 'u_demo',
    name: 'Sagar',
    email: 'rathoretrayamb@gmail.com',
    phone: '+91 98260 10001',
    bio: 'Testing One Place. Parent of Aarav (Class 4, on the school bus).',
    isProfilePublic: true,
  },

  // Business owners
  {
    id: 'u_bhupendra',
    name: 'Bhupendra Choudhary',
    email: 'bhupendra@localo.app',
    phone: '+91 98260 20001',
    bio: 'LIC & Star Health insurance advisor since 2001.',
    isProfilePublic: true,
  },
  {
    id: 'u_arvind',
    name: 'Arvind Yadav',
    email: 'arvind@localo.app',
    phone: '+91 98260 20002',
    bio: 'Runs Arvind School Bus — safe school transport with live tracking.',
    isProfilePublic: true,
  },
  {
    id: 'u_gayatri',
    name: 'Gayatri Verma',
    email: 'gayatri@localo.app',
    phone: '+91 98260 20003',
    bio: 'Wedding designer and owner of Gayatri Tent House.',
    isProfilePublic: true,
  },
  {
    id: 'u_aditya',
    name: 'Aditya Khandelwal',
    email: 'aditya@localo.app',
    phone: '+91 98260 20004',
    bio: 'Owner, Aditya Electronica — ACs to light bulbs, sales and installation.',
    isProfilePublic: true,
  },
  {
    id: 'u_mira',
    name: 'Mira Sharma',
    email: 'mira@localo.app',
    phone: '+91 98260 20005',
    bio: 'I make and sell handcrafts — jute, terracotta, macramé and crochet.',
    isProfilePublic: true,
  },
  {
    id: 'u_shraddha',
    name: 'Shraddha Patil',
    email: 'shraddha@localo.app',
    phone: '+91 98260 20006',
    bio: 'Owner, Shraddha Rentals — two-wheelers and cars on daily rent.',
    isProfilePublic: true,
  },
  {
    id: 'u_rohan',
    name: 'Rohan Mehta',
    email: 'rohan@localo.app',
    phone: '+91 98260 20007',
    bio: 'Owner, Cafe Neighborhood.',
    isProfilePublic: true,
  },
  {
    id: 'u_vikram',
    name: 'Vikram Agarwal',
    email: 'vikram@localo.app',
    phone: '+91 98260 20008',
    bio: 'Owner, Shreemaya Restaurant.',
    isProfilePublic: true,
  },
  {
    id: 'u_mahendra',
    name: 'Mahendra Bais',
    email: 'mahendra@localo.app',
    phone: '+91 98260 20009',
    bio: 'Owner & head trainer, FitZone Gym — strength, yoga and zumba batches.',
    isProfilePublic: true,
  },

  // Parents whose children ride Arvind School Bus (customers for tracking)
  {
    id: 'u_pooja',
    name: 'Pooja Singh',
    email: 'pooja@localo.app',
    bio: 'Parent of Diya (Class 2).',
    isProfilePublic: true,
  },
  {
    id: 'u_neha',
    name: 'Neha Kulkarni',
    email: 'neha@localo.app',
    bio: 'Parent of Kabir (Class 5).',
    isProfilePublic: true,
  },
  {
    id: 'u_rakesh',
    name: 'Rakesh Jain',
    email: 'rakesh@localo.app',
    bio: 'Parent of Ananya (Class 1).',
    isProfilePublic: true,
  },

  // Every employee of every business, as registered users
  ...memberUsers(SCHOOLBUS_TEAM, 'Arvind School Bus'),
  ...memberUsers(TENTHOUSE_TEAM, 'Gayatri Tent House'),
  ...memberUsers(CAFE_TEAM, 'Cafe Neighborhood'),
  ...memberUsers(RESTAURANT_TEAM, 'Shreemaya Restaurant'),
];

export const seedEmployees: Employee[] = [
  ...memberEmployees('b_schoolbus', SCHOOLBUS_TEAM),
  ...memberEmployees('b_tenthouse', TENTHOUSE_TEAM),
  ...memberEmployees('b_cafe', CAFE_TEAM),
  ...memberEmployees('b_shreemaya', RESTAURANT_TEAM),
];

// ── Fleet & live tracking ───────────────────────────────────────────────────
// Arvind School Bus: 1 school bus + 3 mini vans, one driver pinned to each,
// and 4 students riding — one per vehicle. Sagar's son Aarav is on the bus,
// and Ramesh (its driver) is already sharing his location, so signing in as
// Sagar and tapping "Track my child" shows a moving bus straight away.
// Gayatri Tent House: 2 mini pickups for delivering tent & decor material.

export const seedVehicles: Vehicle[] = [
  {
    id: 'v_asb_bus',
    businessId: 'b_schoolbus',
    name: 'School bus — MP-09 SB 4521',
    kind: 'bus',
    driverEmployeeId: 'e_ramesh',
    createdAt: '2026-06-15T08:00:00.000Z',
  },
  {
    id: 'v_asb_van1',
    businessId: 'b_schoolbus',
    name: 'Mini van 1 — MP-09 KV 1101',
    kind: 'van',
    driverEmployeeId: 'e_suresh',
    createdAt: '2026-06-15T08:05:00.000Z',
  },
  {
    id: 'v_asb_van2',
    businessId: 'b_schoolbus',
    name: 'Mini van 2 — MP-09 KV 2202',
    kind: 'van',
    driverEmployeeId: 'e_dinesh',
    createdAt: '2026-06-15T08:10:00.000Z',
  },
  {
    id: 'v_asb_van3',
    businessId: 'b_schoolbus',
    name: 'Mini van 3 — MP-09 KV 3303',
    kind: 'van',
    driverEmployeeId: 'e_mahesh',
    createdAt: '2026-06-15T08:15:00.000Z',
  },
  {
    id: 'v_gth_pickup1',
    businessId: 'b_tenthouse',
    name: 'Mini pickup 1 — MP-09 GA 7788',
    kind: 'truck',
    driverEmployeeId: 'e_raju',
    createdAt: '2026-06-20T09:00:00.000Z',
  },
  {
    id: 'v_gth_pickup2',
    businessId: 'b_tenthouse',
    name: 'Mini pickup 2 — MP-09 GA 8899',
    kind: 'truck',
    driverEmployeeId: 'e_deepaks',
    createdAt: '2026-06-20T09:05:00.000Z',
  },
];

export const seedTrackedItems: TrackedItem[] = [
  {
    id: 't_aarav',
    businessId: 'b_schoolbus',
    kind: 'child',
    label: 'Aarav — Class 4',
    customerId: 'u_demo',
    customerName: 'Sagar',
    vehicleId: 'v_asb_bus',
    // Filed under Sagar's bus membership so the owner's Members screen shows
    // Aarav as already on the bus (and editing it moves, not duplicates).
    membershipId: 'm_demo_bus',
    createdAt: '2026-06-16T07:30:00.000Z',
  },
  {
    id: 't_diya',
    businessId: 'b_schoolbus',
    kind: 'child',
    label: 'Diya — Class 2',
    customerId: 'u_pooja',
    customerName: 'Pooja Singh',
    vehicleId: 'v_asb_van1',
    membershipId: 'm_pooja_bus',
    createdAt: '2026-06-16T07:31:00.000Z',
  },
  {
    id: 't_kabir',
    businessId: 'b_schoolbus',
    kind: 'child',
    label: 'Kabir — Class 5',
    customerId: 'u_neha',
    customerName: 'Neha Kulkarni',
    vehicleId: 'v_asb_van2',
    createdAt: '2026-06-16T07:32:00.000Z',
  },
  {
    id: 't_ananya',
    businessId: 'b_schoolbus',
    kind: 'child',
    label: 'Ananya — Class 1',
    customerId: 'u_rakesh',
    customerName: 'Rakesh Jain',
    vehicleId: 'v_asb_van3',
    createdAt: '2026-06-16T07:33:00.000Z',
  },
];

export const seedLocationShares: LocationShare[] = [
  // Ramesh is on the morning route right now; the other drivers are offline.
  {
    businessId: 'b_schoolbus',
    userId: 'u_ramesh',
    active: true,
    point: { latitude: 22.7365, longitude: 75.8725 },
    heading: 145,
    updatedAt: new Date().toISOString(),
  },
];

// ── Logbook ─────────────────────────────────────────────────────────────────
// Manual records — the orders that never went through the app (phone, cash,
// walk-in). Every IN-APP order is added to the book automatically (derived from
// the order), so the seed only carries the hand-written ones. These show the
// cafe owner what a logbook looks like before any live order exists.

export const seedLogEntries: LogEntry[] = [
  {
    id: 'log_seed_cafe_1',
    businessId: 'b_cafe',
    source: 'manual',
    title: 'Phone order · Meena',
    details: '2 cappuccinos + 1 banana bread, picked up at 9am.',
    amount: 460,
    customerName: 'Meena',
    recordedByName: 'Rohan',
    createdAt: '2026-07-16T03:35:00.000Z',
  },
  {
    id: 'log_seed_cafe_2',
    businessId: 'b_cafe',
    source: 'manual',
    title: 'Walk-in cash sale',
    details: 'Cold coffee + brownie, paid cash.',
    amount: 320,
    recordedByName: 'Rohan',
    createdAt: '2026-07-17T11:10:00.000Z',
  },
];

// ── Stall product threads ───────────────────────────────────────────────────
// The PUBLIC noticeboard under a stall item. Everyone reads the same thread, so
// the second buyer with the same question finds it already answered, and offers
// are out in the open. Rakesh's iPhone carries a full conversation: Sagar (the
// demo sign-in) asked, got an answer and proposed a price; Pooja later asked
// her own question — and can read everything Sagar was told.

export const seedProductMessages: ProductMessage[] = [
  {
    id: 'pm_iphone_1',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_demo',
    authorName: 'Sagar',
    fromSeller: false,
    text: 'Is the bill in your name? And has the screen ever been changed?',
    createdAt: '2026-07-04T10:12:00.000Z',
  },
  {
    id: 'pm_iphone_2',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_rakesh',
    authorName: 'Rakesh Jain',
    fromSeller: true,
    text: 'Yes, bill is in my name. Screen and battery are both original, never opened.',
    replyToId: 'pm_iphone_1',
    createdAt: '2026-07-04T12:40:00.000Z',
  },
  {
    id: 'pm_iphone_3',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_demo',
    authorName: 'Sagar',
    fromSeller: false,
    text: 'Battery health is 89%, so it will need a replacement soon. Can you do this?',
    offerPrice: '₹25,000',
    createdAt: '2026-07-04T13:05:00.000Z',
  },
  {
    id: 'pm_iphone_4',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_rakesh',
    authorName: 'Rakesh Jain',
    fromSeller: true,
    text: 'A bit low. I can do ₹27,000 — that is with the box and the original bill.',
    replyToId: 'pm_iphone_3',
    createdAt: '2026-07-04T18:20:00.000Z',
  },
  {
    id: 'pm_iphone_5',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_pooja',
    authorName: 'Pooja Singh',
    fromSeller: false,
    text: 'Which colour is it, and can I see it this Sunday around Vijay Nagar?',
    createdAt: '2026-07-09T09:30:00.000Z',
  },
  {
    id: 'pm_iphone_6',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_iphone',
    authorId: 'u_rakesh',
    authorName: 'Rakesh Jain',
    fromSeller: true,
    text: 'Black. Sunday after 11 am works — message me here and I will share the spot.',
    replyToId: 'pm_iphone_5',
    createdAt: '2026-07-09T10:05:00.000Z',
  },

  // A sold item keeps its thread — that's the point of a public one.
  {
    id: 'pm_microwave_1',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_microwave',
    authorId: 'u_neha',
    authorName: 'Neha Kulkarni',
    fromSeller: false,
    text: 'Still available? I can pick it up today.',
    createdAt: '2026-07-06T08:15:00.000Z',
  },
  {
    id: 'pm_microwave_2',
    businessId: 'b_stall_rakesh',
    productId: 'p_rakesh_microwave',
    authorId: 'u_rakesh',
    authorName: 'Rakesh Jain',
    fromSeller: true,
    text: 'Sorry, this one is sold.',
    replyToId: 'pm_microwave_1',
    createdAt: '2026-07-06T09:00:00.000Z',
  },
];

// ── Reviews ─────────────────────────────────────────────────────────────────
// A few written reviews so business pages aren't bare. The seeded
// ratingAvg/ratingCount on each business stand in for the larger history a
// real backend would hold; new in-app reviews fold into those aggregates.
// Sagar has left none yet, so he can test writing one fresh.

export const seedReviews: Review[] = [
  {
    id: 'r_shreemaya_pooja',
    businessId: 'b_shreemaya',
    customerId: 'u_pooja',
    customerName: 'Pooja Singh',
    rating: 5,
    comment: 'Dal makhani and butter naan were outstanding. The special thali easily feeds two.',
    createdAt: '2026-06-28T20:15:00.000Z',
  },
  {
    id: 'r_cafe_neha',
    businessId: 'b_cafe',
    customerId: 'u_neha',
    customerName: 'Neha Kulkarni',
    rating: 4,
    comment: 'Great cold coffee and brownies. Seating fills up fast in the evening.',
    createdAt: '2026-07-01T18:40:00.000Z',
  },
  {
    id: 'r_insurance_rakesh',
    businessId: 'b_insurance',
    customerId: 'u_rakesh',
    customerName: 'Rakesh Jain',
    rating: 5,
    comment:
      'Bhupendra ji handled my father’s mediclaim renewal and a hospital claim end to end. 20+ years of experience shows.',
    createdAt: '2026-06-20T11:00:00.000Z',
  },
  {
    id: 'r_electronica_pooja',
    businessId: 'b_electronica',
    customerId: 'u_pooja',
    customerName: 'Pooja Singh',
    rating: 5,
    comment: 'Bought a 1.5 ton AC — delivered and installed the very next day.',
    createdAt: '2026-05-30T16:20:00.000Z',
  },
  {
    id: 'r_shraddha_neha',
    businessId: 'b_shraddha',
    customerId: 'u_neha',
    customerName: 'Neha Kulkarni',
    rating: 2,
    comment: 'Scooter was fine but pickup took 40 minutes past the booked time. Helmet was worn out.',
    createdAt: '2026-06-25T10:30:00.000Z',
  },
];

// ── B2B chat ────────────────────────────────────────────────────────────────
// One seeded business-to-business thread — the cafe borrowing stock from the
// restaurant — so the B2B inbox demos from either owner's side (Rohan/Vikram
// in /dev). Names are re-hydrated from live businesses on read.

export const seedBizChat: BizChatMessage[] = [
  {
    id: 'bm_1',
    threadKey: 'b_cafe|b_shreemaya',
    fromBusinessId: 'b_cafe',
    fromBusinessName: 'Cafe Neighborhood',
    authorName: 'Rohan Mehta',
    body: 'Vikram bhai, our coffee bean delivery is stuck till Monday — can you spare 5kg? Will replace from the fresh lot.',
    at: '2026-07-10T09:05:00.000Z',
  },
  {
    id: 'bm_2',
    threadKey: 'b_cafe|b_shreemaya',
    fromBusinessId: 'b_shreemaya',
    fromBusinessName: 'Shreemaya',
    authorName: 'Vikram Agarwal',
    body: 'Haan, no problem. Sending 5kg with our supply van by 4 pm — need anything else?',
    at: '2026-07-10T09:20:00.000Z',
  },
  {
    id: 'bm_3',
    threadKey: 'b_cafe|b_shreemaya',
    fromBusinessId: 'b_cafe',
    fromBusinessName: 'Cafe Neighborhood',
    authorName: 'Rohan Mehta',
    body: 'That’s all — thanks! Your staff drinks free coffee this week ☕',
    at: '2026-07-10T09:24:00.000Z',
  },
];

// ── Memberships ─────────────────────────────────────────────────────────────
// Recurring plans businesses enrolled customers into. Sagar (the demo user)
// pays for the gym, a yoga batch, and his son's school-bus seat — so the
// Subscriptions tab has real data and months of history out of the box.
// renewedAt/expiresAt are placeholders; the repository recomputes the current
// billing cycle from startedAt on every read.

export const seedMemberships: Membership[] = [
  {
    id: 'm_demo_bus',
    businessId: 'b_schoolbus',
    businessName: 'Arvind School Bus',
    customerId: 'u_demo',
    customerName: 'Sagar',
    planName: 'School bus seat — monthly (Aarav)',
    pricePerMonth: 1200,
    startedAt: '2026-04-15T08:00:00.000Z',
    renewedAt: '2026-04-15T08:00:00.000Z',
    expiresAt: '2026-05-15T08:00:00.000Z',
    status: 'active',
  },
  {
    id: 'm_demo_gym',
    businessId: 'b_gym',
    businessName: 'FitZone Gym',
    customerId: 'u_demo',
    customerName: 'Sagar',
    planName: 'Gym membership — monthly',
    pricePerMonth: 1200,
    startedAt: '2026-05-05T07:00:00.000Z',
    renewedAt: '2026-05-05T07:00:00.000Z',
    expiresAt: '2026-06-05T07:00:00.000Z',
    status: 'active',
  },
  {
    id: 'm_demo_yoga',
    businessId: 'b_gym',
    businessName: 'FitZone Gym',
    customerId: 'u_demo',
    customerName: 'Sagar',
    planName: 'Morning yoga batch',
    pricePerMonth: 800,
    startedAt: '2026-06-10T07:00:00.000Z',
    renewedAt: '2026-06-10T07:00:00.000Z',
    expiresAt: '2026-07-10T07:00:00.000Z',
    status: 'active',
  },
  {
    id: 'm_pooja_bus',
    businessId: 'b_schoolbus',
    businessName: 'Arvind School Bus',
    customerId: 'u_pooja',
    customerName: 'Pooja Singh',
    planName: 'Mini van seat — monthly (Diya)',
    pricePerMonth: 1500,
    startedAt: '2026-06-01T08:00:00.000Z',
    renewedAt: '2026-06-01T08:00:00.000Z',
    expiresAt: '2026-07-01T08:00:00.000Z',
    status: 'active',
  },
];

// ── Businesses ──────────────────────────────────────────────────────────────

export const seedBusinesses: Business[] = [
  // ── Services ───────────────────────────────────────────────
  {
    id: 'b_insurance',
    ownerId: 'u_bhupendra',
    name: 'Bhupendra Insurance',
    tagline: 'LIC & Star Health advisor — since 2001',
    description:
      'Trusted insurance advisor helping Indore families choose the right cover since 2001. ' +
      'I work with LIC for life insurance, Star Health for mediclaim, and leading general ' +
      'insurers for vehicle and shop policies. Over two decades and 900+ policies serviced — ' +
      'new policies, renewals, premium reminders, and full claim support at your doorstep.',
    type: 'service',
    subcategoryId: 'other',
    location: {
      kind: 'office',
      addressLine: '12 Sitlamata Bazar',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.723, longitude: 75.861 },
    },
    phone: '+91 98260 20001',
    email: 'bhupendra@localo.app',
    employeeIds: [],
    ratingAvg: 4.9,
    ratingCount: 214,
    priceLabel: 'Free consultation',
    priceLevel: 1,
    providerType: 'Insurance agent',
    tags: ['Insurance Agent', 'LIC', 'Star Health', 'Claim support'],
    services: [
      { name: 'LIC life insurance — new policy', description: 'Endowment, money-back & pension plans' },
      { name: 'Term insurance plan', description: 'High cover at low premium — quote as per age' },
      { name: 'Star Health mediclaim — family floater', description: 'Cashless at 14,000+ hospitals' },
      { name: 'Vehicle insurance renewal', price: 'from ₹2,400' },
      { name: 'Claim assistance', description: 'Free for my policyholders' },
    ],
    openNow: true,
    hours: 'Mon–Sat, 10 AM – 7 PM',
    createdAt: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'b_schoolbus',
    ownerId: 'u_arvind',
    name: 'Arvind School Bus',
    tagline: 'Safe school pickup & drop, live-tracked',
    description:
      'Door-to-door school transport — we pick your child up in the morning, drop them at ' +
      'school, and bring them home after. One full-size school bus and three mini vans, each ' +
      'with its own vetted driver, and every vehicle is live-tracked in the app so parents can ' +
      'watch the ride both ways. Fixed monthly rate, no fuel surcharges.',
    type: 'service',
    subcategoryId: 'transport',
    location: {
      kind: 'home',
      label: 'Run from home',
      city: 'Indore',
      region: 'MP',
      isHome: true,
      hidePreciseLocation: true, // owner hides the exact home address
      point: { latitude: 22.7405, longitude: 75.877 }, // internal only, for distance
    },
    phone: '+91 98260 20002',
    employeeIds: employeeIdsOf(SCHOOLBUS_TEAM),
    callHandlerIds: ['e_ramesh'],
    chatRecipientIds: [],
    ratingAvg: 4.8,
    ratingCount: 64,
    priceLabel: 'from ₹1,200/mo',
    priceLevel: 1,
    providerType: 'School transport',
    tags: ['School Bus Service', 'Transport', 'Live tracked', 'Vetted drivers'],
    services: [
      { name: 'School bus seat — monthly', price: '₹1,200/mo', description: 'Both-way pickup & drop' },
      { name: 'Mini van seat — monthly', price: '₹1,500/mo', description: 'Both-way, smaller group' },
      { name: 'One-way drop — monthly', price: '₹800/mo' },
    ],
    openNow: true,
    hours: '6 AM – 5 PM',
    createdAt: '2026-04-10T08:30:00.000Z',
  },
  {
    id: 'b_gym',
    ownerId: 'u_mahendra',
    name: 'FitZone Gym',
    tagline: 'Strength training, yoga & zumba batches',
    description:
      'Neighbourhood gym in Bhawarkua with free weights, machines and cardio, plus morning ' +
      'yoga and evening zumba batches. Monthly memberships with no joining fee — your plan ' +
      'shows up in your One Place subscriptions with renewal dates, so there are never surprises.',
    type: 'service',
    subcategoryId: 'other',
    location: {
      kind: 'office',
      addressLine: '2nd floor, Trade Centre, Bhawarkua Square',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.699, longitude: 75.868 },
    },
    phone: '+91 98260 20009',
    email: 'mahendra@localo.app',
    employeeIds: [],
    ratingAvg: 4.6,
    ratingCount: 88,
    priceLabel: 'from ₹800/mo',
    priceLevel: 2,
    providerType: 'Gym & fitness studio',
    tags: ['Gym', 'Fitness', 'Yoga', 'Zumba', 'Personal Trainer'],
    services: [
      { name: 'Gym membership — monthly', price: '₹1,200/mo', description: 'Full floor access, all equipment' },
      { name: 'Morning yoga batch', price: '₹800/mo', description: '6:30–7:30 am, Mon–Sat' },
      { name: 'Evening zumba batch', price: '₹900/mo', description: '7–8 pm, Mon/Wed/Fri' },
      { name: 'Personal training', price: '₹4,000/mo', description: '1-on-1, 5 days a week' },
    ],
    modules: ['orders', 'bookings', 'billing', 'customers', 'memberships'],
    openNow: true,
    hours: '5:30 AM – 10 PM',
    createdAt: '2026-04-01T07:00:00.000Z',
  },
  {
    id: 'b_tenthouse',
    ownerId: 'u_gayatri',
    name: 'Gayatri Tent House',
    tagline: 'Weddings designed, managed & delivered',
    description:
      'Complete wedding design and event management — tent and pandal setup, mandap and stage ' +
      'decoration, flowers, lighting and catering counters. A five-person crew and two mini ' +
      'pickups mean we deliver, set up, and wind down on time, every time. Birthdays and small ' +
      'functions welcome too.',
    type: 'service',
    subcategoryId: 'events',
    location: {
      kind: 'office',
      addressLine: '45 Ranipura Main Road',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.715, longitude: 75.85 },
    },
    phone: '+91 98260 20003',
    employeeIds: employeeIdsOf(TENTHOUSE_TEAM),
    callHandlerIds: ['e_manoj'],
    chatRecipientIds: ['e_manoj', 'e_sunita'],
    ratingAvg: 4.7,
    ratingCount: 58,
    priceLabel: 'from ₹6,000',
    priceLevel: 2,
    providerType: 'Wedding designer & tent house',
    tags: ['Tent House', 'Wedding Decor', 'Event Planner', 'DJ & Sound'],
    services: [
      { name: 'Wedding tent & pandal setup', price: 'from ₹25,000' },
      { name: 'Stage & mandap decoration', price: 'from ₹15,000' },
      { name: 'Flower decoration', price: 'from ₹8,000' },
      { name: 'Lighting & sound', price: 'from ₹10,000' },
      { name: 'Catering counters & crockery', price: 'from ₹12,000' },
      { name: 'Birthday / small function package', price: 'from ₹6,000' },
    ],
    portfolio: [
      {
        id: 'pf_gth_mandap',
        kind: 'photo',
        url: 'https://picsum.photos/seed/localo-gth-mandap/900/600',
        title: 'Rose & marigold mandap',
        description: 'Two-day setup for a 600-guest wedding at Rajwada Gardens.',
        createdAt: '2026-05-18T10:00:00.000Z',
      },
      {
        id: 'pf_gth_stage',
        kind: 'photo',
        url: 'https://picsum.photos/seed/localo-gth-stage/900/600',
        title: 'Sangeet stage & lighting',
        createdAt: '2026-06-02T10:00:00.000Z',
      },
      {
        id: 'pf_gth_tent',
        kind: 'photo',
        url: 'https://picsum.photos/seed/localo-gth-tent/900/600',
        title: 'Waterproof pandal, 400 seats',
        createdAt: '2026-06-20T10:00:00.000Z',
      },
      {
        id: 'pf_gth_reel',
        kind: 'video',
        url: 'https://example.com/gayatri-tent-house/highlight-reel',
        thumbnailUrl: 'https://picsum.photos/seed/localo-gth-reel/900/600',
        title: 'Highlight reel — wedding season 2026',
        createdAt: '2026-06-25T10:00:00.000Z',
      },
    ],
    openNow: true,
    hours: '9 AM – 9 PM',
    createdAt: '2026-04-22T09:00:00.000Z',
  },

  // ── Shops ──────────────────────────────────────────────────
  {
    id: 'b_electronica',
    ownerId: 'u_aditya',
    name: 'Aditya Electronica',
    tagline: 'ACs to light bulbs — everything electronic',
    description:
      'One-stop electronics shop: big appliances like ACs, refrigerators and coolers, and every ' +
      'small thing too — bulbs, wires, extension boards, mosquito bats. Genuine brands, doorstep ' +
      'delivery on big items, and our own installation and repair team.',
    type: 'shop',
    subcategoryId: 'electronics',
    location: {
      kind: 'office',
      addressLine: '78 MG Road',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.727, longitude: 75.869 },
    },
    phone: '+91 98260 20004',
    email: 'aditya@localo.app',
    employeeIds: [],
    ratingAvg: 4.5,
    ratingCount: 132,
    priceLabel: '₹99 – ₹35,000',
    priceLevel: 2,
    providerType: 'Electronics shop',
    tags: ['Electronics', 'Appliance Repair', 'Mobile Shop', 'Installation'],
    products: [
      { name: 'Split AC 1.5 ton (5-star)', price: '₹34,990', description: 'Copper coil, 10-yr compressor warranty' },
      { name: 'Refrigerator 260L double door', price: '₹24,500' },
      { name: 'Desert air cooler 55L', price: '₹7,499' },
      { name: 'Storage geyser 15L', price: '₹6,999' },
      { name: 'Mixer grinder 750W', price: '₹2,899' },
      { name: 'Ceiling fan 1200mm', price: '₹1,649' },
      { name: 'Copper wire 1.5 sq mm (90m coil)', price: '₹1,899' },
      { name: 'Extension board — 4 socket', price: '₹349' },
      { name: 'Mosquito bat (rechargeable)', price: '₹399' },
      { name: 'LED bulb 9W', price: '₹99' },
    ],
    services: [
      { name: 'AC installation', price: '₹1,500' },
      { name: 'AC gas top-up', price: '₹2,500' },
      { name: 'Appliance repair visit', price: '₹300', description: 'Visit charge adjusted in repair bill' },
    ],
    offers: [
      {
        id: 'offer_electronica_cooler',
        tag: 'SEASON END',
        title: 'Desert cooler clearance',
        description: 'Last pieces of the summer stock',
        emoji: '❄️',
        lines: [{ kind: 'product', name: 'Desert air cooler 55L', price: '₹7,499', quantity: 1 }],
        price: '₹5,999',
        wasPrice: '₹7,499',
        active: true,
        createdAt: '2026-06-18T09:00:00.000Z',
      },
    ],
    openNow: true,
    hours: '10 AM – 8:30 PM',
    createdAt: '2026-05-02T09:30:00.000Z',
  },
  {
    id: 'b_cafe',
    ownerId: 'u_rohan',
    name: 'Cafe Neighborhood',
    tagline: 'Your everyday coffee corner',
    description:
      'A cosy neighbourhood cafe — proper espresso, chai, shakes, quick bites and desserts. ' +
      'Free Wi-Fi, board games on the shelf, and a full kitchen running all day. Order dine-in ' +
      'or takeaway right from the app.',
    type: 'shop',
    subcategoryId: 'cafe',
    location: {
      kind: 'office',
      addressLine: '5 Saket Square',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.7215, longitude: 75.857 },
    },
    phone: '+91 98260 20007',
    email: 'cafe.neighborhood@localo.app',
    employeeIds: employeeIdsOf(CAFE_TEAM),
    callHandlerIds: ['e_priya'],
    chatRecipientIds: ['e_priya', 'e_amit', 'e_gopal'],
    ratingAvg: 4.6,
    ratingCount: 248,
    priceLabel: '₹₹',
    priceLevel: 2,
    providerType: 'Cafe',
    tags: ['Cafe', 'Takeaway', 'Fast Food', 'Wi-Fi'],
    tableCount: 12,
    menu: [
      { name: 'Espresso', price: '₹120', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Americano', price: '₹140', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Cappuccino', price: '₹160', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Cafe Latte', price: '₹170', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Flat White', price: '₹180', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Mocha', price: '₹190', category: 'Coffee', subcategory: 'Hot' },
      { name: 'Cold Coffee', price: '₹150', description: 'House favourite, with ice cream +₹40', category: 'Coffee', subcategory: 'Cold' },
      { name: 'Cold Brew', price: '₹180', category: 'Coffee', subcategory: 'Cold' },
      { name: 'Hazelnut Frappe', price: '₹210', category: 'Coffee', subcategory: 'Cold' },
      { name: 'Masala Chai', price: '₹60', category: 'Tea & Coolers' },
      { name: 'Green Tea', price: '₹90', category: 'Tea & Coolers' },
      { name: 'Lemon Iced Tea', price: '₹120', category: 'Tea & Coolers' },
      { name: 'Peach Iced Tea', price: '₹130', category: 'Tea & Coolers' },
      { name: 'Fresh Lime Soda', price: '₹90', category: 'Tea & Coolers' },
      { name: 'Chocolate Shake', price: '₹180', category: 'Shakes' },
      { name: 'Oreo Shake', price: '₹190', category: 'Shakes' },
      { name: 'Strawberry Shake', price: '₹180', category: 'Shakes' },
      { name: 'Mango Shake (seasonal)', price: '₹170', category: 'Shakes' },
      { name: 'Veg Grilled Sandwich', price: '₹140', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Paneer Tikka Sandwich', price: '₹180', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Chicken Club Sandwich', price: '₹220', category: 'Quick Bites', subcategory: 'Non-veg' },
      { name: 'Veg Burger', price: '₹130', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Chicken Burger', price: '₹170', category: 'Quick Bites', subcategory: 'Non-veg' },
      { name: 'French Fries', price: '₹120', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Peri Peri Fries', price: '₹140', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Garlic Bread', price: '₹150', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Cheese Maggi', price: '₹110', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Pasta Alfredo', price: '₹220', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Pasta Arrabbiata', price: '₹200', category: 'Quick Bites', subcategory: 'Veg' },
      { name: 'Chocolate Brownie', price: '₹160', category: 'Desserts' },
      { name: 'Brownie with Ice Cream', price: '₹210', category: 'Desserts' },
      { name: 'Choco Lava Cake', price: '₹150', category: 'Desserts' },
      { name: 'Blueberry Cheesecake', price: '₹240', category: 'Desserts' },
      { name: 'Chocolate Chip Cookies (2 pc)', price: '₹80', category: 'Desserts' },
    ],
    partyPackages: [
      {
        name: 'Birthday Corner',
        price: '₹349 / person',
        description: 'Reserved corner, cake, snacks platter, soft drinks & decor · 8–25 guests',
      },
      {
        name: 'Kitty Party High Tea',
        price: '₹299 / person',
        description: 'High-tea spread with unlimited chai/coffee · 10–20 guests, 3–6 pm',
      },
    ],
    offers: [
      {
        id: 'offer_cafe_combo',
        tag: 'COMBO',
        title: 'Cappuccino + brownie',
        description: 'All day, every day',
        emoji: '☕',
        // The seeded REEL — a business that filmed its ad instead of
        // photographing it, so the /deals feed has a video to play out of the
        // box. Remote sample footage; a real one is filmed in Workspace ›
        // Offers and uploaded to the media bucket.
        videoUrl: 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4',
        lines: [
          { kind: 'menu', name: 'Cappuccino', price: '₹160', quantity: 1 },
          { kind: 'menu', name: 'Chocolate Brownie', price: '₹160', quantity: 1 },
        ],
        price: '₹249',
        wasPrice: '₹320',
        active: true,
        createdAt: '2026-06-20T08:00:00.000Z',
      },
    ],
    openNow: true,
    hours: '8 AM – 11 PM',
    createdAt: '2026-05-12T08:00:00.000Z',
  },
  {
    id: 'b_shreemaya',
    ownerId: 'u_vikram',
    name: 'Shreemaya',
    tagline: 'Classic Indian dining, veg & non-veg',
    description:
      'A full-service family restaurant — soups, tandoor starters, rich North Indian curries, ' +
      'biryanis, fresh breads and Indian desserts. Dine in with the family or order takeaway ' +
      'from the app; our kitchen runs lunch through dinner.',
    type: 'shop',
    subcategoryId: 'restaurant',
    location: {
      kind: 'office',
      addressLine: '21 RNT Marg',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.7248, longitude: 75.866 },
    },
    phone: '+91 98260 20008',
    email: 'shreemaya@localo.app',
    employeeIds: employeeIdsOf(RESTAURANT_TEAM),
    callHandlerIds: ['e_ashok'],
    chatRecipientIds: ['e_ashok', 'e_deepika', 'e_seema'],
    ratingAvg: 4.7,
    ratingCount: 512,
    priceLabel: '₹₹',
    priceLevel: 2,
    providerType: 'Restaurant',
    tags: ['Restaurant', 'Family Dining', 'Takeaway', 'Biryani'],
    tableCount: 10,
    // Sections come from the prebuilt library (domain/foodMenu.ts) — the same
    // ones an owner picks in registration. Veg/non-veg is the dot on each dish.
    menu: [
      { name: 'Shreemaya Special Veg Thali', price: '₹350', description: '2 sabzi, dal, rice, 3 roti, sweet, chaas', isVeg: true },
      { name: 'Tomato Basil Soup', price: '₹140', description: 'Slow-simmered tomatoes finished with fresh basil', category: 'Soups', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400' },
      { name: 'Sweet Corn Veg Soup', price: '₹150', description: 'Clear broth with sweet corn and chopped vegetables', category: 'Soups', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=400' },
      { name: 'Hot & Sour Soup', price: '₹150', description: 'Fermented soya and chilli soup served with chopped vegetables', category: 'Soups', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1583032015879-e5022cb87c3b?w=400' },
      { name: 'Paneer Tikka', price: '₹260', description: 'Char-grilled in the tandoor', category: 'Appetizers', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400' },
      { name: 'Hara Bhara Kabab', price: '₹220', category: 'Appetizers', isVeg: true },
      { name: 'Veg Manchurian', price: '₹230', category: 'Appetizers', isVeg: true },
      { name: 'Chilli Paneer', price: '₹260', category: 'Appetizers', isVeg: true },
      { name: 'Chicken Tikka', price: '₹320', category: 'Appetizers', isVeg: false, imageUrl: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=400' },
      { name: 'Tandoori Chicken (half)', price: '₹380', category: 'Appetizers', isVeg: false },
      { name: 'Fish Amritsari', price: '₹360', category: 'Appetizers', isVeg: false },
      { name: 'Paneer Butter Masala', price: '₹280', description: 'Cottage cheese in a rich tomato-cashew gravy', category: 'Main Course', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400' },
      { name: 'Kadai Paneer', price: '₹270', category: 'Main Course', isVeg: true },
      { name: 'Palak Paneer', price: '₹260', category: 'Main Course', isVeg: true },
      { name: 'Malai Kofta', price: '₹270', category: 'Main Course', isVeg: true },
      { name: 'Veg Kolhapuri', price: '₹250', category: 'Main Course', isVeg: true },
      { name: 'Dal Makhani', price: '₹230', description: 'Black lentils simmered overnight with butter and cream', category: 'Main Course', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1626500155537-8d4d5a4b6b0f?w=400' },
      { name: 'Dal Tadka', price: '₹190', category: 'Main Course', isVeg: true },
      { name: 'Chole Masala', price: '₹210', category: 'Main Course', isVeg: true },
      { name: 'Bhindi Masala', price: '₹200', category: 'Main Course', isVeg: true },
      { name: 'Butter Chicken', price: '₹340', description: 'The house classic — tandoori chicken in makhani gravy', category: 'Main Course', isVeg: false, imageUrl: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400' },
      { name: 'Kadai Chicken', price: '₹330', category: 'Main Course', isVeg: false },
      { name: 'Chicken Curry', price: '₹310', category: 'Main Course', isVeg: false },
      { name: 'Mutton Rogan Josh', price: '₹420', category: 'Main Course', isVeg: false },
      { name: 'Egg Curry', price: '₹220', category: 'Main Course', isVeg: false },
      { name: 'Tandoori Roti', price: '₹25', category: 'Breads', isVeg: true },
      { name: 'Butter Roti', price: '₹35', category: 'Breads', isVeg: true },
      { name: 'Missi Roti', price: '₹45', category: 'Breads', isVeg: true },
      { name: 'Butter Naan', price: '₹60', category: 'Breads', isVeg: true },
      { name: 'Garlic Naan', price: '₹75', category: 'Breads', isVeg: true },
      { name: 'Lachha Paratha', price: '₹65', category: 'Breads', isVeg: true },
      { name: 'Steamed Rice', price: '₹120', category: 'Rice', isVeg: true },
      { name: 'Jeera Rice', price: '₹150', category: 'Rice', isVeg: true },
      { name: 'Veg Pulao', price: '₹180', category: 'Rice', isVeg: true },
      { name: 'Veg Biryani', price: '₹240', category: 'Rice', isVeg: true },
      { name: 'Chicken Biryani', price: '₹300', description: 'Dum-cooked with long-grain basmati and saffron', category: 'Rice', isVeg: false, imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400' },
      { name: 'Gulab Jamun (2 pc)', price: '₹120', category: 'Desserts', isVeg: true, imageUrl: 'https://images.unsplash.com/photo-1666190092159-3171cf0fbb12?w=400' },
      { name: 'Rasmalai (2 pc)', price: '₹140', category: 'Desserts', isVeg: true },
      { name: 'Kesar Kulfi', price: '₹130', category: 'Desserts', isVeg: true },
      { name: 'Sweet Lassi', price: '₹110', category: 'Beverages', subcategory: 'Shakes', isVeg: true },
      { name: 'Masala Chaas', price: '₹80', category: 'Beverages', subcategory: 'Soft Drinks', isVeg: true },
      { name: 'Masala Chai', price: '₹60', category: 'Beverages', subcategory: 'Tea', isVeg: true },
      { name: 'Filter Coffee', price: '₹90', category: 'Beverages', subcategory: 'Coffee', isVeg: true },
    ],
    partyPackages: [
      {
        name: 'Birthday Buffet',
        price: '₹499 / person',
        description: 'Veg buffet with starters, 2 mains, breads, dessert & birthday cake · min 15 guests',
      },
      {
        name: 'Family Function Hall',
        price: '₹35,000',
        description: 'Private hall for 4 hours with buffet for up to 100 guests, decor extra',
      },
      {
        name: 'Kids Party Combo',
        price: '₹399 / person',
        description: 'Mini thali, ice cream, return gifts & balloon decor · 10–30 kids',
      },
    ],
    offers: [
      {
        id: 'offer_shreemaya_thali',
        tag: 'LUNCH 12–3',
        title: 'Special veg thali',
        description: 'Weekday lunch only, dine-in',
        emoji: '🍽️',
        lines: [
          { kind: 'menu', name: 'Shreemaya Special Veg Thali', price: '₹350', quantity: 1 },
        ],
        price: '₹249',
        wasPrice: '₹350',
        active: true,
        createdAt: '2026-06-22T11:00:00.000Z',
      },
    ],
    openNow: true,
    hours: '11 AM – 11 PM',
    createdAt: '2026-04-05T12:00:00.000Z',
  },

  // ── Rentals ────────────────────────────────────────────────
  {
    id: 'b_shraddha',
    ownerId: 'u_shraddha',
    name: 'Shraddha Rentals',
    tagline: 'Scooters, bikes & cars on rent',
    description:
      'Well-maintained two-wheelers and cars on daily rent — scooters for the city, a Royal ' +
      'Enfield for the weekend, hatchbacks and a 7-seater for family trips. Helmets included ' +
      'with every two-wheeler, all vehicles serviced and insured.',
    type: 'rental',
    subcategoryId: 'cars',
    location: {
      kind: 'office',
      addressLine: '3 Bhawarkua Main Road',
      city: 'Indore',
      region: 'MP',
      isHome: false,
      hidePreciseLocation: false,
      point: { latitude: 22.7185, longitude: 75.864 },
    },
    phone: '+91 98260 20006',
    email: 'shraddha@localo.app',
    employeeIds: [],
    ratingAvg: 4.3,
    ratingCount: 76,
    priceLabel: 'from ₹379/day',
    priceLevel: 1,
    providerType: 'Vehicle rental',
    tags: ['Bike Rental', 'Car Rental', 'Helmet incl.', 'Insured'],
    rentalBasis: 'both',
    rentalStatus: 'available',
    products: [
      { name: 'Honda Activa 6G (scooter)', price: '₹399/day' },
      { name: 'TVS Jupiter (scooter)', price: '₹379/day' },
      { name: 'Royal Enfield Classic 350', price: '₹899/day' },
      { name: 'Maruti Swift (petrol)', price: '₹1,799/day' },
      { name: 'Hyundai i20', price: '₹1,999/day' },
      { name: 'Toyota Innova Crysta (7-seater)', price: '₹3,499/day' },
    ],
    offers: [
      {
        id: 'offer_shraddha_weekday',
        tag: 'WEEKDAY',
        title: 'Activa — Mon to Thu',
        description: 'Helmet included, 100 km free',
        emoji: '🛵',
        videoUrl: 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/echo-hereweare.mp4',
        lines: [{ kind: 'product', name: 'Honda Activa 6G (scooter)', price: '₹399/day', quantity: 1 }],
        price: '₹299/day',
        wasPrice: '₹399/day',
        active: true,
        createdAt: '2026-06-15T10:00:00.000Z',
      },
    ],
    openNow: true,
    hours: '8 AM – 8 PM',
    createdAt: '2026-05-25T10:00:00.000Z',
  },

  // ── Items for sale: Mira's personal stall ──────────────────
  // One 'item' listing per individual holds EVERYTHING they're selling as
  // products; each product carries its own "For sale" subcategory so browse
  // chips match on what's inside the stall.
  {
    id: 'b_stall_mira',
    ownerId: 'u_mira',
    name: 'Mira’s Handcrafts',
    tagline: 'Personal items for sale',
    description:
      'Handmade with love — jute, terracotta, macramé, embroidery and crochet. Everything is ' +
      'made by me at home in small batches. Message me on One Place to order or ask for a custom ' +
      'piece; you’re welcome to offer your price.',
    type: 'item',
    location: {
      kind: 'service_area',
      city: 'Indore',
      region: 'MP',
      isHome: true,
      hidePreciseLocation: true, // seller only shows the city
      point: { latitude: 22.735, longitude: 75.888 }, // internal only, for distance
    },
    phone: '+91 98260 20005',
    employeeIds: [],
    ratingAvg: 4.9,
    ratingCount: 21,
    priceLabel: 'from ₹350',
    priceLevel: 1,
    providerType: 'Personal stall',
    products: [
      {
        id: 'p_mira_tote',
        name: 'Handwoven jute tote bag',
        price: '₹350',
        description:
          'Sturdy daily-use tote with cotton lining and a zip pocket inside. Holds a laptop, ' +
          'a water bottle and a week of vegetables without complaining.',
        images: [
          'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=800',
          'https://images.unsplash.com/photo-1544816155-12df9643f363?w=800',
        ],
        subcategoryId: 'other',
      },
      {
        id: 'p_mira_terracotta',
        name: 'Terracotta wall hanging',
        price: '₹550',
        description: 'Hand-painted, ready to hang. Each piece is a little different.',
        images: ['https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=800'],
        subcategoryId: 'home-goods',
      },
      {
        id: 'p_mira_macrame',
        name: 'Macramé plant hanger',
        price: '₹450',
        description: 'Fits pots up to 8 inches. Cotton rope, holds a heavy pot without stretching.',
        images: ['https://images.unsplash.com/photo-1616627561950-9f746e330187?w=800'],
        subcategoryId: 'home-goods',
      },
      {
        id: 'p_mira_cushions',
        name: 'Embroidered cushion covers (set of 2)',
        price: '₹650',
        description: '16×16", mirror-work on cotton. Covers only — no fillers.',
        images: ['https://images.unsplash.com/photo-1584100936595-c0654b55a2e6?w=800'],
        subcategoryId: 'home-goods',
      },
      {
        id: 'p_mira_pot',
        name: 'Warli hand-painted pot',
        price: '₹400',
        images: ['https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800'],
        subcategoryId: 'home-goods',
      },
      {
        id: 'p_mira_blanket',
        name: 'Crochet baby blanket',
        price: '₹850',
        description: 'Soft acrylic wool, made to order in your colours.',
        images: ['https://images.unsplash.com/photo-1544441893-675973e31985?w=800'],
        subcategoryId: 'other',
      },
    ],
    createdAt: '2026-06-10T18:45:00.000Z',
  },

  // ── Items for sale: Rakesh's stall (second-hand household goods) ──
  {
    id: 'b_stall_rakesh',
    ownerId: 'u_rakesh',
    name: 'Rakesh’s Stall',
    tagline: 'Personal items for sale',
    description:
      'Moving to a bigger flat — selling a few things we no longer need. Everything works, ' +
      'gently used, pickup from Vijay Nagar.',
    type: 'item',
    location: {
      kind: 'service_area',
      city: 'Indore',
      region: 'MP',
      isHome: true,
      hidePreciseLocation: true,
      point: { latitude: 22.7245, longitude: 75.8815 },
    },
    employeeIds: [],
    priceLabel: 'from ₹1,200',
    priceLevel: 1,
    providerType: 'Personal stall',
    products: [
      {
        id: 'p_rakesh_activa',
        name: 'Honda Activa 5G (2019)',
        price: '₹48,000',
        description:
          'Single owner, 21,000 km, papers clear and insurance valid till March. Serviced at ' +
          'the Honda showroom every time — I have all the bills. New battery last year.',
        images: [
          'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800',
          'https://images.unsplash.com/photo-1591637333184-19aa84b3e01f?w=800',
          'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800',
        ],
        subcategoryId: 'vehicles',
      },
      {
        id: 'p_rakesh_iphone',
        name: 'iPhone 12 128GB',
        price: '₹28,500',
        description:
          'Black, battery health 89%. Box, cable and original bill included. Always used with ' +
          'a case and screen guard — no scratches, no repairs, Face ID works.',
        images: [
          'https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=800',
          'https://images.unsplash.com/photo-1592286927505-1def25115558?w=800',
          'https://images.unsplash.com/photo-1607936854279-55e8a4c64888?w=800',
        ],
        subcategoryId: 'electronics',
      },
      {
        id: 'p_rakesh_sofa',
        name: '3-seater fabric sofa',
        price: '₹9,000',
        description: 'Grey, 4 years old, no tears. You arrange the pickup — it fits in a tempo.',
        images: [
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
          'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800',
        ],
        subcategoryId: 'furniture',
      },
      {
        id: 'p_rakesh_table',
        name: 'Study table with drawers',
        price: '₹2,800',
        description: 'Solid wood, fits a 24" monitor. Two drawers, both slide fine.',
        images: ['https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=800'],
        subcategoryId: 'furniture',
      },
      {
        id: 'p_rakesh_microwave',
        name: 'Microwave oven 20L',
        price: '₹3,400',
        description: 'Solo, works perfectly. Selling because the new flat has a built-in one.',
        images: ['https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=800'],
        sold: true, // shows how a sold item stays up, with its thread readable
        subcategoryId: 'appliances',
      },
      {
        id: 'p_rakesh_fan',
        name: 'Table fan 400mm',
        price: '₹1,200',
        images: ['https://images.unsplash.com/photo-1587212805567-fdb1bce77dd4?w=800'],
        subcategoryId: 'appliances',
      },
    ],
    createdAt: '2026-06-28T09:20:00.000Z',
  },

  // ── Items for sale: Pooja's stall (kids' things + electronics) ──
  {
    id: 'b_stall_pooja',
    ownerId: 'u_pooja',
    name: 'Pooja’s Stall',
    tagline: 'Personal items for sale',
    description:
      'Outgrown kids’ things and a couple of gadgets. Happy to show anything on a video call ' +
      'before you come over.',
    type: 'item',
    location: {
      kind: 'service_area',
      city: 'Indore',
      region: 'MP',
      isHome: true,
      hidePreciseLocation: true,
      point: { latitude: 22.7132, longitude: 75.8492 },
    },
    employeeIds: [],
    priceLabel: 'from ₹900',
    priceLevel: 1,
    providerType: 'Personal stall',
    products: [
      {
        id: 'p_pooja_cycle',
        name: 'Kids’ bicycle (16 inch)',
        price: '₹2,600',
        description: 'Training wheels included, ages 4–7. Tyres and brakes are fine, seat adjusts.',
        images: [
          'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=800',
          'https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=800',
        ],
        subcategoryId: 'vehicles',
      },
      {
        id: 'p_pooja_speaker',
        name: 'Bluetooth speaker',
        price: '₹1,400',
        description: 'Loud, 8-hour battery, barely used. Charging cable included.',
        images: ['https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800'],
        subcategoryId: 'electronics',
      },
      {
        id: 'p_pooja_lamp',
        name: 'Study lamp (LED)',
        price: '₹900',
        images: ['https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800'],
        subcategoryId: 'home-goods',
      },
      {
        id: 'p_pooja_bookshelf',
        name: 'Wooden bookshelf',
        price: '₹3,200',
        description: '5 shelves, easy to dismantle. Pickup from Rau side.',
        images: ['https://images.unsplash.com/photo-1594620302200-9a762244a156?w=800'],
        subcategoryId: 'furniture',
      },
    ],
    createdAt: '2026-07-02T16:10:00.000Z',
  },
];
