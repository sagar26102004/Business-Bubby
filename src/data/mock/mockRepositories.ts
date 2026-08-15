/**
 * In-memory implementations of the repository interfaces.
 *
 * State lives in module-level arrays for the lifetime of the app session.
 * Every method is async and returns cloned data so callers can't mutate the
 * store directly — this mirrors how a networked backend would behave and keeps
 * the swap to a real API friction-free.
 */
import type {
  AdCampaign,
  AppNotification,
  Bill,
  BillLine,
  BizChatMessage,
  Booking,
  BookingStatus,
  Business,
  Call,
  CallParticipant,
  CatalogEntry,
  CatalogEntryKind,
  ChatMessage,
  Employee,
  GeoPoint,
  LocationShare,
  LogEntry,
  Membership,
  MembershipPayment,
  MonthlySpend,
  Order,
  PaymentStatus,
  ProductItem,
  ProductMessage,
  Review,
  SavedPlace,
  TrackedItem,
  User,
  Vehicle,
} from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import { campaignGoal, campaignPlanSummary, getAdPlan, isCampaignRunning, viewBandKey } from '@/domain/ads';
import { isOfferLive } from '@/domain/offers';
import { buildPlacements } from '@/data/adPlacements';
import { applyCatalogEntries, catalogKey, isCodeCatalogName } from '@/domain/catalogEntries';
import { normalizeRole } from '@/domain/roles';
import { isNotificationMuted } from '@/domain/notifications';
import { isSuperAdminPhone } from '@/domain/superAdmin';
import type {
  AdPlacement,
  PlacementOptions,
  AccountDeletionBlocker,
  AdRepository,
  AuthRepository,
  BillRepository,
  BizChatRepository,
  BizThreadSummary,
  BookingRepository,
  BusinessQuery,
  BusinessRepository,
  CallRepository,
  CaptureEntryInput,
  CatalogRepository,
  NewAdCampaignInput,
  ChatAuthor,
  ChatRepository,
  ChatThreadSummary,
  CustomerRepository,
  CustomerSummary,
  DeleteAccountResult,
  AcceptEnrollInput,
  CustomerThreadSummary,
  EmployeeRepository,
  EnrollRequestInput,
  LiveVehicle,
  LogbookRepository,
  PushRepository,
  MembershipRepository,
  NewBillInput,
  NewLogEntryInput,
  NewBizMessageInput,
  NewBookingInput,
  NewBusinessInput,
  NewEmployeeInput,
  NewMembershipInput,
  ReportPaymentInput,
  NewOrderInput,
  NewOrderLineInput,
  NewProductMessageInput,
  NewReviewInput,
  NewSavedPlaceInput,
  NewTrackedItemInput,
  NewUserInput,
  NewVehicleInput,
  NotificationRepository,
  OrderRepository,
  PlacesRepository,
  ProductThreadRepository,
  Repositories,
  ReviewEligibility,
  ReviewRepository,
  SignUpInput,
  TableSeat,
  TrackingRepository,
  UserRepository,
} from '@/data/repositories';
// Values, not types: the identity/password rules are shared with the real
// backends so the mock refuses exactly what Supabase refuses.
import { assertContactDetails, assertPassword, assertUsername } from '@/data/repositories';
import { haversineKm } from '@/lib/geo';
import { getDeviceLocation } from '@/lib/location';
import { formatMoney, parsePrice } from '@/lib/money';
import {
  CURRENT_POINT,
  seedBizChat,
  seedBusinesses,
  seedEmployees,
  seedLocationShares,
  seedLogEntries,
  seedMemberships,
  seedPlaces,
  seedProductMessages,
  seedReviews,
  seedTrackedItems,
  seedUsers,
  seedVehicles,
} from './seed';

/**
 * TESTING SWITCH — start the app EMPTY.
 *
 * `false` (current) loads NO demo content: no businesses, employees, orders,
 * stalls, reviews, memberships, logbook entries, vehicles, tracking, or B2B
 * chat. Handy for testing flows from a clean slate. The demo USER accounts and
 * saved LOCATIONS are always kept — otherwise sign-in and the location picker
 * would break.
 *
 * Nothing is deleted: all the seed data still lives in `./seed.ts`. Flip this
 * back to `true` (or just ask) to load the full Indore demo set again.
 */
const SEED_CONTENT = false;

/** Clone-seed an array only when SEED_CONTENT is on; otherwise start empty. */
const seed = <T>(rows: T[]): T[] => (SEED_CONTENT ? rows.map((r) => ({ ...r })) : []);

// Mutable session state. Users + places always load (sign-in + location need
// them); all other content is gated behind SEED_CONTENT above.
const users: User[] = seedUsers.map((u) => ({ ...u }));
const places: SavedPlace[] = seedPlaces.map((p) => ({ ...p }));
const memberships: Membership[] = seed(seedMemberships);
// Payments logged against membership cycles — always starts empty (no seed).
const membershipPayments: MembershipPayment[] = [];
const bizMessages: BizChatMessage[] = seed(seedBizChat);
const employees: Employee[] = seed(seedEmployees);
const businesses: Business[] = seed(seedBusinesses);
const messages: ChatMessage[] = [];
const notifications: AppNotification[] = [];
const bookings: Booking[] = [];
const orders: Order[] = [];
const bills: Bill[] = [];
const calls: Call[] = [];
const reviews: Review[] = seed(seedReviews);
const productMessages: ProductMessage[] = seed(seedProductMessages);
const vehicles: Vehicle[] = seed(seedVehicles);
const trackedItems: TrackedItem[] = seed(seedTrackedItems);
const locationShares: LocationShare[] = seed(seedLocationShares);
// The logbook stores only MANUAL records; order entries are derived live on
// read (see MockLogbookRepository), so every order is always in the book.
const logEntries: LogEntry[] = seed(seedLogEntries);
/** Device push tokens -> platform. Mock-only: nothing here ever sends a push. */
const pushTokens = new Map<string, string>();

/** Push a notification (used by chat + bookings). */
function notify(n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>): void {
  notifications.push({
    ...n,
    id: nextId('n'),
    read: false,
    createdAt: new Date().toISOString(),
  });
}

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const delay = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms));

let idCounter = 1;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${idCounter++}`;

/**
 * Every stall product needs a stable id (the product page and its public
 * thread hang off one), but nothing that WRITES products — the register
 * wizard, the Manage editor — should have to invent one. Stamp the missing
 * ones on the way in; already-saved products keep theirs.
 */
const withProductIds = (products?: ProductItem[]): ProductItem[] | undefined =>
  products?.map((p) => (p.id ? p : { ...p, id: nextId('p') }));

// The app's GROWING collection — starts empty (the curated head start lives in
// code, domain/dishes.ts + domain/tags.ts), fills as listings are created and a
// super-admin adds tags. See CatalogRepository.
const catalogEntries: CatalogEntry[] = [];

// Paid ad slots. Starts empty even with seed content on: a campaign has to be
// requested and approved to exist, and seeding pre-approved ads would hide the
// one flow this feature is actually about.
const adCampaigns: AdCampaign[] = [];

/**
 * Record offerings not already in the code catalog or the store, bumping the
 * count on ones already seen. Shared by the repo's `capture` and the automatic
 * capture that runs on every business create/update.
 */
function applyCapture(inputs: CaptureEntryInput[], addedBy?: string): void {
  for (const input of inputs) {
    const name = input.name?.trim();
    if (!name) continue;
    const key = catalogKey(name);
    const existing = catalogEntries.find((e) => e.kind === input.kind && e.key === key);
    if (existing) {
      existing.count += 1;
      existing.updatedAt = new Date().toISOString();
      continue;
    }
    if (isCodeCatalogName(input.kind, name)) continue; // already shipped in code
    catalogEntries.push({
      id: nextId('cat'),
      kind: input.kind,
      name,
      key,
      approved: true, // live immediately; a super-admin hides bad ones after
      count: 1,
      addedBy,
      createdAt: new Date().toISOString(),
    });
  }
  applyCatalogEntries(catalogEntries); // keep the in-session overlays fresh
}

/** Everything a listing contributes to the collection: its tags + offerings. */
function businessCaptureInputs(b: Business): CaptureEntryInput[] {
  const out: CaptureEntryInput[] = [];
  for (const t of b.tags ?? []) out.push({ kind: 'tag', name: t });
  for (const m of b.menu ?? []) out.push({ kind: 'dish', name: m.name });
  for (const s of b.services ?? []) out.push({ kind: 'service', name: s.name });
  for (const p of b.products ?? []) out.push({ kind: 'product', name: p.name });
  return out;
}

/** Best-effort capture of a listing's offerings — never fails the write. */
function captureFromBusiness(b: Business): void {
  try {
    applyCapture(businessCaptureInputs(b), b.ownerId);
  } catch {
    /* ignore — capturing is a side effect of listing */
  }
}

class MockCatalogRepository implements CatalogRepository {
  async listApproved(kind?: CatalogEntryKind): Promise<CatalogEntry[]> {
    await delay(60);
    return catalogEntries
      .filter((e) => e.approved && (kind ? e.kind === kind : true))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(clone);
  }

  async listAll(kind?: CatalogEntryKind): Promise<CatalogEntry[]> {
    await delay(60);
    return catalogEntries
      .filter((e) => (kind ? e.kind === kind : true))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(clone);
  }

  async capture(inputs: CaptureEntryInput[], addedBy?: string): Promise<void> {
    try {
      applyCapture(inputs, addedBy);
    } catch {
      /* ignore — capturing must never fail the caller */
    }
  }

  async addTag(name: string): Promise<CatalogEntry> {
    await delay(80);
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('Type a tag name first.');
    const key = catalogKey(clean);
    const existing = catalogEntries.find((e) => e.kind === 'tag' && e.key === key);
    if (existing) {
      // Re-adding a hidden/known tag just makes it live + admin-blessed again.
      existing.approved = true;
      existing.adminAdded = true;
      existing.updatedAt = new Date().toISOString();
      applyCatalogEntries(catalogEntries);
      return clone(existing);
    }
    const entry: CatalogEntry = {
      id: nextId('cat'),
      kind: 'tag',
      name: clean,
      key,
      approved: true,
      adminAdded: true,
      count: 0,
      createdAt: new Date().toISOString(),
    };
    catalogEntries.push(entry);
    applyCatalogEntries(catalogEntries);
    return clone(entry);
  }

  async setApproved(id: string, approved: boolean): Promise<CatalogEntry> {
    await delay(70);
    const entry = catalogEntries.find((e) => e.id === id);
    if (!entry) throw new Error(`Catalog entry ${id} not found`);
    entry.approved = approved;
    entry.updatedAt = new Date().toISOString();
    applyCatalogEntries(catalogEntries);
    return clone(entry);
  }

  async remove(id: string): Promise<void> {
    await delay(70);
    const i = catalogEntries.findIndex((e) => e.id === id);
    if (i >= 0) catalogEntries.splice(i, 1);
    applyCatalogEntries(catalogEntries);
  }
}

class MockBusinessRepository implements BusinessRepository {
  async list(query: BusinessQuery = {}): Promise<Business[]> {
    await delay();
    const term = query.search?.trim().toLowerCase();
    const { near, maxDistanceKm, sortByDistance } = query;

    const results = businesses
      .filter((b) => (query.type ? b.type === query.type : true))
      // A personal stall matches a subcategory when any of its items does —
      // one stall can hold a phone (electronics) AND a car (vehicles).
      .filter((b) =>
        query.subcategoryId
          ? b.subcategoryId === query.subcategoryId ||
            (b.products ?? []).some((p) => p.subcategoryId === query.subcategoryId)
          : true,
      )
      .filter((b) => {
        if (!term) return true;
        // Search everything a customer could reasonably type: the listing
        // itself plus its products, menu, and services (suggestion sources).
        return [
          b.name,
          b.tagline,
          b.description,
          b.providerType,
          ...(b.tags ?? []),
          ...(b.products ?? []).map((p) => p.name),
          ...(b.menu ?? []).map((m) => m.name),
          ...(b.services ?? []).map((s) => s.name),
          ...(b.rentals ?? []).map((r) => r.name),
        ]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(term));
      })
      .map((b): Business => {
        // Attach a distance from `near` when we can compute one.
        const point = b.location.point;
        const distanceKm = near && point ? haversineKm(near, point) : undefined;
        return { ...clone(b), distanceKm };
      })
      // Only a hard `maxDistanceKm` drops businesses (too far, or no coords).
      // Plain distance sorting keeps everyone, placing no-coord ones last.
      .filter((b) => {
        if (typeof maxDistanceKm !== 'number' || !near) return true;
        return typeof b.distanceKm === 'number' && b.distanceKm <= maxDistanceKm;
      });

    results.sort((a, b) =>
      sortByDistance
        ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
        : b.createdAt.localeCompare(a.createdAt),
    );

    return results;
  }

  async getById(id: string): Promise<Business | null> {
    await delay(80);
    const found = businesses.find((b) => b.id === id);
    return found ? clone(found) : null;
  }

  async create(input: NewBusinessInput, ownerId: string): Promise<Business> {
    await delay();

    // A super-admin can list on someone else's behalf by naming the target
    // owner in the input; ordinary registration leaves it unset (self-owned).
    const effectiveOwnerId = input.ownerId?.trim() || ownerId;

    // Personal stalls: a user has ONE 'item' listing. Listing another item
    // adds it to the existing stall's products instead of creating a listing.
    if (input.type === 'item') {
      const stall = businesses.find((b) => b.type === 'item' && b.ownerId === effectiveOwnerId);
      if (stall) {
        stall.products = [...(stall.products ?? []), ...(withProductIds(input.products) ?? [])];
        captureFromBusiness(stall);
        return clone(stall);
      }
    }

    const businessId = nextId('b');

    const newEmployees: Employee[] = input.employees.map((emp) => ({
      id: nextId('e'),
      businessId,
      displayName: emp.displayName,
      // Every employee carries a role — default to "Staff" when none was typed.
      role: normalizeRole(emp.role),
      level: emp.level ?? 'staff',
      userId: emp.userId,
    }));
    employees.push(...newEmployees);
    const employeeIds = newEmployees.map((e) => e.id);

    const business: Business = {
      id: businessId,
      ownerId: effectiveOwnerId,
      name: input.name,
      tagline: input.tagline,
      description: input.description,
      type: input.type,
      subcategoryId: input.subcategoryId,
      tags: input.tags,
      location: input.location,
      phone: input.phone,
      email: input.email,
      website: input.website,
      priceLabel: input.priceLabel,
      menu: input.menu,
      services: input.services,
      products: withProductIds(input.products),
      hours: input.hours,
      openingHours: input.openingHours,
      modules: input.modules,
      employeeIds,
      // By default everyone on the team handles calls and receives chats;
      // the owner can narrow this on the Manage screen.
      callHandlerIds: employeeIds,
      ownerHandlesCalls: true,
      chatRecipientIds: employeeIds,
      openNow: true,
      // Rentals start available; the owner flips the status in Manage when a
      // tenant moves in, instead of deleting and re-listing. Not gated on the
      // listing type — a shop can rent things out on the side.
      rentalBasis: input.rentalBasis,
      rentals: input.rentals,
      rentalStatus: input.rentalBasis ? 'available' : undefined,
      createdAt: new Date().toISOString(),
    };
    businesses.push(business);
    captureFromBusiness(business);
    return clone(business);
  }

  async getStallForOwner(ownerId: string): Promise<Business | null> {
    await delay(60);
    const stall = businesses.find((b) => b.type === 'item' && b.ownerId === ownerId);
    return stall ? clone(stall) : null;
  }

  async getProduct(businessId: string, productId: string): Promise<ProductItem | null> {
    await delay(80);
    const product = businesses
      .find((b) => b.id === businessId)
      ?.products?.find((p) => p.id === productId);
    return product ? clone(product) : null;
  }

  async setProductSold(
    businessId: string,
    productId: string,
    sold: boolean,
    actorId: string,
  ): Promise<ProductItem> {
    await delay(90);
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can mark an item sold.');
    const product = business.products?.find((p) => p.id === productId);
    if (!product) throw new Error(`Product ${productId} not found`);
    product.sold = sold;
    return clone(product);
  }

  async removeProduct(businessId: string, productId: string, actorId: string): Promise<void> {
    await delay(90);
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can remove an item.');
    business.products = (business.products ?? []).filter((p) => p.id !== productId);
    // The item's public thread goes with it — nothing left to read.
    for (let i = productMessages.length - 1; i >= 0; i--) {
      if (productMessages[i].businessId === businessId && productMessages[i].productId === productId) {
        productMessages.splice(i, 1);
      }
    }
  }

  async update(id: string, patch: Partial<Business>): Promise<Business> {
    await delay(90);
    const business = businesses.find((b) => b.id === id);
    if (!business) throw new Error(`Business ${id} not found`);
    Object.assign(business, patch);
    // Products edited in Manage come back without ids for the new rows.
    if (patch.products) business.products = withProductIds(patch.products);
    // Manage edits add new tags/menu/services/products — capture them too.
    if (patch.tags || patch.menu || patch.services || patch.products) captureFromBusiness(business);
    return clone(business);
  }

  async reassignOwner(id: string, newOwnerId: string): Promise<Business> {
    await delay(90);
    const business = businesses.find((b) => b.id === id);
    if (!business) throw new Error(`Business ${id} not found`);
    business.ownerId = newOwnerId;
    return clone(business);
  }

  async remove(id: string, actorId: string): Promise<void> {
    await delay(120);
    const index = businesses.findIndex((b) => b.id === id);
    if (index === -1) throw new Error(`Business ${id} not found`);
    if (businesses[index].ownerId !== actorId) {
      throw new Error('Only the owner can take a listing down.');
    }
    businesses.splice(index, 1);
    // Postgres cascades on business_id; the mock has to sweep by hand so the
    // two backends look the same after a delete.
    dropByBusiness(id);
  }
}

/**
 * Delete everything that hangs off a listing. Mirrors the `on delete cascade`
 * foreign keys in supabase/migrations/0001_schema.sql — see BusinessRepository
 * .remove. Notifications are matched on their deep-link ids too, so a removed
 * shop leaves no alert pointing at a page that no longer exists.
 */
function dropByBusiness(businessId: string): void {
  const drop = <T>(list: T[], match: (row: T) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1);
  };
  drop(employees, (e) => e.businessId === businessId);
  // Customer chats hang off `threadKey` = "<businessId>:<participantId>"; B2B
  // threads off the two business ids joined with '|'.
  drop(messages, (m) => m.threadKey.split(':')[0] === businessId);
  drop(bizMessages, (m) => m.threadKey.split('|').includes(businessId));
  drop(bookings, (b) => b.businessId === businessId);
  drop(orders, (o) => o.businessId === businessId);
  drop(bills, (b) => b.businessId === businessId);
  drop(calls, (c) => c.businessId === businessId);
  drop(reviews, (r) => r.businessId === businessId);
  drop(productMessages, (p) => p.businessId === businessId);
  drop(memberships, (m) => m.businessId === businessId);
  drop(membershipPayments, (p) => p.businessId === businessId);
  drop(logEntries, (l) => l.businessId === businessId);
  drop(adCampaigns, (c) => c.businessId === businessId);
  drop(locationShares, (s) => s.businessId === businessId);
  drop(vehicles, (v) => v.businessId === businessId);
  drop(trackedItems, (t) => t.businessId === businessId);
  drop(notifications, (n) => n.businessId === businessId);
}

class MockProductThreadRepository implements ProductThreadRepository {
  async listForProduct(businessId: string, productId: string): Promise<ProductMessage[]> {
    await delay(90);
    return productMessages
      .filter((m) => m.businessId === businessId && m.productId === productId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async listForBusiness(businessId: string): Promise<ProductMessage[]> {
    await delay(90);
    return productMessages
      .filter((m) => m.businessId === businessId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async setPinned(
    businessId: string,
    productId: string,
    messageId: string,
    pinned: boolean,
    actorId: string,
  ): Promise<ProductMessage> {
    await delay(80);
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can pin messages.');
    const message = productMessages.find(
      (m) => m.id === messageId && m.businessId === businessId && m.productId === productId,
    );
    if (!message) throw new Error(`Message ${messageId} not found`);
    message.pinned = pinned;
    return clone(message);
  }

  async post(input: NewProductMessageInput): Promise<ProductMessage> {
    await delay(120);
    const business = businesses.find((b) => b.id === input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);
    const product = business.products?.find((p) => p.id === input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    if (!input.text.trim() && !input.offerPrice) {
      throw new Error('Write a question, or propose a price.');
    }

    const fromSeller = business.ownerId === input.authorId;
    const message: ProductMessage = {
      id: nextId('pm'),
      businessId: input.businessId,
      productId: input.productId,
      authorId: input.authorId,
      authorName: input.authorName,
      fromSeller,
      text: input.text.trim(),
      offerPrice: input.offerPrice,
      replyToId: input.replyToId,
      createdAt: new Date().toISOString(),
    };
    productMessages.push(message);

    // The seller hears about every question and offer; when the seller answers,
    // the person who asked hears back. Nobody else gets pinged — the thread is
    // public to READ, not a group everyone is subscribed to.
    if (!fromSeller) {
      notify({
        recipientId: business.ownerId,
        kind: 'product_question',
        title: `${input.authorName} on ${product.name}`,
        body: input.offerPrice
          ? `Offered ${input.offerPrice}${message.text ? ` — ${message.text}` : ''}`
          : message.text,
        businessId: business.id,
        productId: product.id,
      });
    } else if (input.replyToId) {
      const answered = productMessages.find((m) => m.id === input.replyToId);
      if (answered && answered.authorId !== input.authorId) {
        notify({
          recipientId: answered.authorId,
          kind: 'product_reply',
          title: `${business.name} replied`,
          body: message.text || `About ${product.name}`,
          businessId: business.id,
          productId: product.id,
        });
      }
    }

    return clone(message);
  }
}

class MockEmployeeRepository implements EmployeeRepository {
  async listByBusiness(businessId: string): Promise<Employee[]> {
    await delay(80);
    return employees.filter((e) => e.businessId === businessId).map(clone);
  }

  async getById(id: string): Promise<Employee | null> {
    await delay(60);
    const found = employees.find((e) => e.id === id);
    return found ? clone(found) : null;
  }

  async listBusinessesForUser(userId: string): Promise<Business[]> {
    await delay(80);
    const businessIds = new Set(
      employees.filter((e) => e.userId === userId).map((e) => e.businessId),
    );
    return businesses.filter((b) => businessIds.has(b.id)).map(clone);
  }

  async update(id: string, patch: Partial<Employee>): Promise<Employee> {
    await delay(70);
    const employee = employees.find((e) => e.id === id);
    if (!employee) throw new Error(`Employee ${id} not found`);
    Object.assign(employee, patch);
    return clone(employee);
  }

  async add(businessId: string, input: NewEmployeeInput): Promise<Employee> {
    await delay();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);
    const employee: Employee = {
      id: nextId('e'),
      businessId,
      displayName: input.displayName,
      // Every employee carries a role — default to "Staff" when none was typed.
      role: normalizeRole(input.role),
      level: input.level ?? 'staff',
      userId: input.userId,
    };
    employees.push(employee);
    // Mirror registration: a new member joins the team and, by default, rings on
    // calls and receives chats. The owner narrows this on the Manage screen.
    business.employeeIds = [...(business.employeeIds ?? []), employee.id];
    business.callHandlerIds = [...(business.callHandlerIds ?? []), employee.id];
    business.chatRecipientIds = [...(business.chatRecipientIds ?? []), employee.id];
    return clone(employee);
  }

  async remove(id: string): Promise<void> {
    await delay();
    const index = employees.findIndex((e) => e.id === id);
    if (index === -1) return;
    const [removed] = employees.splice(index, 1);
    const business = businesses.find((b) => b.id === removed.businessId);
    if (business) {
      business.employeeIds = (business.employeeIds ?? []).filter((eid) => eid !== id);
      business.callHandlerIds = (business.callHandlerIds ?? []).filter((eid) => eid !== id);
      business.chatRecipientIds = (business.chatRecipientIds ?? []).filter((eid) => eid !== id);
    }
  }
}

class MockUserRepository implements UserRepository {
  async getById(id: string): Promise<User | null> {
    await delay(60);
    const found = users.find((u) => u.id === id);
    return found ? clone(found) : null;
  }

  async list(): Promise<User[]> {
    await delay(50);
    return users.map(clone);
  }

  async create(input: NewUserInput): Promise<User> {
    await delay(90);
    const user: User = {
      id: nextId('u'),
      name: input.name.trim() || 'Test user',
      email: input.email?.trim() || undefined,
      isProfilePublic: input.isProfilePublic ?? true,
    };
    users.push(user);
    return clone(user);
  }

  async search(term: string): Promise<User[]> {
    await delay(100);
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return users.filter((u) => u.name.toLowerCase().includes(q)).map(clone);
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    await delay(80);
    const user = users.find((u) => u.id === id);
    if (!user) throw new Error(`User ${id} not found`);
    Object.assign(user, patch);
    return clone(user);
  }
}

// Session auth state. Starts null — the app opens as a guest.
let currentUserId: string | null = null;


/**
 * Stamp the derived super-admin flag onto a session user.
 *
 * On the real backend this is read from the `platform_admins` table, which no
 * session can write to (supabase/migrations/0006). The mock has no such table,
 * so dev mode derives it from the provisioning phone list instead — sign up as
 * one of those numbers and you get the admin console to test with. This is a
 * DEV-ONLY shortcut; nothing ships it, because the mock never runs in a
 * production build.
 */
const asSessionUser = (user: User): User => ({
  ...clone(user),
  isSuperAdmin: isSuperAdminPhone(user.phone),
});

class MockAuthRepository implements AuthRepository {
  async getCurrentUser(): Promise<User | null> {
    await delay(50);
    const user = users.find((u) => u.id === currentUserId);
    return user ? asSessionUser(user) : null;
  }

  /**
   * Mock sign-in accepts a username, an email or a phone number, like the real
   * one. A match signs in AS THAT PERSON — which makes the identity model
   * testable offline — and anything else falls back to the demo user who owns
   * the seed data, preserving the old "any credentials work" convenience.
   */
  async signIn(usernameEmailOrPhone: string, _password?: string): Promise<User> {
    await delay(150);
    const typed = (usernameEmailOrPhone ?? '').trim().toLowerCase();
    const digits = typed.replace(/\D/g, '');
    const match = typed
      ? users.find(
          (u) =>
            (!!u.username && u.username.toLowerCase() === typed) ||
            (!!u.email && u.email.toLowerCase() === typed) ||
            (!!u.phone && digits.length >= 10 && u.phone.replace(/\D/g, '') === digits),
        )
      : undefined;
    const user = match ?? users.find((u) => u.id === 'u_demo')!;
    currentUserId = user.id;
    return asSessionUser(user);
  }

  async signUp(input: SignUpInput): Promise<User> {
    await delay(180);
    // The same rules the real backend enforces, from the same place — the mock
    // is the behavioural spec, so it must refuse what Supabase refuses.
    const username = assertUsername(input.username);
    const { email, phone } = assertContactDetails(input);
    assertPassword(input.password);
    // Uniqueness comes free from `auth.users.email` on the real backend; offline
    // it has to be checked, or the mock would accept what Supabase rejects.
    if (users.some((u) => u.username?.toLowerCase() === username)) {
      throw new Error('That username is taken. Try another one.');
    }
    const user: User = {
      id: nextId('u'),
      name: input.name?.trim() || username,
      username,
      email,
      phone,
      isProfilePublic: false,
    };
    users.push(user);
    currentUserId = user.id;
    return asSessionUser(user);
  }

  async signOut(): Promise<void> {
    await delay(50);
    currentUserId = null;
  }

  async signInAs(userId: string): Promise<User> {
    await delay(60);
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error(`User ${userId} not found`);
    currentUserId = user.id;
    return asSessionUser(user);
  }

  async signInGuest(): Promise<User> {
    await delay(60);
    const existing = users.find((u) => u.id === currentUserId);
    if (existing) return clone(existing);
    // A throwaway anonymous identity, added to the store so its id resolves.
    const guest: User = {
      id: nextId('u_guest'),
      name: 'Guest',
      isProfilePublic: false,
      isAnonymous: true,
    };
    users.push(guest);
    currentUserId = guest.id;
    return clone(guest);
  }

  /**
   * There is no Google offline, so this signs in as the demo user — the same
   * convenience `signIn` offers. The screen still shows the button, because a
   * flow that only exists against the real backend is one nobody tests.
   */
  async signInWithGoogle(): Promise<User> {
    await delay(300);
    const demo = users.find((u) => u.id === 'u_demo')!;
    currentUserId = demo.id;
    return asSessionUser(demo);
  }

  /**
   * Close the account, mirroring migration 0019 exactly — the mock is the
   * behavioural spec, so the offline answer has to be the one the real backend
   * would give: the same refusal when a real business is in the way, and the
   * same tombstone-and-scrub when there isn't.
   */
  async deleteAccount(): Promise<DeleteAccountResult> {
    await delay(200);
    const user = users.find((u) => u.id === currentUserId);
    if (!user) throw new Error('You are not signed in.');

    const blockers = accountDeletionBlockers(user.id);
    if (blockers.length > 0) return { deleted: false, blockers };

    const listingsRemoved = anonymizeAccount(user.id);
    currentUserId = null;
    return { deleted: true, listingsRemoved };
  }

  /**
   * Offline there are no passwords to change — `signIn` accepts anything — so
   * this can't be a real credential swap. What it CAN do faithfully is refuse
   * everything the real backend refuses, in the same words and the same order,
   * so the screen's error paths are all reachable without a backend and the
   * happy path still ends in success.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await delay(200);
    if (!currentUserId) throw new Error('You are not signed in.');
    if (!currentPassword) throw new Error('Enter your current password.');
    assertPassword(newPassword);
    if (currentPassword === newPassword) {
      throw new Error('That is already your password. Choose a different one.');
    }
  }
}

/**
 * Listings that stop this account being deleted, and why.
 *
 * A business with counterparties — staff, orders, bills, bookings, members,
 * reviews, customer chats, calls, an ad campaign, tracked items — is never
 * taken down with its owner: it would destroy other people's records, and 0008
 * makes transfer owner-only, so cascading would delete the one person able to
 * hand it over. An EMPTY listing has no such problem and goes with the account.
 */
function accountDeletionBlockers(userId: string): AccountDeletionBlocker[] {
  return businesses
    .filter((b) => b.ownerId === userId)
    .map((b) => {
      const reasons = [
        employees.some((e) => e.businessId === b.id) && 'has team members',
        orders.some((o) => o.businessId === b.id) && 'has customer orders',
        bills.some((x) => x.businessId === b.id) && 'has issued bills',
        bookings.some((x) => x.businessId === b.id) && 'has bookings',
        memberships.some((m) => m.businessId === b.id) && 'has members',
        reviews.some((r) => r.businessId === b.id) && 'has reviews',
        messages.some((m) => m.threadKey.split(':')[0] === b.id) && 'has customer chats',
        calls.some((c) => c.businessId === b.id) && 'has call history',
        adCampaigns.some((c) => c.businessId === b.id) && 'has an ad campaign',
        trackedItems.some((t) => t.businessId === b.id) && 'is tracking items for customers',
      ].filter((r): r is string => typeof r === 'string');
      return { businessId: b.id, name: b.name, reasons };
    })
    .filter((b) => b.reasons.length > 0);
}

/**
 * The scrub, in memory. The twin of `public.anonymize_account` (migration 0019)
 * — read that file's header for WHY each row is deleted, anonymised or kept.
 * Returns how many (empty) listings went with the account.
 *
 * Two things the real backend does have no counterpart here: saved places are
 * global in the mock (no `userId` on `SavedPlace`) and push tokens are keyed by
 * token alone, so neither can be scoped to a person offline.
 */
function anonymizeAccount(userId: string): number {
  const DELETED_NAME = 'Deleted user';
  const drop = <T>(list: T[], match: (row: T) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1);
  };

  // Their own listings — provably empty, or we would not be here.
  const owned = businesses.filter((b) => b.ownerId === userId).map((b) => b.id);
  for (const id of owned) {
    drop(businesses, (b) => b.id === id);
    dropByBusiness(id);
  }

  // Deleted outright: personal, and nobody else's record.
  drop(notifications, (n) => n.recipientId === userId);
  // Carries a child's name.
  drop(trackedItems, (t) => t.customerId === userId);
  drop(locationShares, (s) => s.userId === userId);
  // The whole customer thread, both sides — threadKey is "<businessId>:<participantId>".
  drop(messages, (m) => m.threadKey.split(':')[1] === userId);

  // Unlinked, but kept for the business: the roster entry and its displayName
  // are the business's own record.
  for (const employee of employees) {
    if (employee.userId === userId) employee.userId = undefined;
  }

  // Anonymised in place. Ids stay pointing at the tombstone on purpose — they
  // identify nobody once the account is gone, and keeping them means no
  // surprise undefined reaches a screen.
  for (const order of orders) {
    if (order.customerId !== userId) continue;
    order.customerName = DELETED_NAME;
    delete order.note;
    delete order.enrollees;
  }
  for (const bill of bills) {
    if (bill.customerId === userId) bill.customerName = DELETED_NAME;
  }
  for (const booking of bookings) {
    if (booking.customerId !== userId) continue;
    booking.customerName = DELETED_NAME;
    delete booking.note;
  }
  for (const call of calls) {
    if (call.customerId !== userId) continue;
    call.customerName = DELETED_NAME;
    call.participants = call.participants.map((p) =>
      p.id === userId ? { ...p, name: DELETED_NAME } : p,
    );
  }
  for (const membership of memberships) {
    if (membership.customerId !== userId) continue;
    membership.customerName = DELETED_NAME;
    delete membership.enrolleeName;
    // A plan with nobody left to attend it is over; past months stay as the
    // business's revenue record.
    if (membership.status === 'pending' || membership.status === 'active') {
      membership.status = 'cancelled';
      membership.endedAt = new Date().toISOString();
    }
  }
  for (const payment of membershipPayments) {
    if (payment.customerId !== userId) continue;
    payment.reportedByName = DELETED_NAME;
    delete payment.note;
  }
  for (const review of reviews) {
    if (review.customerId === userId) review.customerName = DELETED_NAME;
  }
  for (const message of productMessages) {
    if (message.authorId === userId) message.authorName = DELETED_NAME;
  }
  // The business's record book, reached through the order it records: a
  // LogEntry carries only a customerName, with no id to match on.
  const theirOrders = new Set(orders.filter((o) => o.customerId === userId).map((o) => o.id));
  for (const entry of logEntries) {
    if (entry.orderId && theirOrders.has(entry.orderId)) entry.customerName = DELETED_NAME;
  }

  // The tombstone: rebuilt from scratch, so nothing personal can survive in a
  // field this function forgot to name.
  const index = users.findIndex((u) => u.id === userId);
  if (index !== -1) {
    users[index] = {
      id: userId,
      name: DELETED_NAME,
      isProfilePublic: false,
      deletedAt: new Date().toISOString(),
    };
  }

  return owned.length;
}

class MockPlacesRepository implements PlacesRepository {
  // Overlay the real device GPS fix onto the seeded "current" place. Falls back
  // to the seed coordinate when permission is denied / unavailable.
  private async withDeviceLocation(place: SavedPlace): Promise<SavedPlace> {
    if (place.kind !== 'current') return clone(place);
    const point = await getDeviceLocation();
    return point ? { ...clone(place), point } : clone(place);
  }

  async getCurrentPlace(): Promise<SavedPlace> {
    await delay(40);
    const current = places.find((p) => p.kind === 'current') ?? places[0];
    return this.withDeviceLocation(current);
  }

  async listPlaces(): Promise<SavedPlace[]> {
    await delay(40);
    // Current location first, then saved places.
    const ordered = [...places].sort((a, b) =>
      a.kind === 'current' ? -1 : b.kind === 'current' ? 1 : 0,
    );
    return Promise.all(ordered.map((p) => this.withDeviceLocation(p)));
  }

  async savePlace(input: NewSavedPlaceInput): Promise<SavedPlace> {
    await delay(120);
    const label = input.label.trim();
    if (!label) throw new Error('Give this place a name.');

    // One home, one work. Replacing beats appending: a dropdown offering "Home"
    // twice is a mess the user then has to tidy up by hand.
    const existing =
      input.kind === 'home' || input.kind === 'work'
        ? places.find((p) => p.kind === input.kind)
        : undefined;
    if (existing) {
      Object.assign(existing, { label, point: input.point, address: input.address });
      return clone(existing);
    }

    const place: SavedPlace = {
      id: nextId('p'),
      label,
      kind: input.kind,
      point: input.point,
      address: input.address,
    };
    places.push(place);
    return clone(place);
  }

  async removePlace(id: string): Promise<void> {
    await delay(80);
    const index = places.findIndex((p) => p.id === id && p.kind !== 'current');
    if (index >= 0) places.splice(index, 1);
  }
}

// One thread per customer per business.
const threadKeyFor = (businessId: string, participantId: string) =>
  `${businessId}:${participantId}`;

const participantName = (participantId: string): string =>
  participantId === 'guest'
    ? 'Guest'
    : users.find((u) => u.id === participantId)?.name ?? participantId;

class MockChatRepository implements ChatRepository {
  async listThread(businessId: string, participantId: string): Promise<ChatMessage[]> {
    await delay(80);
    const key = threadKeyFor(businessId, participantId);
    return messages.filter((m) => m.threadKey === key).map(clone);
  }

  async send(
    businessId: string,
    participantId: string,
    body: string,
    author: ChatAuthor,
    extra?: { billId?: string },
  ): Promise<ChatMessage[]> {
    await delay(90);
    const key = threadKeyFor(businessId, participantId);
    // Real two-sided chat — no auto-reply. A member with chat access replies
    // from the business inbox, attributed to whoever they are.
    messages.push({
      id: nextId('m'),
      threadKey: key,
      authorType: author.type,
      authorName: author.name,
      body: body.trim(),
      billId: extra?.billId,
      createdAt: new Date().toISOString(),
    });

    // Notify the customer when the business replies, so they don't have to
    // reopen the chat to notice.
    if (author.type === 'business') {
      const businessName = businesses.find((b) => b.id === businessId)?.name ?? 'A business';
      notifications.push({
        id: nextId('n'),
        recipientId: participantId,
        kind: 'chat_reply',
        title: `${author.name} from ${businessName}`,
        body: body.trim(),
        businessId,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    return messages.filter((m) => m.threadKey === key).map(clone);
  }

  async listBusinessThreads(businessId: string): Promise<ChatThreadSummary[]> {
    await delay(90);
    const prefix = `${businessId}:`;
    const keys = Array.from(
      new Set(messages.filter((m) => m.threadKey.startsWith(prefix)).map((m) => m.threadKey)),
    );
    return keys
      .map((key): ChatThreadSummary => {
        const pid = key.slice(prefix.length);
        const msgs = messages.filter((m) => m.threadKey === key);
        const last = msgs[msgs.length - 1];
        return {
          businessId,
          participantId: pid,
          participantName: participantName(pid),
          lastBody: last?.body ?? '',
          lastAt: last?.createdAt ?? '',
          lastAuthorType: last?.authorType ?? 'customer',
          count: msgs.length,
        };
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  async listCustomerThreads(participantId: string): Promise<CustomerThreadSummary[]> {
    await delay(90);
    const suffix = `:${participantId}`;
    const keys = Array.from(
      new Set(messages.filter((m) => m.threadKey.endsWith(suffix)).map((m) => m.threadKey)),
    );
    return keys
      .map((key): CustomerThreadSummary => {
        const businessId = key.slice(0, key.length - suffix.length);
        const msgs = messages.filter((m) => m.threadKey === key);
        const last = msgs[msgs.length - 1];
        return {
          businessId,
          businessName: businesses.find((b) => b.id === businessId)?.name ?? 'A business',
          lastBody: last?.body ?? '',
          lastAt: last?.createdAt ?? '',
          lastAuthorType: last?.authorType ?? 'customer',
          count: msgs.length,
        };
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }
}

class MockNotificationRepository implements NotificationRepository {
  /** Alert families this recipient has silenced (see domain/notifications.ts). */
  private mutesOf(recipientId: string): string[] | undefined {
    return users.find((u) => u.id === recipientId)?.mutedNotifications;
  }

  async listForUser(recipientId: string): Promise<AppNotification[]> {
    await delay(60);
    const mutes = this.mutesOf(recipientId);
    return notifications
      .filter((n) => n.recipientId === recipientId && !isNotificationMuted(n, mutes))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async unreadCount(recipientId: string): Promise<number> {
    await delay(30);
    const mutes = this.mutesOf(recipientId);
    return notifications.filter(
      (n) => n.recipientId === recipientId && !n.read && !isNotificationMuted(n, mutes),
    ).length;
  }

  async markRead(id: string): Promise<void> {
    await delay(30);
    const n = notifications.find((x) => x.id === id);
    if (n) n.read = true;
  }

  async markAllRead(recipientId: string): Promise<void> {
    await delay(40);
    notifications.forEach((n) => {
      if (n.recipientId === recipientId) n.read = true;
    });
  }
}

class MockBookingRepository implements BookingRepository {
  async create(input: NewBookingInput): Promise<Booking> {
    await delay(120);
    const booking: Booking = {
      id: nextId('bk'),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      serviceName: input.serviceName,
      price: input.price,
      when: input.when,
      note: input.note,
      status: 'requested',
      createdAt: new Date().toISOString(),
    };
    bookings.push(booking);

    // Notify the business owner of the new request.
    const business = businesses.find((b) => b.id === input.businessId);
    if (business) {
      notify({
        recipientId: business.ownerId,
        kind: 'booking_requested',
        title: `New booking · ${business.name}`,
        body: `${input.customerName} requested "${input.serviceName}" for ${input.when}`,
        businessId: business.id,
      });
    }
    return clone(booking);
  }

  async listForBusiness(businessId: string): Promise<Booking[]> {
    await delay(80);
    return bookings
      .filter((b) => b.businessId === businessId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async listForCustomer(customerId: string): Promise<Booking[]> {
    await delay(80);
    return bookings
      .filter((b) => b.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    await delay(90);
    const booking = bookings.find((b) => b.id === id);
    if (!booking) throw new Error(`Booking ${id} not found`);
    booking.status = status;

    // Notify the customer of the decision.
    if (status === 'accepted' || status === 'declined') {
      const business = businesses.find((b) => b.id === booking.businessId);
      notify({
        recipientId: booking.customerId,
        kind: 'booking_update',
        title: `Booking ${status} · ${business?.name ?? 'Business'}`,
        body: `Your "${booking.serviceName}" for ${booking.when} was ${status}.`,
        businessId: booking.businessId,
      });
    }
    return clone(booking);
  }
}

// ── Orders & bills ──────────────────────────────────────────────────────────

/** Compute line amounts + total and store the bill. Shared by both flows. */
function issueBill(input: NewBillInput): Bill {
  const lines: BillLine[] = input.lines.map((l) => {
    const unit = parsePrice(l.price);
    return { ...l, amount: unit === undefined ? undefined : unit * l.quantity };
  });
  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const business = businesses.find((b) => b.id === input.businessId);
  const bill: Bill = {
    id: nextId('bill'),
    businessId: input.businessId,
    businessName: business?.name ?? 'Business',
    customerId: input.customerId,
    customerName: input.customerName,
    lines,
    total,
    note: input.note,
    issuedByName: input.issuedByName,
    orderId: input.orderId,
    // Money hasn't moved yet — the business marks it paid when it arrives.
    paymentStatus: 'pending',
    createdAt: new Date().toISOString(),
  };
  bills.push(bill);
  return bill;
}

/** Finalise an order: bill the included lines and link the bill back. */
function acceptOrder(order: Order): Bill {
  const kept = order.lines.filter((l) => l.included);
  const bill = issueBill({
    businessId: order.businessId,
    customerId: order.customerId,
    customerName: order.customerName,
    // Bill at the agreed price: the seller's counter, else the customer's
    // accepted offer, else the listed price.
    lines: kept.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      price: l.counterPrice ?? l.offerPrice ?? l.price,
    })),
    issuedByName: order.respondedByName ?? 'Owner',
    orderId: order.id,
  });
  order.status = 'accepted';
  order.billId = bill.id;
  return bill;
}

const orderSummary = (order: Order): string => {
  const kept = order.lines.filter((l) => l.included);
  const count = kept.reduce((n, l) => n + l.quantity, 0);
  return `${count} item${count === 1 ? '' : 's'}`;
};

/** Total of an order's included lines at the agreed price, when it parses. */
const orderAmount = (order: Order): number | undefined => {
  let total = 0;
  let sawPrice = false;
  for (const l of order.lines) {
    if (!l.included) continue;
    const unit = parsePrice(l.counterPrice ?? l.offerPrice ?? l.price);
    if (unit !== undefined) {
      total += unit * l.quantity;
      sawPrice = true;
    }
  }
  return sawPrice ? total : undefined;
};

/**
 * A logbook entry derived from an order — how every in-app order lands in the
 * record book without a write step, so nothing is ever missed (seeded orders
 * included). The id is stable so an order never doubles up.
 */
const orderLogEntry = (order: Order): LogEntry => {
  const label =
    order.party ? 'Party order' : order.fulfillment === 'dine_in' ? 'Dine-in order' : order.fulfillment === 'takeaway' ? 'Takeaway order' : 'Order';
  return {
    id: `log_order_${order.id}`,
    businessId: order.businessId,
    source: 'order',
    orderId: order.id,
    title: `${label} · ${order.customerName}`,
    details: `${orderSummary(order)} · ${order.status}`,
    amount: orderAmount(order),
    customerName: order.customerName,
    recordedByName: 'App',
    createdAt: order.createdAt,
  };
};

/**
 * An order still holding a table: awaiting a response, awaiting the customer's
 * decision, or a confirmed-but-unbilled tab. Billing/rejection frees the seat.
 * (Mirrors `isOrderOpen` in orderUtils — kept local to avoid a UI import here.)
 */
const isOrderStillOpen = (order: Order): boolean =>
  !order.billId &&
  (order.status === 'requested' || order.status === 'proposed' || order.status === 'accepted');

/** Table numbers currently taken by open dine-in orders at a business. */
function occupiedTables(businessId: string): Set<number> {
  const taken = new Set<number>();
  for (const o of orders) {
    if (o.businessId !== businessId) continue;
    if (o.fulfillment !== 'dine_in' || o.tableNumber == null) continue;
    if (isOrderStillOpen(o)) taken.add(o.tableNumber);
  }
  return taken;
}

/**
 * Decide which table a new dine-in order sits at:
 *  - an explicit pick (a member seating the customer) wins;
 *  - else, a known customer already at a table keeps it (their tab continues);
 *  - else, the lowest free table (1..tableCount);
 *  - undefined when the business runs no tables or every table is full.
 */
function assignTable(
  business: Business | undefined,
  explicit: number | undefined,
  customerId: string,
): number | undefined {
  if (!business?.tableCount) return undefined;
  if (explicit != null) return explicit;
  const taken = occupiedTables(business.id);
  // A returning customer (with an account) keeps whatever table they're on.
  if (customerId && customerId !== 'guest') {
    const existing = orders.find(
      (o) =>
        o.businessId === business.id &&
        o.customerId === customerId &&
        o.fulfillment === 'dine_in' &&
        o.tableNumber != null &&
        isOrderStillOpen(o),
    );
    if (existing?.tableNumber != null) return existing.tableNumber;
  }
  for (let n = 1; n <= business.tableCount; n++) {
    if (!taken.has(n)) return n;
  }
  return undefined; // every table full — seated once one frees up / member picks.
}

class MockOrderRepository implements OrderRepository {
  async create(input: NewOrderInput): Promise<Order> {
    await delay(120);
    const businessForTable = businesses.find((b) => b.id === input.businessId);
    // Dine-in seating: a member may seat the order at a specific table;
    // otherwise reuse the customer's existing table (open tab) or hand them the
    // lowest free one. Takeaway and no-tables businesses stay unseated.
    const tableNumber =
      input.fulfillment === 'dine_in'
        ? assignTable(businessForTable, input.tableNumber, input.customerId)
        : undefined;
    const order: Order = {
      id: nextId('o'),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      lines: input.lines.map((l) => ({
        id: nextId('ol'),
        kind: l.kind,
        name: l.name,
        price: l.price,
        offerPrice: l.offerPrice?.trim() || undefined,
        quantity: Math.max(1, Math.round(l.quantity)),
        included: true,
      })),
      fulfillment: input.fulfillment,
      tableNumber,
      party: input.party,
      enrollees: input.enrollees?.map((n) => n.trim()).filter(Boolean),
      note: input.note,
      status: 'requested',
      createdAt: new Date().toISOString(),
    };
    orders.push(order);

    const business = businesses.find((b) => b.id === input.businessId);
    if (business) {
      if (order.party) {
        notify({
          recipientId: business.ownerId,
          kind: 'order_requested',
          title: `🎉 Party request · ${business.name}`,
          body: `${input.customerName} wants to host ${order.party.occasion ? `a ${order.party.occasion.toLowerCase()}` : 'a party'} for ${order.party.guests} guests — ${order.party.when}.`,
          businessId: business.id,
          orderId: order.id,
        });
        return clone(order);
      }
      const fulfillment =
        order.fulfillment === 'dine_in' ? ' · Dine-in' : order.fulfillment === 'takeaway' ? ' · Takeaway' : '';
      const bargained = order.lines.some((l) => l.offerPrice) ? ' with a price offer' : '';
      const enrolling =
        order.enrollees && order.enrollees.length > 0 ? ` for ${order.enrollees.join(', ')}` : '';
      notify({
        recipientId: business.ownerId,
        kind: 'order_requested',
        title: `New order · ${business.name}`,
        body: `${input.customerName} ordered ${orderSummary(order)}${enrolling}${bargained}${fulfillment}.`,
        businessId: business.id,
        orderId: order.id,
      });
    }
    return clone(order);
  }

  async getById(id: string): Promise<Order | null> {
    await delay(60);
    const found = orders.find((o) => o.id === id);
    return found ? clone(found) : null;
  }

  async listForBusiness(businessId: string): Promise<Order[]> {
    await delay(80);
    return orders
      .filter((o) => o.businessId === businessId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async listForCustomer(customerId: string, businessId?: string): Promise<Order[]> {
    await delay(80);
    return orders
      .filter((o) => o.customerId === customerId)
      .filter((o) => (businessId ? o.businessId === businessId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async respond(
    id: string,
    keptLineIds: string[],
    respondedByName: string,
    message?: string,
    counterPrices?: Record<string, string>,
  ): Promise<Order> {
    await delay(120);
    const order = this.mustFind(id);
    if (order.status !== 'requested') throw new Error('This order was already responded to.');
    const kept = new Set(keptLineIds);
    if (kept.size === 0) {
      throw new Error('Keep at least one item — to turn the whole order down, reject it instead.');
    }
    order.lines.forEach((l) => {
      l.included = kept.has(l.id);
      l.counterPrice = (l.included && counterPrices?.[l.id]?.trim()) || undefined;
    });
    order.respondedByName = respondedByName;
    order.respondedAt = new Date().toISOString();
    order.responseMessage = message?.trim() || undefined;

    const businessName = businesses.find((b) => b.id === order.businessId)?.name ?? 'Business';
    const countered = order.lines.some((l) => l.counterPrice);
    if (order.lines.every((l) => l.included) && !countered) {
      if (order.fulfillment === 'dine_in' || order.party) {
        // Dine-in tabs and confirmed parties STAY OPEN — the bill comes when
        // the business moves them to billing (after the meal / the event).
        order.status = 'accepted';
        notify({
          recipientId: order.customerId,
          kind: 'order_update',
          title: order.party ? `Party confirmed · ${businessName}` : `Order confirmed · ${businessName}`,
          body: order.party
            ? `Your party for ${order.party.guests} guests (${order.party.when}) is confirmed — the bill comes after the event.`
            : `${orderSummary(order)} confirmed — add more anytime; the bill comes at the end.`,
          businessId: order.businessId,
          orderId: order.id,
        });
        return clone(order);
      }
      // Nothing was removed or re-priced → the complete order is accepted
      // (at the customer's offer prices, where they made offers); bill it.
      const bill = acceptOrder(order);
      notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: `Order accepted · ${businessName}`,
        body: `${orderSummary(order)} confirmed — your bill is ${formatMoney(bill.total)}.`,
        businessId: order.businessId,
        orderId: order.id,
      });
    } else {
      // Some lines can't be provided, or the seller countered the customer's
      // offer → send it back as a live proposal to accept or decline.
      order.status = 'proposed';
      notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: countered ? `Counter-offer from ${businessName}` : `Proposal from ${businessName}`,
        body: countered
          ? 'The seller countered your offer — review the price and confirm.'
          : `They can provide ${orderSummary(order)} of your order — review and confirm.`,
        businessId: order.businessId,
        orderId: order.id,
      });
    }
    return clone(order);
  }

  async reject(id: string, respondedByName: string, message?: string): Promise<Order> {
    await delay(100);
    const order = this.mustFind(id);
    if (order.status !== 'requested') throw new Error('This order was already responded to.');
    order.status = 'rejected';
    order.respondedByName = respondedByName;
    order.respondedAt = new Date().toISOString();
    order.responseMessage = message?.trim() || undefined;

    const businessName = businesses.find((b) => b.id === order.businessId)?.name ?? 'Business';
    notify({
      recipientId: order.customerId,
      kind: 'order_update',
      title: `Order rejected · ${businessName}`,
      body: order.responseMessage ?? 'The business couldn’t take this order.',
      businessId: order.businessId,
      orderId: order.id,
    });
    return clone(order);
  }

  async decideProposal(id: string, accept: boolean): Promise<Order> {
    await delay(120);
    const order = this.mustFind(id);
    if (order.status !== 'proposed') throw new Error('There is no open proposal on this order.');

    const business = businesses.find((b) => b.id === order.businessId);
    if (accept) {
      if (order.fulfillment === 'dine_in' || order.party) {
        // Dine-in / party proposal accepted → stays open, billed at the end.
        order.status = 'accepted';
        if (business) {
          notify({
            recipientId: business.ownerId,
            kind: 'order_update',
            title: `Proposal accepted · ${business.name}`,
            body: order.party
              ? `${order.customerName} agreed — party for ${order.party.guests} guests, ${order.party.when}. Bill it after the event.`
              : `${order.customerName} confirmed ${orderSummary(order)} — move the tab to billing when they're done.`,
            businessId: order.businessId,
            orderId: order.id,
          });
        }
        return clone(order);
      }
      const bill = acceptOrder(order);
      if (business) {
        notify({
          recipientId: business.ownerId,
          kind: 'order_update',
          title: `Proposal accepted · ${business.name}`,
          body: `${order.customerName} confirmed ${orderSummary(order)} — bill ${formatMoney(bill.total)} issued.`,
          businessId: order.businessId,
          orderId: order.id,
        });
      }
    } else {
      order.status = 'declined';
      if (business) {
        notify({
          recipientId: business.ownerId,
          kind: 'order_update',
          title: `Proposal declined · ${business.name}`,
          body: `${order.customerName} declined your proposal.`,
          businessId: order.businessId,
          orderId: order.id,
        });
      }
    }
    return clone(order);
  }

  async appendLines(id: string, lines: NewOrderLineInput[]): Promise<Order> {
    await delay(120);
    const order = this.mustFind(id);
    if (order.billId) throw new Error('This order was already billed — place a new order instead.');
    if (order.status !== 'requested' && order.status !== 'accepted') {
      throw new Error('This order is not open anymore — place a new order instead.');
    }
    if (lines.length === 0) throw new Error('Pick at least one item to add.');
    order.lines.push(
      ...lines.map((l) => ({
        id: nextId('ol'),
        kind: l.kind,
        name: l.name,
        price: l.price,
        offerPrice: l.offerPrice?.trim() || undefined,
        quantity: Math.max(1, Math.round(l.quantity)),
        included: true,
      })),
    );
    // The new round needs the business's confirmation again.
    order.status = 'requested';
    order.responseMessage = undefined;

    const business = businesses.find((b) => b.id === order.businessId);
    if (business) {
      notify({
        recipientId: business.ownerId,
        kind: 'order_requested',
        title: `Order updated · ${business.name}`,
        body: `${order.customerName} added more items — now ${orderSummary(order)} in total.`,
        businessId: business.id,
        orderId: order.id,
      });
    }
    return clone(order);
  }

  async moveToBilling(id: string, issuedByName: string): Promise<Order> {
    await delay(120);
    const order = this.mustFind(id);
    if (order.billId) throw new Error('This order was already billed.');
    if (order.status !== 'accepted') {
      throw new Error('Only a confirmed open order can be moved to billing.');
    }
    order.respondedByName = issuedByName;
    const bill = acceptOrder(order);

    const businessName = businesses.find((b) => b.id === order.businessId)?.name ?? 'Business';
    notify({
      recipientId: order.customerId,
      kind: 'order_update',
      title: `Bill ready · ${businessName}`,
      body: `Your tab was closed — the bill is ${formatMoney(bill.total)}.`,
      businessId: order.businessId,
      orderId: order.id,
    });
    return clone(order);
  }

  async markDelivered(id: string, byName: string): Promise<Order> {
    await delay(100);
    const order = this.mustFind(id);
    if (order.deliveredAt) throw new Error('This order was already collected.');
    if (!order.billId) {
      throw new Error('Accept and bill the order before handing it over.');
    }
    order.deliveredAt = new Date().toISOString();
    order.deliveredByName = byName;

    const businessName = businesses.find((b) => b.id === order.businessId)?.name ?? 'Business';
    notify({
      recipientId: order.customerId,
      kind: 'order_update',
      title: `Order collected · ${businessName}`,
      body: `${byName} handed over your order — enjoy!`,
      businessId: order.businessId,
      orderId: order.id,
    });
    return clone(order);
  }

  async tableStatus(businessId: string): Promise<TableSeat[]> {
    await delay(60);
    const business = businesses.find((b) => b.id === businessId);
    const count = business?.tableCount ?? 0;
    const seated = new Map<number, Order>();
    for (const o of orders) {
      if (o.businessId !== businessId) continue;
      if (o.fulfillment !== 'dine_in' || o.tableNumber == null) continue;
      if (!isOrderStillOpen(o)) continue;
      seated.set(o.tableNumber, o);
    }
    return Array.from({ length: count }, (_, i) => {
      const number = i + 1;
      const order = seated.get(number);
      return { number, order: order ? clone(order) : null };
    });
  }

  private mustFind(id: string): Order {
    const order = orders.find((o) => o.id === id);
    if (!order) throw new Error(`Order ${id} not found`);
    return order;
  }
}

class MockBillRepository implements BillRepository {
  async create(input: NewBillInput): Promise<Bill> {
    await delay(120);
    const bill = issueBill(input);
    // Manual bills reach the customer as an alert; order bills already do via
    // the order_update notification.
    if (bill.customerId && !bill.orderId) {
      notify({
        recipientId: bill.customerId,
        kind: 'bill_issued',
        title: `New bill · ${bill.businessName}`,
        body: `${bill.issuedByName} billed you ${formatMoney(bill.total)}.`,
        businessId: bill.businessId,
        billId: bill.id,
      });
    }
    return clone(bill);
  }

  async getById(id: string): Promise<Bill | null> {
    await delay(60);
    const found = bills.find((b) => b.id === id);
    return found ? clone(found) : null;
  }

  async listForBusiness(businessId: string): Promise<Bill[]> {
    await delay(80);
    return bills
      .filter((b) => b.businessId === businessId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async listForCustomer(customerId: string, businessId?: string): Promise<Bill[]> {
    await delay(80);
    return bills
      .filter((b) => b.customerId === customerId)
      .filter((b) => (businessId ? b.businessId === businessId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async sendToChat(billId: string, sentByName: string): Promise<void> {
    await delay(100);
    const bill = bills.find((b) => b.id === billId);
    if (!bill) throw new Error(`Bill ${billId} not found`);
    if (!bill.customerId) {
      throw new Error('This bill has no linked customer account to chat with.');
    }
    messages.push({
      id: nextId('m'),
      threadKey: threadKeyFor(bill.businessId, bill.customerId),
      authorType: 'business',
      authorName: sentByName,
      body: `Here’s your bill — total ${formatMoney(bill.total)}.`,
      billId: bill.id,
      createdAt: new Date().toISOString(),
    });
    notify({
      recipientId: bill.customerId,
      kind: 'chat_reply',
      title: `${sentByName} from ${bill.businessName}`,
      body: `🧾 Sent you a bill — ${formatMoney(bill.total)}.`,
      businessId: bill.businessId,
    });
  }

  async setPaymentStatus(billId: string, status: PaymentStatus, byName: string): Promise<Bill> {
    await delay(120);
    const bill = bills.find((b) => b.id === billId);
    if (!bill) throw new Error(`Bill ${billId} not found`);
    bill.paymentStatus = status;
    bill.paidByName = status === 'paid' ? byName : undefined;
    bill.paidAt = status === 'paid' ? new Date().toISOString() : undefined;

    // Tell the customer their payment landed — it's the receipt they'd
    // otherwise have to ask for.
    if (bill.customerId && status === 'paid') {
      notify({
        recipientId: bill.customerId,
        kind: 'bill_issued',
        title: `Payment received · ${bill.businessName}`,
        body: `${byName} marked your ${formatMoney(bill.total)} bill as paid.`,
        businessId: bill.businessId,
        billId: bill.id,
      });
    }
    return clone(bill);
  }
}

// ── Customers ───────────────────────────────────────────────────────────────

/** Favourite key for a bill: the user id when known, else a walk-in name key. */
const customerKeyForBill = (bill: Bill): string =>
  bill.customerId ?? `walkin:${bill.customerName.trim().toLowerCase()}`;

class MockCustomerRepository implements CustomerRepository {
  async listForBusiness(businessId: string): Promise<CustomerSummary[]> {
    await delay(90);
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return [];

    const byKey = new Map<string, CustomerSummary>();
    const touch = (key: string, name: string, at: string): CustomerSummary => {
      let c = byKey.get(key);
      if (!c) {
        c = {
          businessId,
          key,
          name,
          hasAccount: users.some((u) => u.id === key),
          favorite: false,
          orderCount: 0,
          bookingCount: 0,
          billCount: 0,
          callCount: 0,
          chatCount: 0,
          totalBilled: 0,
          lastActivityAt: at,
        };
        byKey.set(key, c);
      }
      if (at > c.lastActivityAt) {
        c.lastActivityAt = at;
        c.name = name; // Keep the freshest display name.
      }
      return c;
    };

    orders
      .filter((o) => o.businessId === businessId)
      .forEach((o) => (touch(o.customerId, o.customerName, o.createdAt).orderCount += 1));
    bookings
      .filter((b) => b.businessId === businessId)
      .forEach((b) => (touch(b.customerId, b.customerName, b.createdAt).bookingCount += 1));
    calls
      .filter((c) => c.businessId === businessId)
      .forEach((c) => (touch(c.customerId, c.customerName, c.startedAt).callCount += 1));
    bills
      .filter((b) => b.businessId === businessId)
      .forEach((b) => {
        const c = touch(customerKeyForBill(b), b.customerName, b.createdAt);
        c.billCount += 1;
        c.totalBilled += b.total;
      });
    const prefix = `${businessId}:`;
    messages
      .filter((m) => m.threadKey.startsWith(prefix))
      .forEach((m) => {
        const pid = m.threadKey.slice(prefix.length);
        touch(pid, participantName(pid), m.createdAt).chatCount += 1;
      });

    const favorites = new Set(business.favoriteCustomerIds ?? []);
    byKey.forEach((c) => (c.favorite = favorites.has(c.key)));

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
  }

  async setFavorite(businessId: string, customerKey: string, favorite: boolean): Promise<void> {
    await delay(60);
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);
    const current = new Set(business.favoriteCustomerIds ?? []);
    if (favorite) current.add(customerKey);
    else current.delete(customerKey);
    business.favoriteCustomerIds = Array.from(current);
  }
}

// ── Reviews ─────────────────────────────────────────────────────────────────

/**
 * The verified-customer gate: only someone who actually did business with the
 * listing may rate it — an accepted order, an accepted/completed booking, or a
 * bill in their name. Chats and calls alone don't count (anyone can message).
 */
function reviewEligibilityFor(businessId: string, customerId: string): ReviewEligibility {
  if (!customerId || customerId === 'guest') {
    return { eligible: false, reason: 'Sign in to rate businesses.' };
  }
  const business = businesses.find((b) => b.id === businessId);
  if (business?.ownerId === customerId) {
    return { eligible: false, reason: 'You can’t rate your own business.' };
  }
  const hasOrder = orders.some(
    (o) => o.businessId === businessId && o.customerId === customerId && o.status === 'accepted',
  );
  const hasBooking = bookings.some(
    (b) =>
      b.businessId === businessId &&
      b.customerId === customerId &&
      (b.status === 'accepted' || b.status === 'completed'),
  );
  const hasBill = bills.some(
    (b) => b.businessId === businessId && b.customerId === customerId,
  );
  if (hasOrder || hasBooking || hasBill) return { eligible: true };
  return {
    eligible: false,
    reason:
      'Ratings come only from verified customers. Place an order, book a service, or get billed by this business first — then you can rate your experience.',
  };
}

class MockReviewRepository implements ReviewRepository {
  async listForBusiness(businessId: string): Promise<Review[]> {
    await delay(70);
    return reviews
      .filter((r) => r.businessId === businessId)
      .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
      .map(clone);
  }

  async getMine(businessId: string, customerId: string): Promise<Review | null> {
    await delay(50);
    const found = reviews.find(
      (r) => r.businessId === businessId && r.customerId === customerId,
    );
    return found ? clone(found) : null;
  }

  async checkEligibility(businessId: string, customerId: string): Promise<ReviewEligibility> {
    await delay(60);
    return reviewEligibilityFor(businessId, customerId);
  }

  async submit(input: NewReviewInput): Promise<Review> {
    await delay(120);
    const rating = Math.round(input.rating);
    if (rating < 1 || rating > 5) throw new Error('Pick a rating from 1 to 5 stars.');
    const comment = input.comment?.trim() || undefined;
    if (rating <= 2 && !comment) {
      throw new Error(
        'Please write what went wrong — a reason is required with 1 and 2 star ratings.',
      );
    }

    const business = businesses.find((b) => b.id === input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);

    const existing = reviews.find(
      (r) => r.businessId === input.businessId && r.customerId === input.customerId,
    );
    // Editing an existing review stays allowed; only NEW reviews pass the gate.
    if (!existing) {
      const gate = reviewEligibilityFor(input.businessId, input.customerId);
      if (!gate.eligible) throw new Error(gate.reason ?? 'Only customers can rate this business.');
    }

    // Fold the rating into the business's aggregate. The seeded avg/count act
    // as the pre-existing history a real backend would hold.
    const count = business.ratingCount ?? 0;
    const avg = business.ratingAvg ?? 0;
    if (existing) {
      const total = avg * count - existing.rating + rating;
      business.ratingAvg = count > 0 ? Math.round((total / count) * 10) / 10 : rating;
      existing.rating = rating;
      existing.comment = comment;
      existing.customerName = input.customerName;
      existing.updatedAt = new Date().toISOString();
      return clone(existing);
    }

    business.ratingAvg = Math.round(((avg * count + rating) / (count + 1)) * 10) / 10;
    business.ratingCount = count + 1;

    const review: Review = {
      id: nextId('r'),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    };
    reviews.push(review);

    notify({
      recipientId: business.ownerId,
      kind: 'review_posted',
      title: `New ${rating}★ rating · ${business.name}`,
      body: comment ?? `${input.customerName} rated their experience ${rating} out of 5.`,
      businessId: business.id,
    });
    return clone(review);
  }
}

// ── Voice calls ─────────────────────────────────────────────────────────────

/** How long a call rings before it counts as missed. */
const RING_TIMEOUT_MS = 30_000;

/** Default window of the workspace call log: the last 7 days. */
const CALL_LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Expire calls that rang out. Run lazily at the top of every call method. */
function sweepCalls(): void {
  const now = Date.now();
  calls.forEach((call) => {
    if (call.status === 'ringing' && now - new Date(call.startedAt).getTime() > RING_TIMEOUT_MS) {
      call.status = 'missed';
      call.endedAt = new Date().toISOString();
      notifyMissedCall(call);
    }
  });
}

/** Tell every handler who was rung that they missed the customer. */
function notifyMissedCall(call: Call): void {
  call.participants
    .filter((p) => p.side === 'business')
    .forEach((p) =>
      notify({
        recipientId: p.id,
        kind: 'missed_call',
        title: `Missed call · ${call.businessName}`,
        body: `${call.customerName} tried to call.`,
        businessId: call.businessId,
      }),
    );
}

class MockCallRepository implements CallRepository {
  async start(businessId: string, customer: { id: string; name: string }): Promise<Call> {
    await delay(100);
    sweepCalls();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) throw new Error(`Business ${businessId} not found`);

    // Ring targets: the owner (unless they opted out) plus every call handler
    // with an app account. Employees without an account can't ring.
    const targets: CallParticipant[] = [];
    if (business.ownerHandlesCalls !== false) {
      const owner = users.find((u) => u.id === business.ownerId);
      targets.push({
        id: business.ownerId,
        name: owner?.name ?? 'Owner',
        side: 'business',
        roleLabel: 'Owner',
        state: 'ringing',
      });
    }
    const handlerIds = new Set(business.callHandlerIds ?? []);
    employees
      .filter(
        (e) =>
          e.businessId === businessId &&
          handlerIds.has(e.id) &&
          e.userId &&
          e.userId !== business.ownerId,
      )
      .forEach((e) =>
        targets.push({
          id: e.userId!,
          name: e.displayName,
          side: 'business',
          roleLabel: e.role ?? (e.level === 'manager' ? 'Manager' : 'Staff'),
          state: 'ringing',
        }),
      );
    // Never ring the caller themselves (they may be this business's owner or a
    // call-handler), and dedupe so one person can't appear twice — a duplicate
    // participant id crashes the session's participant list (React keys).
    const seen = new Set<string>([customer.id]);
    const ringTargets = targets.filter((t) => !seen.has(t.id) && seen.add(t.id));
    if (ringTargets.length === 0) {
      throw new Error(
        targets.some((t) => t.id === customer.id)
          ? "You're set to answer this business's calls yourself — there's no one else to ring."
          : 'No one at this business can take voice calls right now.',
      );
    }

    const call: Call = {
      id: nextId('c'),
      businessId,
      businessName: business.name,
      customerId: customer.id,
      customerName: customer.name,
      status: 'ringing',
      participants: [
        {
          id: customer.id,
          name: customer.name,
          side: 'customer',
          state: 'joined',
          joinedAt: new Date().toISOString(),
        },
        ...ringTargets,
      ],
      startedAt: new Date().toISOString(),
    };
    calls.push(call);
    return clone(call);
  }

  async getById(callId: string): Promise<Call | null> {
    await delay(40);
    sweepCalls();
    const found = calls.find((c) => c.id === callId);
    return found ? clone(found) : null;
  }

  async join(callId: string, participantId: string): Promise<Call> {
    await delay(60);
    sweepCalls();
    const call = this.mustFind(callId);
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new Error('This call has already ended.');
    }
    const p = call.participants.find((x) => x.id === participantId);
    if (!p) throw new Error('You are not part of this call.');
    p.state = 'joined';
    p.joinedAt = new Date().toISOString();
    p.leftAt = undefined;
    if (call.status === 'ringing') {
      call.status = 'active';
      call.answeredAt = p.joinedAt;
    }
    return clone(call);
  }

  async decline(callId: string, participantId: string): Promise<Call> {
    await delay(60);
    sweepCalls();
    const call = this.mustFind(callId);
    const p = call.participants.find((x) => x.id === participantId && x.side === 'business');
    if (p && p.state === 'ringing') p.state = 'declined';
    // When the last person who could pick up declines, the call is over.
    const anyoneLeft = call.participants.some(
      (x) => x.side === 'business' && (x.state === 'ringing' || x.state === 'joined'),
    );
    if (!anyoneLeft && (call.status === 'ringing' || call.status === 'active')) {
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = new Date().toISOString();
    }
    return clone(call);
  }

  async leave(callId: string, participantId: string): Promise<Call> {
    await delay(60);
    sweepCalls();
    const call = this.mustFind(callId);
    const p = call.participants.find((x) => x.id === participantId);
    if (!p) throw new Error('You are not part of this call.');
    const now = new Date().toISOString();
    p.state = 'left';
    p.leftAt = now;

    if (call.status === 'ringing' || call.status === 'active') {
      if (p.side === 'customer') {
        // The customer hanging up ends the call for everyone. Cancelling
        // while it still rings counts as a missed call for the business.
        const wasRinging = call.status === 'ringing';
        call.status = wasRinging ? 'missed' : 'ended';
        call.endedAt = now;
        if (wasRinging) notifyMissedCall(call);
      } else {
        const anyBusinessOn = call.participants.some(
          (x) => x.side === 'business' && x.state === 'joined',
        );
        if (call.status === 'active' && !anyBusinessOn) {
          call.status = 'ended';
          call.endedAt = now;
        }
      }
    }
    return clone(call);
  }

  async getIncomingForUser(userId: string): Promise<Call | null> {
    await delay(40);
    sweepCalls();
    // A call is "incoming" while this member's own state is still ringing —
    // full-screen ring when unanswered, a join prompt once a teammate picked up.
    const found = calls.find(
      (c) =>
        (c.status === 'ringing' || c.status === 'active') &&
        c.customerId !== userId &&
        c.participants.some((p) => p.side === 'business' && p.id === userId && p.state === 'ringing'),
    );
    return found ? clone(found) : null;
  }

  async listForBusiness(businessId: string, sinceIso?: string): Promise<Call[]> {
    await delay(80);
    // Sweep first so a call that rang out shows up as "missed" in the log.
    sweepCalls();
    const since = sinceIso
      ? new Date(sinceIso).getTime()
      : Date.now() - CALL_LOG_WINDOW_MS;
    return calls
      .filter((c) => c.businessId === businessId && new Date(c.startedAt).getTime() >= since)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(clone);
  }

  async getAudioToken(): Promise<{ token: string; url: string }> {
    // The in-memory mock has no media server. Live audio needs a real backend
    // (Supabase edge function or the Express API) that can mint LiveKit tokens.
    throw new Error('Live call audio needs the Supabase or API backend.');
  }

  private mustFind(callId: string): Call {
    const call = calls.find((c) => c.id === callId);
    if (!call) throw new Error(`Call ${callId} not found`);
    return call;
  }
}

// ── Live tracking ───────────────────────────────────────────────────────────

/**
 * Simulated GPS speed. Deliberately faster than a real vehicle so the demo
 * visibly moves within a few polls; a real backend streams true positions.
 */
const SIM_SPEED_KMH = 120;
/** Largest jump per read, so a long-idle share doesn't teleport off the map. */
const SIM_MAX_STEP_KM = 0.5;
/** Vehicles roam within this range of the business before turning back. */
const SIM_RANGE_KM = 4;

/** Direction from one point to another, in degrees from north. */
function bearingDeg(from: GeoPoint, to: GeoPoint): number {
  const dLat = to.latitude - from.latitude;
  const dLng =
    (to.longitude - from.longitude) * Math.cos((from.latitude * Math.PI) / 180);
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

/**
 * Advance every active share a little, based on real elapsed time — the mock
 * stand-in for the driver's phone streaming GPS. Run lazily on every read.
 */
function advanceShares(): void {
  const now = Date.now();
  locationShares.forEach((share) => {
    if (!share.active) return;
    const elapsedH = (now - new Date(share.updatedAt).getTime()) / 3_600_000;
    if (elapsedH <= 0) return;
    const stepKm = Math.min(elapsedH * SIM_SPEED_KMH, SIM_MAX_STEP_KM);

    // Wander freely near the business; steer home once out of range.
    const anchor =
      businesses.find((b) => b.id === share.businessId)?.location.point ?? CURRENT_POINT;
    share.heading =
      haversineKm(anchor, share.point) > SIM_RANGE_KM
        ? bearingDeg(share.point, anchor)
        : (share.heading + (Math.random() - 0.5) * 50 + 360) % 360;

    const rad = (share.heading * Math.PI) / 180;
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((share.point.latitude * Math.PI) / 180);
    share.point = {
      latitude: share.point.latitude + (Math.cos(rad) * stepKm) / kmPerDegLat,
      longitude: share.point.longitude + (Math.sin(rad) * stepKm) / kmPerDegLng,
    };
    share.updatedAt = new Date(now).toISOString();
  });
}

/** Number plates, normalised for comparison: only letters/digits, upper-cased. */
const canonicalReg = (reg?: string): string => (reg ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

class MockTrackingRepository implements TrackingRepository {
  async listVehicles(businessId: string): Promise<Vehicle[]> {
    await delay(70);
    return vehicles.filter((v) => v.businessId === businessId).map(clone);
  }

  async addVehicle(input: NewVehicleInput): Promise<Vehicle> {
    await delay(90);
    // No two vehicles in the same fleet share a number plate. Compare a
    // canonical form (strip spaces/dashes, upper-case) so "MP09 AB 1234" and
    // "mp09-ab-1234" count as the same plate.
    const reg = input.registrationNumber?.trim();
    if (reg) {
      const canonical = canonicalReg(reg);
      const clash = vehicles.some(
        (v) => v.businessId === input.businessId && canonicalReg(v.registrationNumber) === canonical,
      );
      if (clash) {
        throw new Error(`A vehicle with number ${reg} is already in this fleet.`);
      }
    }
    // Pet name is optional — the number plate (or kind) names the vehicle.
    const name =
      input.name?.trim() || input.registrationNumber?.trim() || getVehicleKind(input.kind).name;
    const vehicle: Vehicle = {
      id: nextId('v'),
      businessId: input.businessId,
      name,
      registrationNumber: input.registrationNumber?.trim() || undefined,
      kind: input.kind,
      driverEmployeeId: input.driverEmployeeId,
      createdAt: new Date().toISOString(),
    };
    vehicles.push(vehicle);
    return clone(vehicle);
  }

  async updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle> {
    await delay(70);
    const vehicle = vehicles.find((v) => v.id === id);
    if (!vehicle) throw new Error(`Vehicle ${id} not found`);
    Object.assign(vehicle, patch);
    return clone(vehicle);
  }

  async removeVehicle(id: string): Promise<void> {
    await delay(70);
    const index = vehicles.findIndex((v) => v.id === id);
    if (index >= 0) vehicles.splice(index, 1);
    // Items that rode on it fall back to "not assigned yet".
    trackedItems.forEach((t) => {
      if (t.vehicleId === id) t.vehicleId = undefined;
    });
  }

  async listItems(businessId: string): Promise<TrackedItem[]> {
    await delay(70);
    return trackedItems.filter((t) => t.businessId === businessId).map(clone);
  }

  async listItemsForCustomer(customerId: string, businessId?: string): Promise<TrackedItem[]> {
    await delay(70);
    return trackedItems
      .filter((t) => t.customerId === customerId)
      .filter((t) => (businessId ? t.businessId === businessId : true))
      .map(clone);
  }

  async addItem(input: NewTrackedItemInput): Promise<TrackedItem> {
    await delay(90);
    const item: TrackedItem = {
      id: nextId('t'),
      businessId: input.businessId,
      kind: input.kind,
      label: input.label.trim(),
      customerId: input.customerId,
      customerName: input.customerName,
      vehicleId: input.vehicleId,
      membershipId: input.membershipId,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    trackedItems.push(item);
    return clone(item);
  }

  async updateItem(id: string, patch: Partial<TrackedItem>): Promise<TrackedItem> {
    await delay(70);
    const item = trackedItems.find((t) => t.id === id);
    if (!item) throw new Error(`Tracked item ${id} not found`);
    Object.assign(item, patch);
    return clone(item);
  }

  async removeItem(id: string): Promise<void> {
    await delay(70);
    const index = trackedItems.findIndex((t) => t.id === id);
    if (index >= 0) trackedItems.splice(index, 1);
  }

  async setSharing(businessId: string, userId: string, active: boolean): Promise<void> {
    await delay(80);
    let share = locationShares.find((s) => s.businessId === businessId && s.userId === userId);
    if (!share) {
      // A fresh share starts from the business's own location.
      const anchor =
        businesses.find((b) => b.id === businessId)?.location.point ?? CURRENT_POINT;
      share = {
        businessId,
        userId,
        active: false,
        point: { ...anchor },
        heading: Math.random() * 360,
        updatedAt: new Date().toISOString(),
      };
      locationShares.push(share);
    }
    share.active = active;
    share.updatedAt = new Date().toISOString();
  }

  async isSharing(businessId: string, userId: string): Promise<boolean> {
    await delay(40);
    return !!locationShares.find((s) => s.businessId === businessId && s.userId === userId)
      ?.active;
  }

  async getLiveVehicles(businessId: string): Promise<LiveVehicle[]> {
    await delay(60);
    advanceShares();
    return vehicles
      .filter((v) => v.businessId === businessId)
      .map((v): LiveVehicle => {
        const driver = v.driverEmployeeId
          ? employees.find((e) => e.id === v.driverEmployeeId)
          : undefined;
        const share = driver?.userId
          ? locationShares.find(
              (s) => s.businessId === businessId && s.userId === driver.userId && s.active,
            )
          : undefined;
        return {
          vehicle: clone(v),
          driverName: driver?.displayName,
          sharing: !!share,
          point: share ? { ...share.point } : undefined,
          updatedAt: share?.updatedAt,
        };
      });
  }
}

/** Dev/testing: restore all in-memory state to the original seed data. */
// ── B2B chat ────────────────────────────────────────────────────────────────

/** One thread per pair of businesses, whichever side starts it. */
const bizThreadKey = (a: string, b: string) => [a, b].sort().join('|');

class MockBizChatRepository implements BizChatRepository {
  async listThreadsForUser(userId: string): Promise<BizThreadSummary[]> {
    await delay(80);
    // Every business this user owns or works at can appear as "my side".
    const mine = new Set(businesses.filter((b) => b.ownerId === userId).map((b) => b.id));
    employees.filter((e) => e.userId === userId).forEach((e) => mine.add(e.businessId));

    const threads = new Map<string, BizThreadSummary>();
    for (const m of [...bizMessages].sort((a, b) => a.at.localeCompare(b.at))) {
      const [a, b] = m.threadKey.split('|');
      const myId = mine.has(a) ? a : mine.has(b) ? b : null;
      if (!myId) continue;
      const otherId = myId === a ? b : a;
      threads.set(`${m.threadKey}:${myId}`, {
        threadKey: m.threadKey,
        businessId: myId,
        businessName: businesses.find((x) => x.id === myId)?.name ?? 'My business',
        otherBusinessId: otherId,
        otherBusinessName: businesses.find((x) => x.id === otherId)?.name ?? 'Business',
        lastBody: m.body,
        lastAt: m.at,
        lastFromBusinessId: m.fromBusinessId,
      });
    }
    return [...threads.values()].sort((x, y) => y.lastAt.localeCompare(x.lastAt));
  }

  async listMessages(businessA: string, businessB: string): Promise<BizChatMessage[]> {
    await delay(60);
    const key = bizThreadKey(businessA, businessB);
    return bizMessages
      .filter((m) => m.threadKey === key)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((m) => ({
        ...m,
        // Live name, in case the business was renamed since.
        fromBusinessName:
          businesses.find((x) => x.id === m.fromBusinessId)?.name ?? m.fromBusinessName,
      }));
  }

  async send(input: NewBizMessageInput): Promise<BizChatMessage[]> {
    await delay(80);
    const from = businesses.find((b) => b.id === input.fromBusinessId);
    if (!from) throw new Error(`Business ${input.fromBusinessId} not found`);
    bizMessages.push({
      id: nextId('bm'),
      threadKey: bizThreadKey(input.fromBusinessId, input.toBusinessId),
      fromBusinessId: input.fromBusinessId,
      fromBusinessName: from.name,
      authorName: input.authorName,
      body: input.body,
      at: new Date().toISOString(),
    });
    return this.listMessages(input.fromBusinessId, input.toBusinessId);
  }
}

// ── Memberships ─────────────────────────────────────────────────────────────

/** Same day next month(s) — billing cycles and renewal dates. */
function addMonths(iso: string | Date, n: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Two cycle timestamps land in the same billing cycle (same month + year). */
function sameCycle(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

/** Build a membership's current-cycle payment standing from its logged payments. */
function paymentSummary(membershipId: string, periodStart: Date): Membership['payment'] {
  const mine = membershipPayments.filter((p) => p.membershipId === membershipId);
  const approved = mine.filter((p) => p.status === 'approved');
  const cyclePays = mine.filter((p) => sameCycle(p.periodStart, periodStart.toISOString()));
  const pending = cyclePays.find((p) => p.status === 'pending');
  const status: 'paid' | 'pending' | 'unpaid' = cyclePays.some((p) => p.status === 'approved')
    ? 'paid'
    : pending
      ? 'pending'
      : 'unpaid';
  const daysOverdue =
    status === 'unpaid'
      ? Math.max(0, Math.floor((Date.now() - periodStart.getTime()) / 86_400_000))
      : 0;
  return {
    status,
    periodStart: periodStart.toISOString(),
    daysOverdue,
    monthsPaid: approved.length,
    totalPaid: approved.reduce((sum, p) => sum + p.amount, 0),
    pendingPaymentId: pending?.id,
  };
}

class MockMembershipRepository implements MembershipRepository {
  /** Fill in the current billing cycle + live business name on the way out. */
  private hydrate(m: Membership): Membership {
    const now = new Date();
    let renewed = new Date(m.startedAt);
    while (m.status === 'active' && addMonths(renewed, 1) <= now) {
      renewed = addMonths(renewed, 1);
    }
    const base: Membership = {
      ...m,
      businessName: businesses.find((b) => b.id === m.businessId)?.name ?? m.businessName,
      renewedAt: renewed.toISOString(),
      expiresAt: addMonths(renewed, 1).toISOString(),
    };
    // Only active plans carry a live payment standing.
    if (m.status !== 'active') return base;
    return { ...base, payment: paymentSummary(m.id, renewed) };
  }

  async listForCustomer(customerId: string): Promise<Membership[]> {
    await delay(80);
    return memberships
      .filter((m) => m.customerId === customerId && m.status === 'active' && !m.standalone)
      .map((m) => this.hydrate(m))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async monthlySpend(customerId: string): Promise<MonthlySpend[]> {
    await delay(80);
    // Cancelled plans still count for the months they actually ran; pending
    // requests and rejected ones never billed, so they're left out.
    const mine = memberships
      .filter(
        (m) =>
          m.customerId === customerId &&
          !m.standalone &&
          (m.status === 'active' || m.status === 'cancelled'),
      )
      .map((m) => this.hydrate(m));
    if (mine.length === 0) return [];
    const now = new Date();
    const earliest = mine.reduce(
      (min, m) => (m.startedAt < min ? m.startedAt : min),
      mine[0].startedAt,
    );
    const first = new Date(earliest);
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const months: MonthlySpend[] = [];
    while (cursor <= currentMonth) {
      const monthEnd = addMonths(cursor, 1);
      const lines = mine
        .filter(
          (m) =>
            new Date(m.startedAt) < monthEnd && (!m.endedAt || new Date(m.endedAt) >= cursor),
        )
        .map((m) => ({
          businessName: m.businessName,
          planName: m.planName,
          amount: m.pricePerMonth,
        }));
      months.push({
        month: cursor.toISOString(),
        total: lines.reduce((sum, l) => sum + l.amount, 0),
        lines,
      });
      cursor = monthEnd;
    }
    // Newest first — the breakdown popup pages backwards through these.
    return months.reverse();
  }

  async listForBusiness(businessId: string): Promise<Membership[]> {
    await delay(80);
    return memberships
      .filter((m) => m.businessId === businessId && m.status === 'active')
      .map((m) => this.hydrate(m))
      .sort((a, b) => a.customerName.localeCompare(b.customerName));
  }

  async listCancelledForBusiness(businessId: string): Promise<Membership[]> {
    await delay(80);
    return memberships
      .filter((m) => m.businessId === businessId && m.status === 'cancelled')
      .map((m) => this.hydrate(m))
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  }

  async getById(id: string): Promise<Membership | null> {
    await delay(60);
    const m = memberships.find((x) => x.id === id);
    return m ? this.hydrate(m) : null;
  }

  async listRequests(businessId: string): Promise<Membership[]> {
    await delay(80);
    return memberships
      .filter((m) => m.businessId === businessId && m.status === 'pending')
      .map((m) => this.hydrate(m))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async add(input: NewMembershipInput): Promise<Membership> {
    await delay();
    const business = businesses.find((b) => b.id === input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);
    const started = new Date();
    const membership: Membership = {
      id: nextId('m'),
      businessId: input.businessId,
      businessName: business.name,
      customerId: input.customerId,
      customerName: input.customerName,
      enrolleeName: input.enrolleeName?.trim() || undefined,
      planName: input.planName,
      pricePerMonth: input.pricePerMonth,
      startedAt: started.toISOString(),
      renewedAt: started.toISOString(),
      expiresAt: addMonths(started, 1).toISOString(),
      status: 'active',
    };
    memberships.push(membership);
    return { ...membership };
  }

  async request(input: EnrollRequestInput): Promise<Membership> {
    await delay();
    const business = businesses.find((b) => b.id === input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);
    // A pending request carries no billing yet — the business sets the plan
    // name and price when they accept. Dates are placeholders until then.
    const now = new Date();
    const membership: Membership = {
      id: nextId('m'),
      businessId: input.businessId,
      businessName: business.name,
      customerId: input.customerId,
      customerName: input.customerName,
      planName: input.requestedPlan?.trim() || 'Enrolment request',
      requestedPlan: input.requestedPlan?.trim() || undefined,
      requestedPrice: input.requestedPrice,
      enrolleeName: input.enrolleeName?.trim() || undefined,
      pricePerMonth: 0,
      startedAt: now.toISOString(),
      renewedAt: now.toISOString(),
      expiresAt: addMonths(now, 1).toISOString(),
      status: 'pending',
    };
    memberships.push(membership);
    // "‹customer›" or "‹customer› (for ‹child›)" when the plan is for someone else.
    const who = input.enrolleeName?.trim()
      ? `${input.customerName} (for ${input.enrolleeName.trim()})`
      : input.customerName;
    notify({
      recipientId: business.ownerId,
      kind: 'enroll_requested',
      title: `New enrolment request · ${business.name}`,
      body: input.requestedPlan?.trim()
        ? `${who} wants to enrol: “${input.requestedPlan.trim()}”.`
        : `${who} wants to enrol — set their plan to confirm.`,
      businessId: business.id,
    });
    return { ...membership };
  }

  async accept(id: string, input: AcceptEnrollInput): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    if (membership.status !== 'pending') {
      throw new Error('This request was already responded to.');
    }
    const started = new Date();
    membership.planName = input.planName;
    membership.pricePerMonth = input.pricePerMonth;
    membership.startedAt = started.toISOString();
    membership.renewedAt = started.toISOString();
    membership.expiresAt = addMonths(started, 1).toISOString();
    membership.status = 'active';
    notify({
      recipientId: membership.customerId,
      kind: 'enroll_update',
      title: `Enrolment confirmed · ${membership.businessName}`,
      body: `You're enrolled in ${input.planName} — ${formatMoney(input.pricePerMonth)}/mo. See it in your Subscriptions.`,
      businessId: membership.businessId,
    });
    return this.hydrate(membership);
  }

  async reject(id: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    if (membership.status !== 'pending') {
      throw new Error('This request was already responded to.');
    }
    membership.status = 'rejected';
    membership.endedAt = new Date().toISOString();
    notify({
      recipientId: membership.customerId,
      kind: 'enroll_update',
      title: `Enrolment declined · ${membership.businessName}`,
      body: `${membership.businessName} couldn't take your enrolment request right now.`,
      businessId: membership.businessId,
    });
    return this.hydrate(membership);
  }

  async cancel(id: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    membership.status = 'cancelled';
    membership.endedAt = new Date().toISOString();
    return this.hydrate(membership);
  }

  async reenroll(id: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    // Fresh billing cycle from today; keep the plan name and price.
    const started = new Date();
    membership.status = 'active';
    membership.startedAt = started.toISOString();
    membership.renewedAt = started.toISOString();
    membership.expiresAt = addMonths(started, 1).toISOString();
    membership.endedAt = undefined;
    if (!membership.standalone) {
      notify({
        recipientId: membership.customerId,
        kind: 'enroll_update',
        title: `Re-enrolled · ${membership.businessName}`,
        body: `You're back on ${membership.planName} — ${formatMoney(membership.pricePerMonth)}/mo. See it in your Subscriptions.`,
        businessId: membership.businessId,
      });
    }
    return this.hydrate(membership);
  }

  async setStartDate(id: string, startedAt: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    const when = new Date(startedAt);
    if (isNaN(when.getTime())) throw new Error('Enter a valid date.');
    if (when.getTime() > Date.now()) throw new Error('The enrolment date can’t be in the future.');
    membership.startedAt = when.toISOString();
    // The current cycle is recomputed from startedAt on hydrate.
    return this.hydrate(membership);
  }

  async reassign(id: string, toCustomerId: string, toCustomerName: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    // Keep the enrollee identifiable under the new parent: a membership with no
    // "for ‹child›" label carries its old holder's name across as the enrollee.
    if (!membership.enrolleeName && membership.customerName) {
      membership.enrolleeName = membership.customerName;
    }
    membership.customerId = toCustomerId;
    membership.customerName = toCustomerName;
    membership.standalone = false;
    if (membership.status === 'active') {
      notify({
        recipientId: toCustomerId,
        kind: 'enroll_update',
        title: `Plan moved to your account · ${membership.businessName}`,
        body: `“${membership.planName}”${
          membership.enrolleeName ? ` for ${membership.enrolleeName}` : ''
        } is now on your account — ${formatMoney(membership.pricePerMonth)}/mo. See it in your Subscriptions.`,
        businessId: membership.businessId,
      });
    }
    return this.hydrate(membership);
  }

  async detach(id: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    // Becomes its own member: the enrollee's name is now the member's own name,
    // with a non-user id so it bills no one and leaves every Subscriptions tab.
    membership.customerName = membership.enrolleeName || membership.customerName;
    membership.customerId = `standalone:${membership.id}`;
    membership.enrolleeName = undefined;
    membership.standalone = true;
    return this.hydrate(membership);
  }

  async renameEnrollee(id: string, name: string): Promise<Membership> {
    await delay();
    const membership = memberships.find((m) => m.id === id);
    if (!membership) throw new Error(`Membership ${id} not found`);
    const clean = name.trim();
    if (!clean) throw new Error('Enter a name.');
    // A nested child edits its enrollee label; a standalone member (or a plain
    // self-enrolment) edits its own name.
    if (membership.enrolleeName && !membership.standalone) {
      membership.enrolleeName = clean;
    } else {
      membership.customerName = clean;
    }
    return this.hydrate(membership);
  }

  async listPayments(membershipId: string): Promise<MembershipPayment[]> {
    await delay(80);
    return membershipPayments
      .filter((p) => p.membershipId === membershipId)
      .map(clone)
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.reportedAt.localeCompare(a.reportedAt));
  }

  async reportPayment(input: ReportPaymentInput): Promise<MembershipPayment> {
    await delay();
    const m = memberships.find((x) => x.id === input.membershipId);
    if (!m) throw new Error(`Membership ${input.membershipId} not found`);
    // One live payment per cycle — block a second report while one stands.
    const live = membershipPayments.find(
      (p) =>
        p.membershipId === m.id &&
        sameCycle(p.periodStart, input.periodStart) &&
        p.status !== 'rejected',
    );
    if (live) {
      throw new Error(
        live.status === 'approved' ? 'This month is already paid.' : 'This month is already reported.',
      );
    }
    const pay: MembershipPayment = {
      id: nextId('pay'),
      membershipId: m.id,
      businessId: m.businessId,
      customerId: m.customerId,
      periodStart: input.periodStart,
      amount: m.pricePerMonth,
      status: 'pending',
      method: input.method,
      paidToName: input.paidToName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      reportedBy: 'customer',
      reportedByName: m.customerName,
      reportedAt: new Date().toISOString(),
    };
    membershipPayments.push(pay);
    const business = businesses.find((b) => b.id === m.businessId);
    if (business) {
      notify({
        recipientId: business.ownerId,
        kind: 'payment_reported',
        title: `Payment reported · ${business.name}`,
        body: `${m.customerName}${m.enrolleeName ? ` (for ${m.enrolleeName})` : ''} says they paid ${formatMoney(
          m.pricePerMonth,
        )} for ${m.planName}. Approve it.`,
        businessId: business.id,
        membershipId: m.id,
      });
    }
    return clone(pay);
  }

  async recordPayment(input: ReportPaymentInput & { byName: string }): Promise<MembershipPayment> {
    await delay();
    const m = memberships.find((x) => x.id === input.membershipId);
    if (!m) throw new Error(`Membership ${input.membershipId} not found`);
    const live = membershipPayments.find(
      (p) =>
        p.membershipId === m.id &&
        sameCycle(p.periodStart, input.periodStart) &&
        p.status === 'approved',
    );
    if (live) throw new Error('This month is already paid.');
    const now = new Date().toISOString();
    const pay: MembershipPayment = {
      id: nextId('pay'),
      membershipId: m.id,
      businessId: m.businessId,
      customerId: m.customerId,
      periodStart: input.periodStart,
      amount: m.pricePerMonth,
      status: 'approved',
      method: input.method,
      paidToName: input.paidToName?.trim() || undefined,
      note: input.note?.trim() || undefined,
      reportedBy: 'business',
      reportedByName: input.byName,
      reportedAt: now,
      decidedByName: input.byName,
      decidedAt: now,
    };
    membershipPayments.push(pay);
    // Let the customer know it's on record (skip standalone — no account).
    if (!m.standalone) {
      notify({
        recipientId: m.customerId,
        kind: 'payment_update',
        title: `Payment recorded · ${m.businessName}`,
        body: `${input.byName} recorded your ${formatMoney(m.pricePerMonth)} payment for ${m.planName}.`,
        businessId: m.businessId,
        membershipId: m.id,
      });
    }
    return clone(pay);
  }

  async approvePayment(id: string, byName: string): Promise<MembershipPayment> {
    await delay();
    const pay = membershipPayments.find((p) => p.id === id);
    if (!pay) throw new Error(`Payment ${id} not found`);
    if (pay.status !== 'pending') throw new Error('This payment was already decided.');
    pay.status = 'approved';
    pay.decidedByName = byName;
    pay.decidedAt = new Date().toISOString();
    const m = memberships.find((x) => x.id === pay.membershipId);
    if (m && !m.standalone) {
      notify({
        recipientId: m.customerId,
        kind: 'payment_update',
        title: `Payment approved · ${m.businessName}`,
        body: `Your ${formatMoney(pay.amount)} payment for ${m.planName} was confirmed.`,
        businessId: m.businessId,
        membershipId: m.id,
      });
    }
    return clone(pay);
  }

  async rejectPayment(id: string, byName: string): Promise<MembershipPayment> {
    await delay();
    const pay = membershipPayments.find((p) => p.id === id);
    if (!pay) throw new Error(`Payment ${id} not found`);
    if (pay.status !== 'pending') throw new Error('This payment was already decided.');
    pay.status = 'rejected';
    pay.decidedByName = byName;
    pay.decidedAt = new Date().toISOString();
    const m = memberships.find((x) => x.id === pay.membershipId);
    if (m && !m.standalone) {
      notify({
        recipientId: m.customerId,
        kind: 'payment_update',
        title: `Payment not confirmed · ${m.businessName}`,
        body: `${byName} couldn't confirm your ${formatMoney(pay.amount)} payment for ${m.planName}. Please check with them.`,
        businessId: m.businessId,
        membershipId: m.id,
      });
    }
    return clone(pay);
  }
}

export function resetMockData(): void {
  // Users + places always come back; the rest follows the SEED_CONTENT flag.
  users.splice(0, users.length, ...seedUsers.map((u) => ({ ...u })));
  places.splice(0, places.length, ...seedPlaces.map((p) => ({ ...p })));
  employees.splice(0, employees.length, ...seed(seedEmployees));
  businesses.splice(0, businesses.length, ...seed(seedBusinesses));
  messages.splice(0, messages.length);
  notifications.splice(0, notifications.length);
  bookings.splice(0, bookings.length);
  orders.splice(0, orders.length);
  bills.splice(0, bills.length);
  calls.splice(0, calls.length);
  reviews.splice(0, reviews.length, ...seed(seedReviews));
  memberships.splice(0, memberships.length, ...seed(seedMemberships));
  membershipPayments.splice(0, membershipPayments.length);
  bizMessages.splice(0, bizMessages.length, ...seed(seedBizChat));
  vehicles.splice(0, vehicles.length, ...seed(seedVehicles));
  trackedItems.splice(0, trackedItems.length, ...seed(seedTrackedItems));
  locationShares.splice(0, locationShares.length, ...seed(seedLocationShares));
  logEntries.splice(0, logEntries.length, ...seed(seedLogEntries));
  currentUserId = null;
}

/**
 * Push registration, mocked. There is no push server behind the mock backend
 * (and no device token off a real build), so this just remembers the tokens so
 * register/unregister behave sanely. Nothing ever rings from here.
 */
class MockPushRepository implements PushRepository {
  async register(token: string, platform: string): Promise<void> {
    await delay(30);
    pushTokens.set(token, platform);
  }

  async unregister(token: string): Promise<void> {
    await delay(30);
    pushTokens.delete(token);
  }

  async isRegistered(token: string): Promise<boolean> {
    await delay(30);
    return pushTokens.has(token);
  }
}

class MockLogbookRepository implements LogbookRepository {
  async listForBusiness(businessId: string): Promise<LogEntry[]> {
    await delay(80);
    const derived = orders.filter((o) => o.businessId === businessId).map(orderLogEntry);
    const manual = logEntries.filter((l) => l.businessId === businessId).map(clone);
    return [...derived, ...manual].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addManual(input: NewLogEntryInput): Promise<LogEntry> {
    await delay(100);
    const entry: LogEntry = {
      id: nextId('log'),
      businessId: input.businessId,
      source: 'manual',
      title: input.title.trim(),
      details: input.details?.trim() || undefined,
      amount: input.amount,
      customerName: input.customerName?.trim() || undefined,
      recordedByName: input.recordedByName,
      createdAt: new Date().toISOString(),
    };
    if (!entry.title) throw new Error('Give the record a title.');
    logEntries.push(entry);
    return clone(entry);
  }
}

// ── Ads ─────────────────────────────────────────────────────────────────────

/**
 * The paid ad slot (domain/ads.ts). A business promotes an `Offer` it already
 * built, an admin approves it, and it runs for the window it bought — reaching
 * further than a free offer and sorting ahead of them on Home.
 *
 * The mock enforces the same rules the RLS policies do on the real backend
 * (migration 0014): a request always lands as `pending`, so nothing here can
 * put itself on air. The reach rules themselves are shared code, not a second
 * copy — see data/adPlacements.ts.
 */
class MockAdRepository implements AdRepository {
  async listPlacements(near?: GeoPoint, options?: PlacementOptions): Promise<AdPlacement[]> {
    await delay(70);
    const now = Date.now();
    const running = adCampaigns.filter((c) => isCampaignRunning(c, now));
    return clone(buildPlacements(running, businesses, near, now, options?.radiusKm));
  }

  async listForBusiness(businessId: string): Promise<AdCampaign[]> {
    await delay(60);
    return adCampaigns
      .filter((c) => c.businessId === businessId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map(clone);
  }

  async listAll(): Promise<AdCampaign[]> {
    await delay(60);
    return [...adCampaigns]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map(clone);
  }

  async request(input: NewAdCampaignInput): Promise<AdCampaign> {
    await delay(120);
    const plan = getAdPlan(input.planId);
    if (!plan) throw new Error('Pick a plan to promote this offer.');

    const business = businesses.find((b) => b.id === input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);

    const offer = (business.offers ?? []).find((o) => o.id === input.offerId);
    if (!offer) throw new Error('That offer no longer exists — pick another one.');
    if (!isOfferLive(offer)) {
      throw new Error('That offer is paused or finished. Switch it back on before promoting it.');
    }

    // One live campaign per offer — paying twice for the same card would just
    // buy a duplicate of yourself in the carousel.
    const clash = adCampaigns.find(
      (c) =>
        c.businessId === input.businessId &&
        c.offerId === input.offerId &&
        (c.status === 'pending' || isCampaignRunning(c)),
    );
    if (clash) {
      throw new Error(
        clash.status === 'pending'
          ? 'This offer is already waiting for review.'
          : 'This offer is already being promoted.',
      );
    }

    const campaign: AdCampaign = {
      id: nextId('ad'),
      businessId: input.businessId,
      businessName: business.name,
      offerId: input.offerId,
      planId: plan.id,
      // Frozen from the plan, so a later price change never rewrites what this
      // business was quoted.
      targetViews: plan.views,
      withinKm: plan.withinKm,
      days: plan.days,
      amount: plan.amount,
      status: 'pending',
      paid: false,
      requestedAt: new Date().toISOString(),
      requestedById: input.requestedById,
      requestedByName: input.requestedByName,
      impressions: 0,
      taps: 0,
      viewsNear: 0,
      viewsByBand: {},
    };
    adCampaigns.push(campaign);
    return clone(campaign);
  }

  async approve(id: string, note?: string): Promise<AdCampaign> {
    await delay(100);
    const campaign = this.find(id);
    // The run starts at approval, not at request, so a slow review never eats
    // into what was paid for.
    const startsAt = new Date();
    campaign.status = 'active';
    campaign.startsAt = startsAt.toISOString();
    campaign.endsAt = new Date(startsAt.getTime() + campaign.days * 86_400_000).toISOString();
    campaign.reviewedAt = startsAt.toISOString();
    campaign.reviewNote = note?.trim() || undefined;

    const business = businesses.find((b) => b.id === campaign.businessId);
    if (business) {
      notify({
        recipientId: business.ownerId,
        kind: 'ad_update',
        title: `📣 Your ad is live · ${campaign.businessName}`,
        body: `${campaignPlanSummary(campaign)}. We'll keep it running until those views land.`,
        businessId: campaign.businessId,
      });
    }
    return clone(campaign);
  }

  async reject(id: string, note?: string): Promise<AdCampaign> {
    await delay(100);
    const campaign = this.find(id);
    campaign.status = 'rejected';
    campaign.reviewedAt = new Date().toISOString();
    campaign.reviewNote = note?.trim() || undefined;

    const business = businesses.find((b) => b.id === campaign.businessId);
    if (business) {
      notify({
        recipientId: business.ownerId,
        kind: 'ad_update',
        title: `Ad request not approved · ${campaign.businessName}`,
        body: campaign.reviewNote ?? 'Your promoted offer was not approved this time.',
        businessId: campaign.businessId,
      });
    }
    return clone(campaign);
  }

  async stop(id: string): Promise<AdCampaign> {
    await delay(90);
    const campaign = this.find(id);
    campaign.status = 'stopped';
    campaign.endsAt = new Date().toISOString();
    return clone(campaign);
  }

  async setPaid(id: string, paid: boolean): Promise<AdCampaign> {
    await delay(80);
    const campaign = this.find(id);
    campaign.paid = paid;
    return clone(campaign);
  }

  // Counters never throw: they fire from a carousel someone is scrolling past.
  async recordImpression(id: string, distanceKm?: number): Promise<void> {
    const campaign = adCampaigns.find((c) => c.id === id);
    if (!campaign || !isCampaignRunning(campaign)) return;
    campaign.impressions += 1;

    // Where the viewer stood is the product: only views from inside the band
    // the business bought count toward its promise, and every view is bucketed
    // so the business can see who its audience actually was.
    const band = viewBandKey(distanceKm);
    campaign.viewsByBand = { ...campaign.viewsByBand, [band]: (campaign.viewsByBand?.[band] ?? 0) + 1 };
    const goal = campaignGoal(campaign);
    if (goal && distanceKm !== undefined && distanceKm <= goal.withinKm) {
      campaign.viewsNear = (campaign.viewsNear ?? 0) + 1;
    }
  }

  async recordTap(id: string): Promise<void> {
    const campaign = adCampaigns.find((c) => c.id === id);
    if (campaign && isCampaignRunning(campaign)) campaign.taps += 1;
  }

  private find(id: string): AdCampaign {
    const campaign = adCampaigns.find((c) => c.id === id);
    if (!campaign) throw new Error('That ad campaign no longer exists.');
    return campaign;
  }
}

export function createMockRepositories(): Repositories {
  return {
    businesses: new MockBusinessRepository(),
    catalog: new MockCatalogRepository(),
    employees: new MockEmployeeRepository(),
    users: new MockUserRepository(),
    auth: new MockAuthRepository(),
    places: new MockPlacesRepository(),
    chat: new MockChatRepository(),
    notifications: new MockNotificationRepository(),
    bookings: new MockBookingRepository(),
    orders: new MockOrderRepository(),
    bills: new MockBillRepository(),
    calls: new MockCallRepository(),
    customers: new MockCustomerRepository(),
    tracking: new MockTrackingRepository(),
    reviews: new MockReviewRepository(),
    memberships: new MockMembershipRepository(),
    bizChat: new MockBizChatRepository(),
    productThreads: new MockProductThreadRepository(),
    logbook: new MockLogbookRepository(),
    push: new MockPushRepository(),
    ads: new MockAdRepository(),
  };
}
