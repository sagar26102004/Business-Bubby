/**
 * Repository interfaces — the contract between the UI and *any* data source.
 *
 * Screens and features depend only on these interfaces (via DataProvider),
 * never on a concrete implementation. Today they are backed by in-memory mock
 * data; swapping in a REST/GraphQL/Supabase backend later means writing new
 * classes that satisfy these interfaces and changing one line in DataProvider.
 */
import type {
  AppNotification,
  Bill,
  BillLine,
  BizChatMessage,
  Booking,
  BookingStatus,
  Business,
  BusinessLocation,
  Call,
  ChatMessage,
  Employee,
  EmployeeLevel,
  GeoPoint,
  ListingType,
  LogEntry,
  Membership,
  MembershipPayment,
  MenuItem,
  MonthlySpend,
  OfferingKind,
  Order,
  OrderFulfillment,
  PartyDetails,
  PaymentStatus,
  ProductMessage,
  RentalBasis,
  RentalItem,
  Review,
  SavedPlace,
  ProductItem,
  ServiceItem,
  TrackedItem,
  TrackedItemKind,
  User,
  Vehicle,
  VehicleKind,
} from '@/domain/types';

export interface BusinessQuery {
  /** Free-text search across name / tagline / description. */
  search?: string;
  type?: ListingType;
  subcategoryId?: string;
  /**
   * Origin for distance. When set, each returned business gets a computed
   * `distanceKm`. Businesses without coordinates are excluded when a distance
   * constraint (`maxDistanceKm`/`sortByDistance`) is in effect.
   */
  near?: GeoPoint;
  /** Only include businesses within this many km of `near`. */
  maxDistanceKm?: number;
  /** Sort results nearest-first (requires `near`). */
  sortByDistance?: boolean;
}

/** Input for creating an employee while registering a business. */
export interface NewEmployeeInput {
  displayName: string;
  role?: string;
  level?: EmployeeLevel;
  /** Set when the employee is an existing registered user. */
  userId?: string;
}

/** Everything needed to create a new business listing. */
export interface NewBusinessInput {
  name: string;
  tagline?: string;
  description?: string;
  type: ListingType;
  subcategoryId?: string;
  /** Discovery tags — what the business offers (Cafe, Tyres, Video editor…). */
  tags?: string[];
  location: BusinessLocation;
  phone?: string;
  email?: string;
  website?: string;
  priceLabel?: string;
  menu?: MenuItem[];
  services?: ServiceItem[];
  products?: ProductItem[];
  /** Workspace modules the owner opted into (ids from domain/modules.ts). */
  modules?: string[];
  /** Rentals: offered per day, per month, or both. */
  rentalBasis?: RentalBasis;
  /** What's available to rent, each with a price and rental category. */
  rentals?: RentalItem[];
  employees: NewEmployeeInput[];
}

export interface BusinessRepository {
  list(query?: BusinessQuery): Promise<Business[]>;
  getById(id: string): Promise<Business | null>;
  /**
   * Create a listing. Item listings are special: each user has ONE personal
   * stall (an 'item' business holding everything they sell as products), so
   * when the owner already has a stall the input's products are appended to
   * it and the stall is returned instead of creating a second listing.
   */
  create(input: NewBusinessInput, ownerId: string): Promise<Business>;
  /** The owner's personal stall, or null if they haven't listed an item yet. */
  getStallForOwner(ownerId: string): Promise<Business | null>;
  /** One product out of a stall, by its stable id. */
  getProduct(businessId: string, productId: string): Promise<ProductItem | null>;
  /**
   * Flip a stall item's SOLD flag (owner only — enforced here, not just in the
   * UI). The item stays listed so its public thread remains readable.
   */
  setProductSold(
    businessId: string,
    productId: string,
    sold: boolean,
    actorId: string,
  ): Promise<ProductItem>;
  /**
   * Take an item off the stall for good (owner only). Its public thread is
   * removed with it — unlike marking sold, which keeps the item listed.
   */
  removeProduct(businessId: string, productId: string, actorId: string): Promise<void>;
  /** Partial update — used by the owner to change call/chat routing, etc. */
  update(id: string, patch: Partial<Business>): Promise<Business>;
}

export interface EmployeeRepository {
  listByBusiness(businessId: string): Promise<Employee[]>;
  getById(id: string): Promise<Employee | null>;
  /** Businesses this user is listed as an employee of. */
  listBusinessesForUser(userId: string): Promise<Business[]>;
  /** Partial update — e.g. changing an employee's hierarchy level. */
  update(id: string, patch: Partial<Employee>): Promise<Employee>;
  /**
   * Add a team member to a business after it's been registered (an owner
   * action from the workspace). New members handle calls and chats by default,
   * exactly like the ones added at registration; the owner narrows that in
   * Manage.
   */
  add(businessId: string, input: NewEmployeeInput): Promise<Employee>;
  /** Remove a team member and detach them from the business's call/chat routing. */
  remove(id: string): Promise<void>;
}

/** Who is writing a chat message. */
export interface ChatAuthor {
  type: 'customer' | 'business';
  name: string;
}

/**
 * One conversation in a business's inbox. There is a single thread per customer
 * per business — any business member with chat access replies into it.
 */
export interface ChatThreadSummary {
  businessId: string;
  participantId: string;
  participantName: string;
  lastBody: string;
  lastAt: string;
  /** Who wrote the last message, so the inbox can show "awaiting reply". */
  lastAuthorType: 'customer' | 'business';
  count: number;
}

/** One row in a customer's DM list: their conversation with one business. */
export interface CustomerThreadSummary {
  businessId: string;
  businessName: string;
  lastBody: string;
  lastAt: string;
  /** Who wrote the last message, so the list can prefix "You:". */
  lastAuthorType: 'customer' | 'business';
  count: number;
}

export interface ChatRepository {
  /**
   * The single conversation between a customer and a business. `participantId`
   * identifies the customer (a user id, or 'guest').
   */
  listThread(businessId: string, participantId: string): Promise<ChatMessage[]>;
  /** Append a message from either side. Returns the updated thread. */
  send(
    businessId: string,
    participantId: string,
    body: string,
    author: ChatAuthor,
    extra?: { billId?: string },
  ): Promise<ChatMessage[]>;
  /** All conversations for a business (its inbox), newest first. */
  listBusinessThreads(businessId: string): Promise<ChatThreadSummary[]>;
  /** All of a customer's conversations across businesses (their DMs), newest first. */
  listCustomerThreads(participantId: string): Promise<CustomerThreadSummary[]>;
}

export interface NewUserInput {
  name: string;
  email?: string;
  isProfilePublic?: boolean;
}

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  /** All users — used by dev tools to list/impersonate accounts. */
  list(): Promise<User[]>;
  /** Search registered users by name — used when adding employees. */
  search(term: string): Promise<User[]>;
  /** Create a new account (used by dev tools). */
  create(input: NewUserInput): Promise<User>;
  update(id: string, patch: Partial<User>): Promise<User>;
}

export interface SignUpInput {
  name: string;
  phone: string;
}

export interface AuthRepository {
  /** The signed-in user, or null when browsing as a guest. */
  getCurrentUser(): Promise<User | null>;
  /** Mock sign-in: any credentials sign you in as the demo user. */
  signIn(email: string, password?: string): Promise<User>;
  /** Mock sign-up: creates a fresh account and signs in. */
  signUp(input: SignUpInput): Promise<User>;
  signOut(): Promise<void>;
  /** Dev/testing: sign in directly as a specific user id. */
  signInAs(userId: string): Promise<User>;
}

export interface PlacesRepository {
  /** The device's current location (real GPS via expo-location, falling back
   * to a seeded coordinate when permission is denied / unavailable). */
  getCurrentPlace(): Promise<SavedPlace>;
  /**
   * All places the user can browse around: current location plus saved places
   * (Home, Work, …). The current place is always first.
   */
  listPlaces(): Promise<SavedPlace[]>;
}

export interface NotificationRepository {
  /** A user's notifications, newest first. */
  listForUser(recipientId: string): Promise<AppNotification[]>;
  unreadCount(recipientId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(recipientId: string): Promise<void>;
}

export interface NewBookingInput {
  businessId: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  price?: string;
  when: string;
  note?: string;
}

export interface BookingRepository {
  /** Customer creates an appointment request. */
  create(input: NewBookingInput): Promise<Booking>;
  /** All bookings for a business (the provider's view). */
  listForBusiness(businessId: string): Promise<Booking[]>;
  /** A customer's own bookings across businesses. */
  listForCustomer(customerId: string): Promise<Booking[]>;
  /** Accept/decline/complete a booking. */
  updateStatus(id: string, status: BookingStatus): Promise<Booking>;
}

/** One line the customer picked when placing an order. */
export interface NewOrderLineInput {
  kind: OfferingKind;
  name: string;
  price?: string;
  /** Customer's bargained price on a stall order, e.g. "$300". */
  offerPrice?: string;
  quantity: number;
}

export interface NewOrderInput {
  businessId: string;
  customerId: string;
  customerName: string;
  lines: NewOrderLineInput[];
  /** Dine-in or takeaway — set when the business seats customers. */
  fulfillment?: OrderFulfillment;
  /**
   * Explicit table for a dine-in order (a member seating a customer). Left
   * unset for customer self-orders — the repository auto-assigns the lowest
   * free table, reusing the customer's table when they already have one.
   */
  tableNumber?: number;
  /** Set when this is a party/event request (guests, date & time, occasion). */
  party?: PartyDetails;
  /** On enroll/subscribe requests: who the plan is for (self and/or children). */
  enrollees?: string[];
  note?: string;
}

/**
 * Orders: a customer picks products/services from the business's catalog; the
 * business accepts everything, rejects with a message, or sends back a live
 * proposal with the lines it can't provide unticked. Accepting (either the
 * full order, or the customer accepting a proposal) issues a bill
 * automatically — EXCEPT dine-in orders, which stay open as a running tab:
 * the customer keeps adding rounds (`appendLines`) and the business bills the
 * whole tab at the end (`moveToBilling`). Every order stays in the
 * customer↔business history.
 */
export interface OrderRepository {
  /** Customer places an order. Notifies the business owner. */
  create(input: NewOrderInput): Promise<Order>;
  getById(id: string): Promise<Order | null>;
  /** All orders a business ever received, newest first. */
  listForBusiness(businessId: string): Promise<Order[]>;
  /** A customer's own orders, optionally with one business, newest first. */
  listForCustomer(customerId: string, businessId?: string): Promise<Order[]>;
  /**
   * Business responds to a requested order. `keptLineIds` are the lines it CAN
   * provide: keeping all of them accepts the order outright (a bill is issued);
   * keeping only some sends a proposal back to the customer. `counterPrices`
   * (lineId → price label) counters the customer's bargain offers — setting
   * any always sends a proposal, since the customer must agree to new prices.
   */
  respond(
    id: string,
    keptLineIds: string[],
    respondedByName: string,
    message?: string,
    counterPrices?: Record<string, string>,
  ): Promise<Order>;
  /** Business rejects the whole order, with an optional message. */
  reject(id: string, respondedByName: string, message?: string): Promise<Order>;
  /** Customer accepts (bill issued for the included lines) or declines a proposal. */
  decideProposal(id: string, accept: boolean): Promise<Order>;
  /**
   * Customer adds another round to an open (unbilled) order — the dine-in
   * "order more as you go" flow. The order returns to `requested` so the
   * business confirms the new items. Notifies the business owner.
   */
  appendLines(id: string, lines: NewOrderLineInput[]): Promise<Order>;
  /**
   * Business closes an open (accepted, unbilled) tab: issues the bill for all
   * included lines and links it. Notifies the customer.
   */
  moveToBilling(id: string, issuedByName: string): Promise<Order>;
  /**
   * QR handover: a staff member scanned the order's ticket and handed it to the
   * customer (the collect step of place → pay → collect). Sets `deliveredAt` /
   * `deliveredByName` and notifies the customer. Payment is a separate step on
   * the bill (BillRepository.setPaymentStatus). Idempotent-ish: re-marking a
   * collected order is rejected.
   */
  markDelivered(id: string, byName: string): Promise<Order>;
  /**
   * Seating snapshot for a dine-in business: one entry per table
   * (1..`Business.tableCount`), each carrying the open order sitting at it, if
   * any. Powers the member's table picker and the workspace occupancy view.
   * Returns an empty list for a business that doesn't run tables.
   */
  tableStatus(businessId: string): Promise<TableSeat[]>;
}

/** One table in a dine-in business's floor, with whoever is seated at it. */
export interface TableSeat {
  /** 1-based table number. */
  number: number;
  /** The open dine-in order seated here, or null when the table is free. */
  order: Order | null;
}

export interface NewBillInput {
  businessId: string;
  /** Customer's user id when known (enables in-app delivery of the bill). */
  customerId?: string;
  customerName: string;
  lines: Array<Omit<BillLine, 'amount'>>;
  note?: string;
  issuedByName: string;
  orderId?: string;
}

/**
 * Bills a business issues to customers. Created by hand from the workspace or
 * automatically when an order is accepted; shareable into the app chat and
 * (as text today, a PDF once the real backend renders one) via any other app.
 */
export interface BillRepository {
  create(input: NewBillInput): Promise<Bill>;
  getById(id: string): Promise<Bill | null>;
  /** Every bill a business issued, newest first. */
  listForBusiness(businessId: string): Promise<Bill[]>;
  /** Bills a customer received, optionally from one business, newest first. */
  listForCustomer(customerId: string, businessId?: string): Promise<Bill[]>;
  /** Post the bill into the business↔customer chat as a bill card. */
  sendToChat(billId: string, sentByName: string): Promise<void>;
  /**
   * Mark a bill paid/unpaid. Members only — the business is the side that
   * actually receives the money, so it's the side that confirms it.
   */
  setPaymentStatus(billId: string, status: PaymentStatus, byName: string): Promise<Bill>;
}

/**
 * Voice calls (WhatsApp-style internet calls, no phone numbers exchanged).
 *
 * The mock implementation is polled by the UI; a real backend replaces the
 * polling with a realtime signaling channel, WebRTC audio, and a VoIP push so
 * handlers ring even when the app is closed — all behind this same interface.
 */
export interface CallRepository {
  /** Customer starts a call; every eligible handler starts ringing. */
  start(businessId: string, customer: { id: string; name: string }): Promise<Call>;
  getById(callId: string): Promise<Call | null>;
  /** Pick up a ringing call, or join an already-answered one (group call). */
  join(callId: string, participantId: string): Promise<Call>;
  /** Decline while ringing. The call ends when every handler has declined. */
  decline(callId: string, participantId: string): Promise<Call>;
  /**
   * Hang up. The customer leaving ends the call for everyone; a business
   * member leaving ends it only when they were the last one on.
   */
  leave(callId: string, participantId: string): Promise<Call>;
  /**
   * The call currently ringing for (or joinable by) this business member, if
   * any. Polled by the global incoming-call overlay — the mock stand-in for a
   * VoIP push notification.
   */
  getIncomingForUser(userId: string): Promise<Call | null>;
}

/**
 * One customer who has done business with a listing, aggregated from their
 * orders, bookings, bills, chats and calls. `key` identifies them everywhere
 * favourites are concerned: a user id, 'guest', or `walkin:<name>` for a
 * bill-only customer the business typed in by hand.
 */
export interface CustomerSummary {
  businessId: string;
  key: string;
  name: string;
  /** True when the customer has an app account (chat and bill delivery work). */
  hasAccount: boolean;
  /** Starred by the owner. */
  favorite: boolean;
  orderCount: number;
  bookingCount: number;
  billCount: number;
  callCount: number;
  /** Messages exchanged in their chat thread (0 = never chatted). */
  chatCount: number;
  /** Sum of the parseable totals across their bills. */
  totalBilled: number;
  /** Most recent interaction of any kind (ISO timestamp). */
  lastActivityAt: string;
}

/**
 * The people a business has actually done business with — derived from the
 * interaction history rather than stored, so it's always complete. Favourites
 * are the one persisted piece (on the business itself).
 */
export interface CustomerRepository {
  /** Everyone who ever interacted with the business, favourites first. */
  listForBusiness(businessId: string): Promise<CustomerSummary[]>;
  /** Star or unstar a customer for this business. */
  setFavorite(businessId: string, customerKey: string, favorite: boolean): Promise<void>;
}

export interface NewReviewInput {
  businessId: string;
  customerId: string;
  customerName: string;
  /** 1–5 stars. */
  rating: number;
  /** Required when rating is 1 or 2 (the anti-fraud written reason). */
  comment?: string;
}

/** Whether a customer may rate a business, and why not when they can't. */
export interface ReviewEligibility {
  eligible: boolean;
  /** Human explanation when not eligible, shown on the rate screen. */
  reason?: string;
}

/**
 * Verified-customer ratings. A review can only come from someone who actually
 * did business with the listing — an accepted order, an accepted or completed
 * booking, or a bill in their name — so strangers can't post fraud ratings.
 * One review per customer per business; submitting again edits it in place.
 */
export interface ReviewRepository {
  /** A business's reviews, newest first. */
  listForBusiness(businessId: string): Promise<Review[]>;
  /** This customer's existing review of the business, if any. */
  getMine(businessId: string, customerId: string): Promise<Review | null>;
  /** The verified-customer gate (owners are never eligible for their own). */
  checkEligibility(businessId: string, customerId: string): Promise<ReviewEligibility>;
  /**
   * Create or update the customer's review. Enforces eligibility, rejects
   * 1–2 star ratings without a written comment, and folds the rating into the
   * business's `ratingAvg`/`ratingCount`.
   */
  submit(input: NewReviewInput): Promise<Review>;
}

export interface NewProductMessageInput {
  businessId: string;
  productId: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Present = the message is a price proposal, not just a question. */
  offerPrice?: string;
  /** The message being answered; omit for a new top-level question/offer. */
  replyToId?: string;
}

/**
 * The PUBLIC question-and-offer thread under a stall product. Unlike
 * `ChatRepository` (one private conversation per customer per business), this
 * is a noticeboard: every shopper reads the same thread, so an answer given to
 * one buyer serves the next, and offers are out in the open.
 */
export interface ProductThreadRepository {
  /** Every message on a product's thread, oldest first. */
  listForProduct(businessId: string, productId: string): Promise<ProductMessage[]>;
  /**
   * Every message across ALL of a stall's products, oldest first — powers the
   * owner's stall admin, which shows offers and pinned messages per item.
   */
  listForBusiness(businessId: string): Promise<ProductMessage[]>;
  /**
   * Post a question, an offer (`offerPrice`), or a reply (`replyToId`).
   * Guests can't post — the caller must pass a real user. Notifies the seller,
   * or the person being answered when the seller replies.
   */
  post(input: NewProductMessageInput): Promise<ProductMessage>;
  /**
   * Pin/unpin a message to the top of its product's thread (owner only —
   * enforced here, not just in the UI).
   */
  setPinned(
    businessId: string,
    productId: string,
    messageId: string,
    pinned: boolean,
    actorId: string,
  ): Promise<ProductMessage>;
}

export interface NewVehicleInput {
  businessId: string;
  /** Optional pet name — display falls back to the registration number. */
  name?: string;
  /** Number plate, e.g. "MP09 AB 1234". */
  registrationNumber?: string;
  kind: VehicleKind;
  driverEmployeeId?: string;
}

export interface NewTrackedItemInput {
  businessId: string;
  kind: TrackedItemKind;
  label: string;
  customerId: string;
  customerName: string;
  vehicleId?: string;
  /** Set when the child was assigned to a bus from the Members list. */
  membershipId?: string;
  note?: string;
}

/** A vehicle joined with its driver and latest shared position, for the map. */
export interface LiveVehicle {
  vehicle: Vehicle;
  driverName?: string;
  /** True while the assigned driver is sharing their live location. */
  sharing: boolean;
  point?: GeoPoint;
  updatedAt?: string;
}

/**
 * Live tracking: employees share their location with a business, vehicles are
 * pinned to a driver, and customers follow the vehicle carrying their child or
 * goods. The mock is polled by the UI; a real backend replaces polling with a
 * realtime location stream (and background GPS on the driver's phone) behind
 * this same interface.
 */
export interface TrackingRepository {
  /** A business's fleet. */
  listVehicles(businessId: string): Promise<Vehicle[]>;
  addVehicle(input: NewVehicleInput): Promise<Vehicle>;
  /** Partial update — e.g. reassigning the driver. */
  updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle>;
  removeVehicle(id: string): Promise<void>;

  /** Everything the business tracks for customers (owner's view). */
  listItems(businessId: string): Promise<TrackedItem[]>;
  /** A customer's own tracked children/goods, optionally per business. */
  listItemsForCustomer(customerId: string, businessId?: string): Promise<TrackedItem[]>;
  addItem(input: NewTrackedItemInput): Promise<TrackedItem>;
  /** Partial update — e.g. moving an item onto another vehicle. */
  updateItem(id: string, patch: Partial<TrackedItem>): Promise<TrackedItem>;
  removeItem(id: string): Promise<void>;

  /** Employee turns live-location sharing with a business on or off. */
  setSharing(businessId: string, userId: string, active: boolean): Promise<void>;
  isSharing(businessId: string, userId: string): Promise<boolean>;
  /** Live positions of a business's vehicles. Polled by the tracking map. */
  getLiveVehicles(businessId: string): Promise<LiveVehicle[]>;
}

/** The full set of repositories the app depends on. */
/** One row in a business's B2B inbox. */
export interface BizThreadSummary {
  threadKey: string;
  /** My side of the conversation. */
  businessId: string;
  businessName: string;
  otherBusinessId: string;
  otherBusinessName: string;
  lastBody: string;
  lastAt: string;
  lastFromBusinessId: string;
}

export interface NewBizMessageInput {
  fromBusinessId: string;
  toBusinessId: string;
  /** The member typing, for attribution. */
  authorName: string;
  body: string;
}

/**
 * Business-to-business chat — dealer ↔ distributor, shop ↔ supplier.
 * Threads live between two businesses; any member of either side can read
 * and reply as their business.
 */
export interface BizChatRepository {
  /** B2B threads across every business this user owns or works at. */
  listThreadsForUser(userId: string): Promise<BizThreadSummary[]>;
  listMessages(businessA: string, businessB: string): Promise<BizChatMessage[]>;
  /** Returns the updated thread. */
  send(input: NewBizMessageInput): Promise<BizChatMessage[]>;
}

/** Business side: enroll a customer into a recurring plan. */
export interface NewMembershipInput {
  businessId: string;
  customerId: string;
  customerName: string;
  planName: string;
  pricePerMonth: number;
}

/** Customer side: request to enroll/subscribe from the business page. */
export interface EnrollRequestInput {
  businessId: string;
  customerId: string;
  customerName: string;
  /** The customer's own words on what they want — optional, shown to the business. */
  requestedPlan?: string;
  /** The chosen plan's monthly price, so the business can accept in one tap. */
  requestedPrice?: number;
  /** Who the plan is for, when it isn't the account holder (e.g. a child). */
  enrolleeName?: string;
}

/** What the business fills in when accepting a pending enroll request. */
export interface AcceptEnrollInput {
  planName: string;
  pricePerMonth: number;
}

/** Logging a payment against one billing cycle of a membership. */
export interface ReportPaymentInput {
  membershipId: string;
  /** The cycle being paid — pass the membership's current `payment.periodStart`. */
  periodStart: string;
  /** 'cash' | 'online' | 'other'. */
  method?: string;
  /** Who cash was handed to, when relevant. */
  paidToName?: string;
  note?: string;
}

/**
 * Memberships — recurring customer plans (gym, yoga batch, tuition, school
 * bus seat). A plan starts one of two ways: the business enrolls a customer
 * directly (`add`), or the customer requests it (`request`) and the business
 * accepts (`accept`) or declines (`reject`). The customer's Subscriptions tab
 * reads only `active` plans.
 */
export interface MembershipRepository {
  /** The customer's active memberships across all businesses, newest first. */
  listForCustomer(customerId: string): Promise<Membership[]>;
  /** Month-by-month spend for the breakdown popup, newest month first. */
  monthlySpend(customerId: string): Promise<MonthlySpend[]>;
  /** One business's active members (workspace Members section). */
  listForBusiness(businessId: string): Promise<Membership[]>;
  /** One business's cancelled (unsubscribed) plans, for the Unsubscribed list. */
  listCancelledForBusiness(businessId: string): Promise<Membership[]>;
  /** Pending enroll/subscribe requests awaiting the business's decision. */
  listRequests(businessId: string): Promise<Membership[]>;
  /** A single membership by id (hydrated with its current payment standing). */
  getById(id: string): Promise<Membership | null>;
  add(input: NewMembershipInput): Promise<Membership>;
  /** A customer's self-service enroll/subscribe request → a `pending` plan. */
  request(input: EnrollRequestInput): Promise<Membership>;
  /** Business accepts a pending request, setting the plan name + price → `active`. */
  accept(id: string, input: AcceptEnrollInput): Promise<Membership>;
  /** Business declines a pending request. */
  reject(id: string): Promise<Membership>;
  /** Stops the plan — it keeps past months' history but stops renewing. */
  cancel(id: string): Promise<Membership>;
  /** Re-activate a cancelled plan on a fresh billing cycle from today. */
  reenroll(id: string): Promise<Membership>;
  /** Change when the plan started (the enrolment date) — resets the cycle to it. */
  setStartDate(id: string, startedAt: string): Promise<Membership>;
  /**
   * Move an enrolment onto a different customer's account. The new account is
   * billed monthly and sees it in their Subscriptions from now on; it leaves
   * the old account. Used when an enrollee was filed under the wrong parent.
   */
  reassign(id: string, toCustomerId: string, toCustomerName: string): Promise<Membership>;
  /**
   * Detach an enrollee into a standalone member with no linked account — the
   * business keeps tracking them by name, but nobody is billed and it shows in
   * no one's Subscriptions.
   */
  detach(id: string): Promise<Membership>;
  /** Rename the enrollee (or the standalone member's own name). */
  renameEnrollee(id: string, name: string): Promise<Membership>;
  /** Payment history for one membership, newest cycle first. */
  listPayments(membershipId: string): Promise<MembershipPayment[]>;
  /**
   * Customer self-reports a cycle as paid → `pending`, awaiting the business's
   * approval. The note/paid-to carry how it was paid (e.g. cash to a member).
   */
  reportPayment(input: ReportPaymentInput): Promise<MembershipPayment>;
  /** A member records a payment directly (cash at the counter) → `approved`. */
  recordPayment(input: ReportPaymentInput & { byName: string }): Promise<MembershipPayment>;
  /** Business approves a reported payment — the cycle now counts as paid. */
  approvePayment(id: string, byName: string): Promise<MembershipPayment>;
  /** Business rejects a reported payment (e.g. it never arrived). */
  rejectPayment(id: string, byName: string): Promise<MembershipPayment>;
}

/** A manual logbook record a member jots down (an order not placed in-app). */
export interface NewLogEntryInput {
  businessId: string;
  title: string;
  details?: string;
  amount?: number;
  customerName?: string;
  /** The member writing it, for attribution. */
  recordedByName: string;
}

/**
 * The logbook — a business's record book of orders. Every order placed through
 * the app is included automatically (derived live, never missed); members with
 * logbook access add manual records for the ones that weren't (phone/cash/
 * walk-in). Append-only: records are added, not edited or deleted.
 */
export interface LogbookRepository {
  /**
   * The whole book, newest first: manual records merged with an entry per
   * order the business ever received.
   */
  listForBusiness(businessId: string): Promise<LogEntry[]>;
  /** Add a manual record. */
  addManual(input: NewLogEntryInput): Promise<LogEntry>;
}

export interface Repositories {
  businesses: BusinessRepository;
  employees: EmployeeRepository;
  users: UserRepository;
  auth: AuthRepository;
  places: PlacesRepository;
  chat: ChatRepository;
  notifications: NotificationRepository;
  bookings: BookingRepository;
  orders: OrderRepository;
  bills: BillRepository;
  calls: CallRepository;
  customers: CustomerRepository;
  tracking: TrackingRepository;
  reviews: ReviewRepository;
  memberships: MembershipRepository;
  bizChat: BizChatRepository;
  productThreads: ProductThreadRepository;
  logbook: LogbookRepository;
}
