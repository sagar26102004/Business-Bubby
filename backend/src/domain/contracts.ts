/**
 * Request/response contract types — mirrors the input & summary interfaces in
 * ../../../src/data/repositories.ts. Endpoints accept these bodies and return
 * the domain objects from ./types, so the frontend api client (src/data/api)
 * passes them straight through. Kept in sync by the STANDING RULE in CLAUDE.md.
 */
import type {
  BillLine,
  BusinessLocation,
  CatalogEntryKind,
  EmployeeLevel,
  GeoPoint,
  ListingType,
  MenuItem,
  OfferingKind,
  OpeningHours,
  PartyDetails,
  ProductItem,
  RentalBasis,
  RentalItem,
  ServiceItem,
  TrackedItemKind,
  VehicleKind,
} from './types';

export interface BusinessQuery {
  search?: string;
  type?: ListingType;
  subcategoryId?: string;
  near?: GeoPoint;
  maxDistanceKm?: number;
  sortByDistance?: boolean;
}

export interface NewEmployeeInput {
  displayName: string;
  role?: string;
  level?: EmployeeLevel;
  userId?: string;
}

export interface NewBusinessInput {
  name: string;
  tagline?: string;
  description?: string;
  type: ListingType;
  subcategoryId?: string;
  tags?: string[];
  /** Super-admin registering for someone else sets the target owner's id here. */
  ownerId?: string;
  location: BusinessLocation;
  phone?: string;
  email?: string;
  website?: string;
  priceLabel?: string;
  menu?: MenuItem[];
  services?: ServiceItem[];
  products?: ProductItem[];
  hours?: string;
  openingHours?: OpeningHours;
  modules?: string[];
  rentalBasis?: RentalBasis;
  rentals?: RentalItem[];
  employees: NewEmployeeInput[];
}

export interface ChatAuthor {
  type: 'customer' | 'business';
  name: string;
}

export interface ChatThreadSummary {
  businessId: string;
  participantId: string;
  participantName: string;
  lastBody: string;
  lastAt: string;
  lastAuthorType: 'customer' | 'business';
  count: number;
}

export interface CustomerThreadSummary {
  businessId: string;
  businessName: string;
  lastBody: string;
  lastAt: string;
  lastAuthorType: 'customer' | 'business';
  count: number;
}

export interface NewUserInput {
  name: string;
  email?: string;
  isProfilePublic?: boolean;
}

export interface SignUpInput {
  name: string;
  phone: string;
  password?: string;
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

export interface NewOrderLineInput {
  kind: OfferingKind;
  name: string;
  price?: string;
  offerPrice?: string;
  quantity: number;
}

export interface NewOrderInput {
  businessId: string;
  customerId: string;
  customerName: string;
  lines: NewOrderLineInput[];
  fulfillment?: OrderFulfillment;
  tableNumber?: number;
  party?: PartyDetails;
  enrollees?: string[];
  note?: string;
}

import type { OrderFulfillment, Order } from './types';

export interface TableSeat {
  number: number;
  order: Order | null;
}

export interface NewBillInput {
  businessId: string;
  customerId?: string;
  customerName: string;
  lines: Array<Omit<BillLine, 'amount'>>;
  note?: string;
  issuedByName: string;
  orderId?: string;
}

export interface CustomerSummary {
  businessId: string;
  key: string;
  name: string;
  hasAccount: boolean;
  favorite: boolean;
  orderCount: number;
  bookingCount: number;
  billCount: number;
  callCount: number;
  chatCount: number;
  totalBilled: number;
  lastActivityAt: string;
}

export interface NewReviewInput {
  businessId: string;
  customerId: string;
  customerName: string;
  rating: number;
  comment?: string;
}

export interface ReviewEligibility {
  eligible: boolean;
  reason?: string;
}

export interface NewProductMessageInput {
  businessId: string;
  productId: string;
  authorId: string;
  authorName: string;
  text: string;
  offerPrice?: string;
  replyToId?: string;
}

export interface NewVehicleInput {
  businessId: string;
  name?: string;
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
  membershipId?: string;
  note?: string;
}

export interface LiveVehicle {
  vehicle: import('./types').Vehicle;
  driverName?: string;
  sharing: boolean;
  point?: GeoPoint;
  updatedAt?: string;
}

export interface BizThreadSummary {
  threadKey: string;
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
  authorName: string;
  body: string;
}

export interface NewMembershipInput {
  businessId: string;
  /**
   * The paying account. A user id when the payer has a Localo account; a
   * `walkin:<lowercased name>` key (the same key CustomerRepository uses) when
   * they don't — the business still tracks and bills them by name, the plan
   * just reaches no Subscriptions tab.
   *
   * ⚠️ Never validate this as a uuid. `uuidOrNull()` at the Prisma write turns
   * a non-uuid key into a NULL scoping column, which is exactly the intent.
   */
  customerId: string;
  customerName: string;
  /** Who actually uses the plan, when it isn't the payer (e.g. their child). */
  enrolleeName?: string;
  planName: string;
  pricePerMonth: number;
}

export interface EnrollRequestInput {
  businessId: string;
  customerId: string;
  customerName: string;
  requestedPlan?: string;
  requestedPrice?: number;
  enrolleeName?: string;
}

export interface AcceptEnrollInput {
  planName: string;
  pricePerMonth: number;
}

export interface ReportPaymentInput {
  membershipId: string;
  periodStart: string;
  method?: string;
  paidToName?: string;
  note?: string;
}

export interface NewLogEntryInput {
  businessId: string;
  title: string;
  details?: string;
  amount?: number;
  customerName?: string;
  recordedByName: string;
}

/** One offering (or tag) to record into the growing catalog collection. */
export interface CaptureEntryInput {
  kind: CatalogEntryKind;
  name: string;
}
