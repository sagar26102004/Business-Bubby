/**
 * Domain models — mirrors ../../../src/domain/types.ts (the app's source of
 * truth). Kept in sync by the STANDING RULE in CLAUDE.md: any change to a domain
 * shape must land here too. The backend deploys independently, so the types are
 * copied rather than imported across the repo boundary.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Structured opening hours (mirror of src/domain/hours.ts). */
export interface DayHours {
  closed?: boolean;
  open?: string;
  close?: string;
}
export interface OpeningHours {
  days: DayHours[];
  note?: string;
}

export type ListingType = 'service' | 'shop' | 'item' | 'rental';
export type LocationKind = 'office' | 'home' | 'service_area';

export interface BusinessLocation {
  kind: LocationKind;
  label?: string;
  addressLine?: string;
  city?: string;
  region?: string;
  country?: string;
  point?: GeoPoint;
  isHome: boolean;
  hidePreciseLocation: boolean;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  isProfilePublic: boolean;
  /**
   * Silenced notification families, as `"<businessId>:<category>"` keys
   * (`*` = everywhere). Private — lives in `profiles_private`, not the
   * world-readable directory card.
   */
  mutedNotifications?: string[];
  /**
   * Platform super-admin. DERIVED per request from `platform_admins`
   * (see lib/superAdmin) — never stored on the profile, because the profile is
   * user-writable and this is an authorization decision.
   */
  isSuperAdmin?: boolean;
}

export type EmployeeLevel = 'manager' | 'staff';

export interface Employee {
  id: string;
  businessId: string;
  displayName: string;
  role?: string;
  level?: EmployeeLevel;
  userId?: string;
  showOnPage?: boolean;
  permissions?: string[];
}

export interface AppNotification {
  id: string;
  recipientId: string;
  kind:
    | 'chat_reply'
    | 'booking_requested'
    | 'booking_update'
    | 'missed_call'
    | 'order_requested'
    | 'order_update'
    | 'bill_issued'
    | 'review_posted'
    | 'product_question'
    | 'product_reply'
    | 'enroll_requested'
    | 'enroll_update'
    | 'payment_reported'
    | 'payment_update';
  title: string;
  body: string;
  businessId?: string;
  orderId?: string;
  billId?: string;
  productId?: string;
  membershipId?: string;
  read: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  threadKey: string;
  authorType: 'customer' | 'business';
  authorName: string;
  body: string;
  billId?: string;
  createdAt: string;
}

export interface PortfolioItem {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  tag: string;
  title: string;
  description?: string;
  price?: string;
  wasPrice?: string;
  emoji?: string;
}

export type OfferLineKind = 'menu' | 'service' | 'product' | 'rental' | 'custom';

/**
 * One thing included in an `Offer`, picked from what the business already
 * lists. `price` is the item's NORMAL price captured at the moment it was
 * picked, so the offer can show what the bundle would otherwise cost even
 * after the underlying item is repriced.
 */
export interface OfferLine {
  kind: OfferLineKind;
  name: string;
  /** The item's normal price label when picked, e.g. "₹120". */
  price?: string;
  /** How many of it the offer includes. Defaults to 1. */
  quantity?: number;
}

/**
 * An OFFER — the business's own promotion: some of what it already sells,
 * bundled at a special price. Rides inside the Business document, so it needs
 * no table, no endpoint and no migration; the plain `PATCH /businesses/:id`
 * persists it.
 *
 * Deliberately a superset of `Deal` (tag/title/price/wasPrice/emoji), so
 * promoting an offer onto the Home "Deals near you" carousel later needs no
 * reshaping of the data.
 */
export interface Offer {
  id: string;
  title: string;
  description?: string;
  /** Shout label on the card, e.g. "COMBO", "40% OFF". */
  tag?: string;
  emoji?: string;
  /** What's included — picked from the business's own offerings. */
  lines: OfferLine[];
  /** What the customer pays for the bundle, e.g. "₹99". */
  price?: string;
  /** Normal total of `lines`, shown struck through. */
  wasPrice?: string;
  /** Off = kept in the workspace but hidden from customers. */
  active: boolean;
  /** ISO date the offer stops showing. Undefined = runs until switched off. */
  endsAt?: string;
  createdAt: string;
}

export interface MenuItem {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  isVeg?: boolean;
}

export interface ServiceItem {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  subcategory?: string;
}

export interface PartyPackage {
  name: string;
  price?: string;
  description?: string;
}

export interface PartyDetails {
  guests: number;
  when: string;
  occasion?: string;
}

export interface ProductItem {
  id?: string;
  name: string;
  price?: string;
  description?: string;
  images?: string[];
  sold?: boolean;
  subcategoryId?: string;
}

export interface ProductMessage {
  id: string;
  businessId: string;
  productId: string;
  authorId: string;
  authorName: string;
  fromSeller: boolean;
  text: string;
  offerPrice?: string;
  replyToId?: string;
  pinned?: boolean;
  createdAt: string;
}

export interface RentalItem {
  name: string;
  price?: string;
  description?: string;
  subcategoryId?: string;
  /** Prebuilt library grouping, e.g. "Cars" › "SUV" (see domain/offeringSections). */
  category?: string;
  subcategory?: string;
}

export type OfferingKind = 'product' | 'service';

export interface OrderLine {
  id: string;
  kind: OfferingKind;
  name: string;
  price?: string;
  offerPrice?: string;
  counterPrice?: string;
  quantity: number;
  included: boolean;
}

export type OrderFulfillment = 'dine_in' | 'takeaway';
export type OrderStatus = 'requested' | 'proposed' | 'accepted' | 'rejected' | 'declined';

export interface Order {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  lines: OrderLine[];
  fulfillment?: OrderFulfillment;
  tableNumber?: number;
  party?: PartyDetails;
  enrollees?: string[];
  note?: string;
  status: OrderStatus;
  responseMessage?: string;
  respondedByName?: string;
  billId?: string;
  deliveredAt?: string;
  deliveredByName?: string;
  createdAt: string;
  respondedAt?: string;
}

export interface BillLine {
  name: string;
  quantity: number;
  price?: string;
  amount?: number;
}

export interface Bill {
  id: string;
  businessId: string;
  businessName: string;
  customerId?: string;
  customerName: string;
  lines: BillLine[];
  total: number;
  note?: string;
  issuedByName: string;
  orderId?: string;
  paymentStatus: PaymentStatus;
  paidByName?: string;
  paidAt?: string;
  createdAt: string;
}

export type PaymentStatus = 'pending' | 'paid';
export type LogSource = 'order' | 'manual';

export interface LogEntry {
  id: string;
  businessId: string;
  source: LogSource;
  orderId?: string;
  title: string;
  details?: string;
  amount?: number;
  customerName?: string;
  recordedByName: string;
  createdAt: string;
}

export interface Review {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  rating: number;
  comment?: string;
  createdAt: string;
  updatedAt?: string;
}

export type BookingStatus = 'requested' | 'accepted' | 'declined' | 'completed';

export interface Booking {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  price?: string;
  when: string;
  note?: string;
  status: BookingStatus;
  createdAt: string;
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  tagline?: string;
  description?: string;
  type: ListingType;
  subcategoryId?: string;
  coverImageUrl?: string;
  location: BusinessLocation;
  phone?: string;
  email?: string;
  website?: string;
  employeeIds: string[];
  callHandlerIds?: string[];
  ownerHandlesCalls?: boolean;
  chatRecipientIds?: string[];
  scanHandlerIds?: string[];
  favoriteCustomerIds?: string[];
  modules?: string[];
  tableCount?: number;
  menu?: MenuItem[];
  partyPackages?: PartyPackage[];
  deals?: Deal[];
  offers?: Offer[];
  portfolio?: PortfolioItem[];
  services?: ServiceItem[];
  products?: ProductItem[];
  ratingAvg?: number;
  ratingCount?: number;
  priceLabel?: string;
  priceLevel?: 1 | 2 | 3;
  providerType?: string;
  tags?: string[];
  openNow?: boolean;
  hours?: string;
  openingHours?: OpeningHours;
  rentalBasis?: RentalBasis;
  rentals?: RentalItem[];
  rentalStatus?: RentalStatus;
  distanceKm?: number;
  createdAt: string;
}

export type RentalBasis = 'daily' | 'monthly' | 'both';
export type RentalStatus = 'available' | 'rented';

export interface Subcategory {
  id: string;
  name: string;
  icon?: string;
}

export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
export type CallParticipantState = 'ringing' | 'joined' | 'left' | 'declined';

export interface CallParticipant {
  id: string;
  name: string;
  side: 'customer' | 'business';
  roleLabel?: string;
  state: CallParticipantState;
  joinedAt?: string;
  leftAt?: string;
}

export interface Call {
  id: string;
  businessId: string;
  businessName: string;
  customerId: string;
  customerName: string;
  status: CallStatus;
  participants: CallParticipant[];
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
}

/** What a participant needs to join the call's live audio room (LiveKit). */
export interface CallAudioToken {
  token: string;
  url: string;
}

export type VehicleKind = 'bus' | 'van' | 'truck' | 'car' | 'bike' | 'other';

/** One point on a vehicle's route — the start, the end, or a stop in between. */
export interface JourneyStop {
  id: string;
  label: string;
  /** Pinned coordinate, when the owner placed one on the map. */
  point?: GeoPoint;
}

/** A saved route a vehicle runs: a start, an end, and any stops between them. */
export interface VehicleJourney {
  id: string;
  name: string;
  start: JourneyStop;
  end: JourneyStop;
  stops: JourneyStop[];
  createdAt: string;
}

export interface Vehicle {
  id: string;
  businessId: string;
  name: string;
  registrationNumber?: string;
  kind: VehicleKind;
  driverEmployeeId?: string;
  /** Saved routes for this vehicle (morning run, way back home, …). */
  journeys?: VehicleJourney[];
  /** Which saved journey the vehicle is currently running, if any. */
  activeJourneyId?: string;
  createdAt: string;
}

export type TrackedItemKind = 'child' | 'goods';

export interface TrackedItem {
  id: string;
  businessId: string;
  kind: TrackedItemKind;
  label: string;
  customerId: string;
  customerName: string;
  vehicleId?: string;
  membershipId?: string;
  note?: string;
  createdAt: string;
}

export interface LocationShare {
  businessId: string;
  userId: string;
  active: boolean;
  point: GeoPoint;
  heading: number;
  updatedAt: string;
}

export interface BizChatMessage {
  id: string;
  threadKey: string;
  fromBusinessId: string;
  fromBusinessName: string;
  authorName: string;
  body: string;
  at: string;
}

export interface Membership {
  id: string;
  businessId: string;
  businessName: string;
  customerId: string;
  customerName: string;
  planName: string;
  pricePerMonth: number;
  requestedPlan?: string;
  requestedPrice?: number;
  enrolleeName?: string;
  standalone?: boolean;
  startedAt: string;
  renewedAt: string;
  expiresAt: string;
  status: 'pending' | 'active' | 'cancelled' | 'rejected';
  endedAt?: string;
  payment?: MembershipPaymentSummary;
}

export interface MembershipPaymentSummary {
  status: 'paid' | 'pending' | 'unpaid';
  periodStart: string;
  daysOverdue: number;
  monthsPaid: number;
  totalPaid: number;
  pendingPaymentId?: string;
}

export interface MembershipPayment {
  id: string;
  membershipId: string;
  businessId: string;
  customerId: string;
  periodStart: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  method?: string;
  paidToName?: string;
  note?: string;
  reportedBy: 'customer' | 'business';
  reportedByName: string;
  reportedAt: string;
  decidedByName?: string;
  decidedAt?: string;
}

export interface MonthlySpendLine {
  businessName: string;
  planName: string;
  amount: number;
}

export interface MonthlySpend {
  month: string;
  total: number;
  lines: MonthlySpendLine[];
}

export type CatalogEntryKind = 'tag' | 'dish' | 'service' | 'product';

export interface CatalogEntry {
  id: string;
  kind: CatalogEntryKind;
  name: string;
  key: string;
  approved: boolean;
  adminAdded?: boolean;
  count: number;
  addedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export type PlaceKind = 'current' | 'home' | 'work' | 'custom';

export interface SavedPlace {
  id: string;
  label: string;
  kind: PlaceKind;
  point: GeoPoint;
  address?: string;
}
