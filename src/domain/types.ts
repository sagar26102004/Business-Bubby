/**
 * Domain models — the single source of truth for every entity in the app.
 *
 * Browsing is organised around four top-level listing TYPES:
 *   - service : a service provider, e.g. "Arvind Transport Services"
 *   - shop    : an ongoing shop selling goods, e.g. a home baker or craft store
 *   - item    : an individual's personal stall — everything they're selling
 *               (a phone, a car, …) grouped as the products of ONE listing
 *   - rental  : something rented out, e.g. a flat, car, bike, or furniture
 * Each type has its own subcategories (see ./catalog.ts), so the taxonomy is a
 * single tier: Type → Subcategory. Everything is data-driven and extensible.
 */

import type { OpeningHours } from './hours';
export type { OpeningHours, DayHours } from './hours';

/** A geographic coordinate. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** The four top-level ways a listing is browsed. */
export type ListingType = 'service' | 'shop' | 'item' | 'rental';

/** Where a listing operates from, with privacy controls baked in. */
export type LocationKind = 'office' | 'home' | 'service_area';

export interface BusinessLocation {
  kind: LocationKind;
  /** Human label, e.g. "Main workshop". */
  label?: string;
  addressLine?: string;
  city?: string;
  region?: string;
  country?: string;
  point?: GeoPoint;
  /** True when the business is run from the owner's home. */
  isHome: boolean;
  /**
   * When true, never expose the exact address or coordinates to customers —
   * show only the city / general area.
   */
  hidePreciseLocation: boolean;
}

/**
 * A person with an app account. The same user can be a customer, an owner, and
 * an employee — roles are not mutually exclusive.
 */
/**
 * A person with a Localo account.
 *
 * STORED IN TWO HALVES (supabase/migrations/0007_profiles_private.sql), because
 * Localo is a public directory and row-level security cannot hide a field:
 *  - `profiles`         — the PUBLIC card: name, isProfilePublic, avatarUrl,
 *                         bio. World-readable, so owner names and employee
 *                         cards render for guests.
 *  - `profiles_private` — `email`, `phone`, `mutedNotifications`. Readable only
 *                         by the account itself and platform super-admins.
 * The repositories merge both into this one object, so `phone`/`email` are
 * simply ABSENT when you're not entitled to them — never assume they're set on
 * someone else's User.
 */
export interface User {
  id: string;
  name: string;
  /** Private (profiles_private) — absent unless it's you or a super-admin. */
  email?: string;
  /** Private (profiles_private) — absent unless it's you or a super-admin. */
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  /** When true this person is discoverable as an employee across the app. */
  isProfilePublic: boolean;
  /**
   * Platform super-admin: a privileged operator who can register businesses on
   * behalf of anyone and hand ownership to another user.
   *
   * DERIVED, session-only: the auth repository stamps it from the
   * `platform_admins` table (migration 0006), which no session can write to. It
   * is deliberately NOT persisted on the profile — that document is
   * user-writable, so a flag stored there could be forged. Absent/false for
   * ordinary users. See domain/superAdmin.ts.
   */
  isSuperAdmin?: boolean;
  /**
   * A throwaway anonymous identity (Supabase anonymous sign-in). Gives a guest a
   * real auth uid + JWT so identity-scoped actions like placing a voice call
   * work, while the app still treats them as a guest (`useAuth().isGuest` stays
   * true) — publishing a business or saving Home/Work still asks for real
   * sign-up. Absent/false for ordinary accounts.
   */
  isAnonymous?: boolean;
  /**
   * Alert families this person has silenced, as `"<businessId>:<category>"`
   * keys (or `"*:<category>"` to silence that family everywhere) — see
   * `domain/notifications.ts`. A muted alert never reaches the Alerts tab or
   * the unread badge; the underlying work is still there to look at in the
   * workspace (orders, call log, chats), which is the point: a busy cafe owner
   * silences order pings without losing a single order.
   */
  mutedNotifications?: string[];
}

/**
 * Where an employee sits in the business hierarchy. The business owner (the
 * user who registered it, `Business.ownerId`) sits above all of these.
 */
export type EmployeeLevel = 'manager' | 'staff';

/**
 * An employee attached to a business. May or may not have an app account:
 *  - `userId` set  → registered user; tapping opens their public profile.
 *  - `userId` unset → just a name the owner typed in.
 */
export interface Employee {
  id: string;
  businessId: string;
  displayName: string;
  /** Free-text job title, e.g. "Driver". */
  role?: string;
  /** Position in the hierarchy (below the owner). Defaults to staff. */
  level?: EmployeeLevel;
  userId?: string;
  /**
   * Customers only see the owner and managers on the business page. The owner
   * can feature individual staff too (set in Manage) — a featured member is
   * listed under their designation (`role`).
   */
  showOnPage?: boolean;
  /**
   * Which workspace services this employee may open (service ids from
   * `domain/access.ts`: 'orders', 'billing', 'logbook', …). Set by the owner on
   * the Access & permissions screen. When UNSET the default depends on rank: a
   * MANAGER keeps every tool (trusted until narrowed), a STAFF member gets
   * NOTHING until the owner grants tools (least privilege — a new driver opens
   * a blank workspace). The owner always has access to everything, regardless.
   */
  permissions?: string[];
}

/** An in-app notification for a user (or a guest session). */
export interface AppNotification {
  id: string;
  /** Who receives it: a user id, or 'guest'. */
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
    | 'payment_update'
    /** An ad campaign was approved, rejected or stopped. */
    | 'ad_update';
  /** Heading, e.g. "Maria from Sparks Electrical". */
  title: string;
  /** Preview text, e.g. the message body. */
  body: string;
  /** Business this relates to, for deep-linking to the chat. */
  businessId?: string;
  /** Order this relates to, for deep-linking to the order. */
  orderId?: string;
  /** Bill this relates to, for deep-linking to the bill. */
  billId?: string;
  /** Stall product this relates to, for deep-linking to its public thread. */
  productId?: string;
  /** Membership this relates to, for deep-linking to the member's detail. */
  membershipId?: string;
  read: boolean;
  createdAt: string;
}

/** A message in a customer ↔ business chat thread. */
export interface ChatMessage {
  id: string;
  threadKey: string;
  /** Who wrote it: the customer, or someone answering for the business. */
  authorType: 'customer' | 'business';
  authorName: string;
  body: string;
  /** When set, the message carries a bill — rendered as a tappable bill card. */
  billId?: string;
  createdAt: string;
}

/**
 * One piece of a business's work showcase — a wedding designer's decor photos,
 * a video editor's showreel, a carpenter's finished builds. Media is linked by
 * URL for now (photos render inline; videos open their link); real uploads
 * arrive with the real backend behind the same shape.
 */
export interface PortfolioItem {
  id: string;
  kind: 'photo' | 'video';
  /** Image URL for photos; the watch link (YouTube/Vimeo/…) for videos. */
  url: string;
  /** Preview image for videos. Photos preview with `url` itself. */
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  createdAt: string;
}

/**
 * LEGACY — a limited-time offer, from before businesses could author their own.
 *
 * Nothing in the app creates a Deal: there is no editor for it and no real
 * backend writes one, so it survives only in the mock seed. `Offer` (below) is
 * the real thing a business builds in Workspace › Offers, and the Home ad slot
 * now runs on offers and `AdCampaign`s. Deals are still rendered there so the
 * seeded demo data keeps looking right; don't build anything new on them.
 */
export interface Deal {
  id: string;
  /** Shout label on the card, e.g. "NEW COMBO", "40% OFF". */
  tag: string;
  /** What the deal is, e.g. "Flat white + banana bread". */
  title: string;
  description?: string;
  /** Deal price label, e.g. "$7". */
  price?: string;
  /** Original price label, shown struck through next to the deal price. */
  wasPrice?: string;
  /** Emoji on the card; falls back to the listing type's icon. */
  emoji?: string;
}

/** Where an offer line came from — which of the business's own lists. */
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
 * bundled at a special price ("Cold coffee + sandwich for ₹99"). The business
 * builds one in Workspace › Offers by picking from its menu/services/products/
 * rentals, and it shows on the business page directly under the description.
 *
 * Deliberately a superset of `Deal` (tag/title/price/wasPrice/emoji), so an
 * offer needs no reshaping to appear on the Home ad slot. Every live offer from
 * a nearby business shows there for free; paying for an `AdCampaign` is what
 * lifts one to the front of the queue and widens how far it reaches.
 */
export interface Offer {
  id: string;
  /** What the offer is, e.g. "Cold coffee + sandwich". */
  title: string;
  description?: string;
  /** Shout label on the card, e.g. "COMBO", "40% OFF". */
  tag?: string;
  /** Emoji on the card; falls back to the listing type's icon. */
  emoji?: string;
  /**
   * Photo behind the ad card. Optional — without one the card falls back to the
   * emoji on a colored gradient, which is what every offer looked like before.
   * Picked with PhotosField, which uploads it to the `media` bucket and stores
   * the public URL (lib/upload.ts).
   */
  imageUrl?: string;
  /**
   * THE REEL — a short vertical video ad the business filmed itself, the way it
   * would post one on Instagram. Optional, and deliberately just another field
   * on `Offer` rather than a type of its own: a reel is the same promotion with
   * better creative, so it inherits everything offers already have (liveness,
   * free reach, campaigns) and needs no second pricing model.
   *
   * Where it plays: full-screen in the /deals feed, autoplaying while its page
   * is the one on screen. Everywhere a still is wanted — the Home carousel, the
   * business page — `imageUrl` is used instead, so a reel should carry one as
   * its poster frame.
   */
  videoUrl?: string;
  /** What's included — picked from the business's own offerings. */
  lines: OfferLine[];
  /** What the customer pays for the bundle, e.g. "₹99". */
  price?: string;
  /** Normal total of `lines`, shown struck through. Recomputed on save. */
  wasPrice?: string;
  /** Off = kept in the workspace but hidden from customers. */
  active: boolean;
  /** ISO date the offer stops showing. Undefined = runs until switched off. */
  endsAt?: string;
  createdAt: string;
}

/**
 * Where a campaign is in its life.
 *
 *   pending  — requested and waiting on a platform admin. Not showing.
 *   active   — approved and paid for; showing until `endsAt` passes.
 *   rejected — an admin turned it down; `reviewNote` says why.
 *   stopped  — pulled early, by the business or by an admin.
 *
 * There is deliberately no 'expired' status: a run ending is a fact about the
 * clock, not a decision anyone made, so it's derived from `endsAt` (see
 * `isCampaignRunning` in domain/ads.ts) rather than written by a sweep job that
 * would need something to be awake to run it.
 */
export type AdCampaignStatus = 'pending' | 'active' | 'rejected' | 'stopped';

/**
 * An AD CAMPAIGN — a business paying to put one of its offers in front of the
 * neighborhood. This is the platform's revenue line.
 *
 * It carries no creative of its own: it points at an `Offer` the business
 * already built, and the ad card is rendered from that offer live. So editing
 * the offer updates the running ad, and there's no second copy to drift.
 *
 * What money buys is REACH and PRIORITY. Every live offer already shows on the
 * Home ad slot to people close by; a campaign widens the radius to the plan's
 * `radiusKm` and sorts the offer ahead of the unpaid ones, marked "Sponsored".
 *
 * Nothing here charges a card — the app has no payment gateway (CLAUDE.md). A
 * request lands as `pending`, a platform admin approves it once payment is
 * settled off-app, and `paid` records that by hand, the same way bills and
 * memberships already work.
 */
export interface AdCampaign {
  id: string;
  businessId: string;
  /** Copied at request time so the admin queue reads without joining. */
  businessName: string;
  /** The `Offer.id` being promoted — the creative lives there. */
  offerId: string;
  /** Which `AD_PLANS` entry was bought (domain/ads.ts). */
  planId: string;
  /** How far the ad reaches, in km. Frozen from the plan at request time. */
  radiusKm: number;
  /** How long the run lasts once approved. Frozen from the plan. */
  days: number;
  /** Rupees owed for the run. Frozen from the plan, so a later price change
   *  never rewrites what a business was quoted. */
  amount: number;
  status: AdCampaignStatus;
  /** Set by hand once money has actually arrived, off-app. */
  paid: boolean;
  requestedAt: string;
  requestedById: string;
  requestedByName: string;
  /** Set on approval — the clock starts when the admin says yes, not when the
   *  business asked, so a slow review never eats into the run. */
  startsAt?: string;
  endsAt?: string;
  reviewedAt?: string;
  /** Why it was rejected, or a note on an approval. Shown to the business. */
  reviewNote?: string;
  /** Times the card has been shown, and tapped. What the business bought. */
  impressions: number;
  taps: number;
}

/** A single line on a shop's menu (cafe/restaurant/bakery, etc.). */
export interface MenuItem {
  name: string;
  price?: string;
  description?: string;
  /**
   * Menu section, e.g. "Starters" or "Main Course". Uncategorised items list
   * first. Food businesses pick these from FOOD_MENU_SECTIONS rather than
   * typing them, so every restaurant's menu reads the same way.
   */
  category?: string;
  /** Optional group inside the category, e.g. "Veg" / "Non-veg". */
  subcategory?: string;
  /** Dish photo shown beside the item on the menu screen. */
  imageUrl?: string;
  /** Veg (green dot) / non-veg (red dot). Undefined = no dot shown. */
  isVeg?: boolean;
}

/** A service a provider offers, with its price. Same shape as a menu item. */
export interface ServiceItem {
  name: string;
  price?: string;
  description?: string;
  /**
   * Section the service groups under on the business page, e.g. "Repairs" or
   * "Installation". Uncategorised services list first (same model as MenuItem).
   */
  category?: string;
  /** Optional group inside the category, e.g. "AC" / "Fridge". */
  subcategory?: string;
}

/**
 * A party/event package a dine-in business offers (birthdays, kitty parties,
 * family functions…). Price is a free-text label — "₹499 / person" or
 * "₹35,000 flat"; guest limits and inclusions go in the description.
 */
export interface PartyPackage {
  name: string;
  price?: string;
  description?: string;
}

/** Details of a party/event request, riding on an `Order` (`Order.party`). */
export interface PartyDetails {
  /** Expected head count. */
  guests: number;
  /** Free-text date & time, like `Booking.when` — e.g. "Sat 24 Aug, 7 pm". */
  when: string;
  /** What's being celebrated, e.g. "Birthday", "Office get-together". */
  occasion?: string;
}

/** A product a business sells (e.g. a tyre model, a hardware part). */
export interface ProductItem {
  /**
   * Stable id, assigned by the repository when the product is saved. Products
   * live inside their business, but the product PAGE and its public question
   * thread need to point at one thing that survives reordering and edits.
   */
  id?: string;
  name: string;
  price?: string;
  description?: string;
  /** Photos, first one is the cover. The Stalls grid and product page lead with these. */
  images?: string[];
  /** Set by the seller once it's gone — the listing stays up, marked SOLD. */
  sold?: boolean;
  /**
   * The product's own stall subcategory (vehicles, electronics, …). Set on
   * personal-stall items — one stall can hold a phone AND a car — so browse
   * filters match on what's inside the stall, not on the stall itself.
   */
  subcategoryId?: string;
}

/**
 * One message on a stall product's PUBLIC thread — the marketplace equivalent
 * of a noticeboard under the item, not a private chat.
 *
 * Anyone signed in can ask a question or propose a price; everyone else can
 * read it, so the next buyer with the same question ("does it have a bill?")
 * finds it already answered, and can see what the item has been offered. The
 * seller answers each message; `replyToId` hangs an answer under the message
 * it answers, so several conversations run side by side under one item.
 */
export interface ProductMessage {
  id: string;
  /** The stall the product belongs to. */
  businessId: string;
  /** `ProductItem.id`. */
  productId: string;
  authorId: string;
  authorName: string;
  /** True when the author is the stall's owner — rendered as the seller. */
  fromSeller: boolean;
  text: string;
  /**
   * A price the author is proposing, e.g. "₹25,000". Present = this message is
   * an OFFER, not just a question, and renders as one.
   */
  offerPrice?: string;
  /** The message this answers. Top-level questions/offers leave it unset. */
  replyToId?: string;
  /**
   * The owner has pinned this message to the top of the thread — a way to keep
   * the important question/answer (or the best offer) where every shopper sees
   * it first. Owner-only; set from the stall admin or the item page.
   */
  pinned?: boolean;
  createdAt: string;
}

/**
 * Something a business rents out — a flat, a car, a costume. Each carries its
 * own rental subcategory (flats, cars, bikes…) so one lister can rent a bike
 * AND a projector; the price is per the business's `rentalBasis`.
 */
export interface RentalItem {
  name: string;
  price?: string;
  description?: string;
  /** Rental subcategory id from the catalog (flats, cars, bikes, …). */
  subcategoryId?: string;
  /**
   * Section it groups under on the business page, e.g. "Cars" — picked from
   * RENTAL_SECTIONS (domain/offeringSections.ts), which is finer than the
   * browse catalog above. Items listed before the library only carry
   * `subcategoryId`; `rentalCategory()` falls back to it.
   */
  category?: string;
  /** Group inside the section, e.g. "SUV". */
  subcategory?: string;
}

/** What a line on an order or bill refers to. */
export type OfferingKind = 'product' | 'service';

/**
 * One line of an order — a product or service with a quantity. `included` is
 * how a proposal works: the business unticks the lines it can't provide and
 * sends the rest back; the customer sees exactly what's in and what's out.
 *
 * Bargaining (personal stalls): the customer may attach an `offerPrice` to a
 * line; the seller either accepts the order at that price or counters with a
 * `counterPrice` (which rides back on the proposal). The agreed unit price is
 * always counterPrice ?? offerPrice ?? price.
 */
export interface OrderLine {
  id: string;
  kind: OfferingKind;
  name: string;
  /** Unit price label as listed by the business, e.g. "$45". */
  price?: string;
  /** Customer's bargained price label on a stall order, e.g. "$300". */
  offerPrice?: string;
  /** Seller's counter to the offer, set when the proposal goes back. */
  counterPrice?: string;
  quantity: number;
  included: boolean;
}

/** How a food order is handed over — asked when ordering from a cafe/restaurant. */
export type OrderFulfillment = 'dine_in' | 'takeaway';

/**
 * Lifecycle of an order:
 *  - requested : customer sent it; the business hasn't responded yet.
 *  - proposed  : the business can provide only SOME lines and sent a proposal
 *                back (an interactive order, not a document) for the customer
 *                to accept or decline.
 *  - accepted  : every included line is confirmed. Non-dine-in orders are
 *                billed automatically (`billId`) and final. DINE-IN orders
 *                stay OPEN as a running tab: the customer keeps adding items
 *                (each round returns the order to `requested` for the
 *                business to confirm) until the business moves it to billing,
 *                which issues the bill and closes it.
 *  - rejected  : the business turned the whole order down (with a message).
 *  - declined  : the customer turned the business's proposal down.
 */
export type OrderStatus = 'requested' | 'proposed' | 'accepted' | 'rejected' | 'declined';

/**
 * A customer's order with a business: products to buy and/or services to
 * avail, picked from the business's own catalog. Every order a customer ever
 * placed with a business stays in their shared history, whatever the outcome.
 */
export interface Order {
  id: string;
  businessId: string;
  /** Customer identity: a user id, or 'guest'. */
  customerId: string;
  customerName: string;
  lines: OrderLine[];
  /** Dine-in or takeaway, on orders from businesses that seat customers. */
  fulfillment?: OrderFulfillment;
  /**
   * The table this dine-in order is seated at (1-based). Auto-assigned to the
   * lowest free table when the order is placed at a business that runs tables
   * (`Business.tableCount`), reused when the same customer already has an open
   * tab, or picked by a member taking the order. Absent for takeaway.
   */
  tableNumber?: number;
  /**
   * Set when this order is a party/event request: the chosen package rides as
   * the order line (negotiable via offer/counter prices like any line), and
   * these are the event details.
   */
  party?: PartyDetails;
  /**
   * Who the plan is for — on enroll/subscribe requests (a gym, a tuition
   * class). One person books for several: themselves and/or their children, so
   * this holds each enrollee's name. Empty/absent for ordinary orders.
   */
  enrollees?: string[];
  note?: string;
  status: OrderStatus;
  /** Business's message: the rejection reason, or a note on a proposal. */
  responseMessage?: string;
  /** Who at the business responded (owner or employee name). */
  respondedByName?: string;
  /**
   * The issued bill: automatic on acceptance for non-dine-in orders, or when
   * the business moves an open dine-in tab to billing. A set billId is what
   * closes an order.
   */
  billId?: string;
  /**
   * QR handover (see features/fulfillment): when a staff member scanned the
   * order's QR to hand it over to the customer — the last step of the
   * place → pay → collect flow. Payment itself lives on the bill.
   */
  deliveredAt?: string;
  deliveredByName?: string;
  createdAt: string;
  respondedAt?: string;
}

/** One line on a bill. `amount` is the parsed line total when computable. */
export interface BillLine {
  name: string;
  quantity: number;
  /** Unit price label, e.g. "$45". */
  price?: string;
  /** Parsed numeric line total (unit × quantity), when the price parses. */
  amount?: number;
}

/**
 * A bill a business issues to a customer — auto-generated when an order is
 * accepted, or written by hand from the workspace. Shareable into the app
 * chat and through any external app via the system share sheet.
 */
export interface Bill {
  id: string;
  businessId: string;
  businessName: string;
  /** Customer's user id when known — lets the bill reach their chat/alerts. */
  customerId?: string;
  customerName: string;
  lines: BillLine[];
  /** Sum of the parseable line amounts. */
  total: number;
  note?: string;
  /** Who at the business issued it. */
  issuedByName: string;
  /** Set when the bill came from an accepted order. */
  orderId?: string;
  /**
   * Whether the customer has paid. Money changes hands in the real world (cash,
   * UPI, card) — the BUSINESS is the only side that can say it arrived, so only
   * a member can flip this. The customer sees it on their order history.
   */
  paymentStatus: PaymentStatus;
  /** Who at the business marked it paid, and when. */
  paidByName?: string;
  paidAt?: string;
  createdAt: string;
}

/** Has the customer paid the bill? Set by the business, never the customer. */
export type PaymentStatus = 'pending' | 'paid';

/** Where a logbook entry came from. */
export type LogSource = 'order' | 'manual';

/**
 * One line in a business's logbook — its record book of everything that
 * happened. Every order placed through the app appears here automatically
 * (`source: 'order'`, derived live from the order so nothing is ever missed);
 * members with logbook access also jot down `manual` records (a phone order, a
 * cash sale, a walk-in) that never went through the app. Append-only by design
 * — a logbook you can silently edit isn't a record book.
 */
export interface LogEntry {
  id: string;
  businessId: string;
  source: LogSource;
  /** Set on auto entries — the order this records, for deep-linking. */
  orderId?: string;
  /** Headline, e.g. "Order from Sagar" or a manual record's title. */
  title: string;
  /** Free-text details — items, notes, how it was taken. */
  details?: string;
  /** Amount involved, when known (parsed from the order total or typed in). */
  amount?: number;
  /** The other party's name, e.g. the customer. */
  customerName?: string;
  /** Who recorded it — a member's name, or 'App' for auto order entries. */
  recordedByName: string;
  createdAt: string;
}

/**
 * A customer's rating of a business. Only verified customers can leave one —
 * someone with an accepted order, an accepted/completed booking, or a bill
 * from the business — so ratings can't be faked by strangers. One review per
 * customer per business (resubmitting edits it). Low ratings (1–2 stars)
 * must carry a written reason.
 */
export interface Review {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  /** 1–5 stars. */
  rating: number;
  /** The written experience — required when rating is 1 or 2. */
  comment?: string;
  createdAt: string;
  /** Set when the customer edited their review. */
  updatedAt?: string;
}

/**
 * A crowd-sourced catalog entry — how the app's own collection of dishes,
 * services, products and business tags GROWS at runtime instead of only in
 * code. When an owner lists an offering the code catalog doesn't know
 * (domain/dishes.ts, domain/tags.ts), it's captured here so the next owner
 * gets it as a ready suggestion; a super-admin also adds business tags by hand
 * from the admin screen. Kept live-immediately (admin can hide bad ones), so
 * `approved` is the moderation flag rather than a review gate.
 */
export type CatalogEntryKind = 'tag' | 'dish' | 'service' | 'product';

export interface CatalogEntry {
  id: string;
  kind: CatalogEntryKind;
  /** The offering/tag name, in the casing it was first seen. */
  name: string;
  /** Lowercase, whitespace-collapsed dedup key (one row per kind+key). */
  key: string;
  /** Live in suggestions when true; a super-admin sets false to hide it. */
  approved: boolean;
  /** True when a super-admin typed it in (vs auto-captured from a listing). */
  adminAdded?: boolean;
  /** How many listings have contributed this — a popularity signal. */
  count: number;
  /** The user whose listing first contributed it (unset for admin-added). */
  addedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Lifecycle of a booking/appointment request. */
export type BookingStatus = 'requested' | 'accepted' | 'declined' | 'completed';

/** A customer's appointment request for a business's service. */
export interface Booking {
  id: string;
  businessId: string;
  /** Customer identity: a user id, or 'guest'. */
  customerId: string;
  customerName: string;
  serviceName: string;
  price?: string;
  /** Requested date/time — free text for now (e.g. "Sat 12 Jul, 3pm"). */
  when: string;
  note?: string;
  status: BookingStatus;
  createdAt: string;
}

/**
 * A listing. Generic on purpose — the same shape represents a plumbing service,
 * a craft shop, a phone for sale, or a flat for rent. `type` decides how it's
 * browsed and presented.
 */
export interface Business {
  id: string;
  ownerId: string;
  name: string;
  tagline?: string;
  description?: string;
  type: ListingType;
  /**
   * Narrower grouping within the type, e.g. "cafe" under "shop". Personal
   * stalls (type 'item') leave it unset — their products each carry their own
   * subcategory instead.
   */
  subcategoryId?: string;
  coverImageUrl?: string;
  location: BusinessLocation;
  phone?: string;
  email?: string;
  website?: string;
  employeeIds: string[];
  /**
   * Call routing: employee ids allowed to attend incoming voice calls. Only
   * employees with an app account (`userId` set) can actually ring.
   */
  callHandlerIds?: string[];
  /**
   * Whether the owner personally rings on incoming voice calls. Defaults to
   * true; the owner can exclude themselves and route calls to the team only.
   */
  ownerHandlesCalls?: boolean;
  /**
   * Chat routing: employee ids that customer chats are forwarded to. The owner
   * always receives chats, so an empty list means "owner only".
   */
  chatRecipientIds?: string[];
  /**
   * QR handover: employee ids the owner allows to scan order QR codes and mark
   * orders paid/collected (see features/fulfillment). The owner can always
   * scan; an empty list means "owner only".
   */
  scanHandlerIds?: string[];
  /**
   * Customer keys the owner starred as favourites. A key is the customer's
   * user id, 'guest', or `walkin:<name>` for bill-only customers without an
   * account (see CustomerRepository).
   */
  favoriteCustomerIds?: string[];
  /**
   * Workspace modules this business opted into (module ids from
   * `domain/modules.ts`, picked at registration, toggled in Manage). Unset =
   * created before the opt-in step → every available module stays on.
   * Chat/calls/notifications/reviews are universal, never listed here.
   */
  modules?: string[];
  /**
   * How many tables a dine-in business seats — set in Manage. When present,
   * dine-in orders are seated at a numbered table (auto-assigned to the lowest
   * free one, reused for a customer's open tab, or picked by a member).
   */
  tableCount?: number;
  /** Menu lines, mainly for cafes/restaurants/bakeries. */
  menu?: MenuItem[];
  /** Party/event packages a dine-in business hosts — shown on its page. */
  partyPackages?: PartyPackage[];
  /** Live limited-time offers, shown on the Browse deals carousel. */
  deals?: Deal[];
  /**
   * The business's own promotions — bundles of what it already sells at a
   * special price. Built in Workspace › Offers, shown on the business page
   * right under the description.
   */
  offers?: Offer[];
  /** Work showcase — photos & videos of past work, shown on the listing. */
  portfolio?: PortfolioItem[];
  /** Services offered with prices, for service providers. */
  services?: ServiceItem[];
  /**
   * Products for sale, for businesses that stock goods (a tyre showroom's
   * tyre range, a hardware shop's stock). A business can have products only,
   * services only, or both — customers order from whatever is listed.
   */
  products?: ProductItem[];
  ratingAvg?: number;
  ratingCount?: number;
  /** Free-form price label, e.g. "$50/hr", "$1,200", "$15/day". */
  priceLabel?: string;
  /** Coarse price indicator shown as $ / $$ / $$$ on cards. */
  priceLevel?: 1 | 2 | 3;
  /** Short profession/type shown under the name, e.g. "Plumber". */
  providerType?: string;
  /** Highlight chips, e.g. ["Emergency", "Residential"]. */
  tags?: string[];
  /** Simple open/closed status. A full hours model can replace this later. */
  openNow?: boolean;
  /**
   * Free-text opening hours label shown beside the open/closed status, e.g.
   * "9 AM – 6 PM" or "9–5". Kept as a display fallback; when `openingHours` is
   * set this is derived from it (a compact summary) so old readers still work.
   */
  hours?: string;
  /**
   * Structured opening hours (per-day open/close) — the source of truth for the
   * Open/Closed status and the timings shown on the business page. See
   * domain/hours.ts for the model and helpers (`openState`, `isOpenNow`, …).
   */
  openingHours?: OpeningHours;
  /**
   * Whether rentals are offered per day, per month, or both — asked at
   * listing time so the owner never has to re-list to switch.
   */
  rentalBasis?: RentalBasis;
  /** What's available to rent — a flat, a car, a costume — each with a price. */
  rentals?: RentalItem[];
  /**
   * Rentals only: is it currently taken? The owner flips this in Manage when
   * a tenant moves in/out instead of deleting and re-listing.
   */
  rentalStatus?: RentalStatus;
  /** Distance from the user in km. Computed per query. */
  distanceKm?: number;
  /** ISO timestamp. */
  createdAt: string;
}

/** How a rental is offered: per day, per month, or either. */
export type RentalBasis = 'daily' | 'monthly' | 'both';

/** Whether a rental is currently taken. */
export type RentalStatus = 'available' | 'rented';

/** A narrower grouping within a listing type, e.g. Rentals → Cars / Bikes. */
export interface Subcategory {
  id: string;
  name: string;
  icon?: string;
}

/**
 * Definition of a top-level listing type. Lives as data in ./catalog.ts so new
 * subcategories (or types) can be added without code changes.
 */
export interface ListingTypeDef {
  id: ListingType;
  /** Plural label for browsing, e.g. "Rentals". */
  label: string;
  /** Singular label for forms, e.g. "Rental". */
  singular: string;
  icon: string;
  color: string;
  /** Verb on the primary action, e.g. "Enquire", "Contact seller". */
  actionLabel: string;
  subcategories: Subcategory[];
}

/** Lifecycle of an internet voice call to a business. */
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';

/** Where one person stands within a call. */
export type CallParticipantState = 'ringing' | 'joined' | 'left' | 'declined';

export interface CallParticipant {
  /** User id, or 'guest' for a guest customer. Unique within the call. */
  id: string;
  name: string;
  side: 'customer' | 'business';
  /** Business-side label shown in the call UI, e.g. "Owner" or a job title. */
  roleLabel?: string;
  state: CallParticipantState;
  joinedAt?: string;
  leftAt?: string;
}

/**
 * An internet voice call from a customer to a business (WhatsApp-style — no
 * phone numbers exchanged). Every eligible handler rings at once; whoever
 * answers joins, and the others can still join (group call) or stay out.
 * Everyone always sees who is on the call.
 */
export interface Call {
  id: string;
  businessId: string;
  businessName: string;
  /** Who placed the call: a user id, or 'guest'. */
  customerId: string;
  customerName: string;
  status: CallStatus;
  participants: CallParticipant[];
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
}

/** Kind of vehicle a business operates. Drives the map icon. */
export type VehicleKind = 'bus' | 'van' | 'truck' | 'car' | 'bike' | 'other';

/**
 * A vehicle (or any moving unit) a business runs — a school bus, a delivery
 * van, a goods truck. Its live position IS the assigned driver's shared
 * location: track the driver and you track the vehicle and everything aboard.
 */
export interface Vehicle {
  id: string;
  businessId: string;
  /** Display name — the owner's pet name, or the registration number. */
  name: string;
  /** Number plate, e.g. "MP09 AB 1234". */
  registrationNumber?: string;
  kind: VehicleKind;
  /**
   * The employee behind the wheel. Only drivers with an app account
   * (`Employee.userId` set) can actually share a live location.
   */
  driverEmployeeId?: string;
  /** Saved routes for this vehicle (morning run, way back home, …). */
  journeys?: VehicleJourney[];
  /** Which saved journey the vehicle is currently running, if any. */
  activeJourneyId?: string;
  createdAt: string;
}

/**
 * One point on a vehicle's route — the start, the end, or a stop in between.
 * The place can be typed by name, pinned on the map, or both; `point` is set
 * only when the owner dropped a pin (so the route can be drawn on a real map).
 */
export interface JourneyStop {
  id: string;
  /** Free-text place name, e.g. "Vijay Nagar Square". */
  label: string;
  /** Pinned coordinate, when the owner placed one on the map. */
  point?: GeoPoint;
}

/**
 * A saved route a vehicle runs: a start, an end, and any stops between them.
 * A vehicle can hold several (the morning school run, the way back home, an
 * evening batch); the owner picks which one is active. A return trip is just
 * another journey with start/end swapped and the stops reversed.
 */
export interface VehicleJourney {
  id: string;
  /** What the owner calls it, e.g. "Morning route" or "Way back home". */
  name: string;
  start: JourneyStop;
  end: JourneyStop;
  /** Ordered stops between start and end. */
  stops: JourneyStop[];
  createdAt: string;
}

/** What a customer tracks: a child on the school run, or goods in transit. */
export type TrackedItemKind = 'child' | 'goods';

/**
 * Something a customer entrusted to the business that rides on a vehicle — a
 * child on the school run, or a consignment being delivered. The owner assigns
 * it to a vehicle; the customer then sees that vehicle live on the map. One
 * customer can have many (a parent with several children, multiple parcels).
 */
export interface TrackedItem {
  id: string;
  businessId: string;
  kind: TrackedItemKind;
  /** Display label, e.g. "Aarav — Grade 3" or "Parcel #4021". */
  label: string;
  /** The customer who may track this (a user id). */
  customerId: string;
  customerName: string;
  /** Vehicle it currently rides on. Unset = not assigned yet. */
  vehicleId?: string;
  /**
   * The membership (enrolment) this tracked child came from, when it was
   * assigned to a bus straight from the workspace Members list. Lets an
   * assignment be found and re-pointed without duplicating the child.
   */
  membershipId?: string;
  note?: string;
  createdAt: string;
}

/**
 * An employee's live-location share with ONE business. Sharing is explicit and
 * per business: the employee turns it on from the workspace at the start of a
 * shift and off at the end — the business never sees them off the clock.
 */
export interface LocationShare {
  businessId: string;
  /** The sharing employee's user id. */
  userId: string;
  active: boolean;
  point: GeoPoint;
  /** Direction of travel in degrees from north. */
  heading: number;
  updatedAt: string;
}

/**
 * Business-to-business chat message (a dealer talking to a distributor, a
 * cafe borrowing stock from a restaurant). One thread per PAIR of businesses
 * (`threadKey` = both ids sorted and joined with '|') — a separate world from
 * customer chat, which is per customer per business.
 */
export interface BizChatMessage {
  id: string;
  threadKey: string;
  fromBusinessId: string;
  fromBusinessName: string;
  /** The team member who typed it — replies read "Rohan · Cafe Neighborhood". */
  authorName: string;
  body: string;
  at: string;
}

/**
 * A recurring plan between a business and one of its customers — a gym
 * membership, a yoga batch, monthly tuition, a school-bus seat. Two ways one
 * begins: the business enrolls a customer directly (workspace → Members), or
 * the customer taps Enroll/Subscribe on the business page, creating a
 * `pending` request the business accepts (setting the plan + price) or rejects
 * in the Members section. An `active` plan shows in the customer's
 * Subscriptions tab and renews monthly from `startedAt`; `renewedAt` /
 * `expiresAt` describe the current billing cycle.
 */
export interface Membership {
  id: string;
  businessId: string;
  businessName: string;
  customerId: string;
  customerName: string;
  /** What they're enrolled in, e.g. "Gym membership — monthly", "Morning yoga batch". */
  planName: string;
  /** ₹ per month. Zero while a customer request is still `pending`. */
  pricePerMonth: number;
  /** The customer's own words on a self-service request, shown to the business while pending. */
  requestedPlan?: string;
  /** The listed plan's price the customer picked, so the business can accept in one tap. */
  requestedPrice?: number;
  /** Who the plan is FOR when it isn't the account holder — e.g. a child's name. */
  enrolleeName?: string;
  /**
   * A detached member with no linked account: the business still tracks them by
   * name, but nobody is billed and the plan shows in no one's Subscriptions.
   * `customerId` holds a `standalone:…` sentinel (no real user) when set.
   */
  standalone?: boolean;
  startedAt: string;
  /** Start of the current billing cycle (monthly anniversary of startedAt). */
  renewedAt: string;
  /** When the current cycle ends and renews again. */
  expiresAt: string;
  /** `pending` = a customer request awaiting the business; `rejected` = the business declined it. */
  status: 'pending' | 'active' | 'cancelled' | 'rejected';
  /** Set when cancelled — the plan stops counting from this date. */
  endedAt?: string;
  /**
   * Current billing-cycle payment state, attached on read (active plans only)
   * so the members list and Subscriptions tab can show paid / overdue at a
   * glance without a second fetch.
   */
  payment?: MembershipPaymentSummary;
}

/** A membership's payment standing for its current cycle, computed on read. */
export interface MembershipPaymentSummary {
  /**
   * `paid` = this cycle is confirmed; `pending` = the customer reported paying
   * and the business hasn't approved yet; `unpaid` = nothing for this cycle.
   */
  status: 'paid' | 'pending' | 'unpaid';
  /** Start of the cycle this status describes (monthly anniversary of start). */
  periodStart: string;
  /** Days since the cycle began while still unpaid (0 when paid or pending). */
  daysOverdue: number;
  /** How many cycles have been confirmed paid, all-time. */
  monthsPaid: number;
  /** Sum of confirmed payments, all-time. */
  totalPaid: number;
  /** The pending payment's id when `status === 'pending'`, for one-tap approval. */
  pendingPaymentId?: string;
}

/**
 * One payment logged against a single billing cycle of a membership. The
 * customer can self-report it (→ `pending`, awaiting the business) or a member
 * can record it directly at the counter (→ `approved`). A cycle counts as paid
 * once an approved payment covers it.
 */
export interface MembershipPayment {
  id: string;
  membershipId: string;
  businessId: string;
  /** The account billed for the plan (the parent, for a child's enrolment). */
  customerId: string;
  /** The billing cycle this covers — ISO of the cycle's start. */
  periodStart: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  /** How they say they paid: 'cash' | 'online' | 'other'. */
  method?: string;
  /** Who they handed cash to, when paid in person. */
  paidToName?: string;
  /** Free-text note from whoever logged it (e.g. "paid cash on the 5th"). */
  note?: string;
  /** `customer` self-report vs `business` recorded it directly. */
  reportedBy: 'customer' | 'business';
  reportedByName: string;
  reportedAt: string;
  decidedByName?: string;
  decidedAt?: string;
}

/** One line of a month's subscription spend. */
export interface MonthlySpendLine {
  businessName: string;
  planName: string;
  amount: number;
}

/** One month of subscription spend, for the breakdown popup. */
export interface MonthlySpend {
  /** First day of the month, ISO. */
  month: string;
  total: number;
  lines: MonthlySpendLine[];
}

/** A place the user browses around. `current` is the device location. */
export type PlaceKind = 'current' | 'home' | 'work' | 'custom';

export interface SavedPlace {
  id: string;
  label: string;
  kind: PlaceKind;
  point: GeoPoint;
  address?: string;
}
