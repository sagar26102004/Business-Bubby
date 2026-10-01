@AGENTS.md

# Localo — Project Guide

This file is auto-loaded at the start of every session. Read it first to understand the whole project, then dive into the files it points to.

## What the app is

**Localo** is a local business directory + marketplace (Expo / React Native). Anyone can browse businesses around them; anyone signed in can list one. A "business" is generic — it covers four **listing types**:

- **service** — a service provider (e.g. "Arvind Transport Services")
- **shop** — an ongoing shop selling goods (cafe, restaurant, bakery, handcrafts…); shops can have a **menu**
- **item** — an individual's **personal stall**: ONE listing per user that holds everything they're selling as `products` (their phone AND their car live in the same stall). Auto-created on their first item as "‹Name›'s Stall" (`defaultStallName` in catalog.ts, renameable in Manage); each product carries its own `subcategoryId` so the **Stalls** browse tile's chips filter by what's inside the stall.
- **rental** — something rented out (flat, car, bike, furniture…)

Businesses have a **team hierarchy** (owner → managers → staff), can receive **customer chats** and **calls**, and customers get **notifications** when a business replies.

## Architecture (designed for easy change)

Each folder under `src/` has a single job — `app/` is routes ONLY, `domain/` holds entities and the catalogs they're built from, `data/` the repository interfaces + implementations, `features/` composed feature UI, `components/ui/` reusable primitives, `theme/` all design tokens, `lib/` small helpers.

**The golden rule: screens depend on repository *interfaces*, never on a concrete backend.**
- All data access goes through `useRepositories()` / `useAuth()` from `@/data/DataProvider`.
- Interfaces live in `src/data/repositories.ts` (18 repositories) — read that file for the current set.
- **To move to a real backend**: implement the same interfaces and change the ONE selector in `DataProvider.tsx`. Nothing else changes.

## Backends — TWO of them, one shared frontend

Localo deliberately supports **two interchangeable real backends** behind the same `Repositories` interfaces, chosen by an env var so the whole app can switch providers in one line. The frontend (every screen, `src/data/repositories.ts`, `src/domain/types.ts`) is IDENTICAL for both. There are three repository implementations:

1. **mock** — `src/data/mock/mockRepositories.ts`. In-memory, dev/offline. **This is the behavioural spec** both real backends must match method-for-method (it holds all the real logic: order proposals/dine-in tabs/`moveToBilling`, membership billing-cycle math + payment summaries, customer aggregation, review eligibility, call state machine, tracking, stall folding, etc.).
2. **supabase** (Path A) — `src/data/supabase/`. App talks straight to Supabase (Postgres + Auth + RLS + auto REST). **FULLY BUILT (2026-07-23)** — ALL 18 repos implemented here (`places` is device GPS, client-side); `createSupabaseRepositories()` returns a pure Supabase set with NO mock delegation. This is the backend in use for testing (`.env` → `EXPO_PUBLIC_BACKEND=supabase`). Two RLS-driven adaptations vs the mock: ratingAvg/ratingCount are computed live from `reviews` on read (a customer can't update a business), and a customer accepting a price proposal leaves the order a confirmed open tab the business bills via Move-to-billing. `notify()` is best-effort so a blocked notification never fails the core write. The notifications INSERT policy must stay PERMISSIVE (`auth.uid() is not null`), because notifications are written as side effects for OTHER users from the acting user's session; hardened to recipient-only, every cross-user alert vanishes silently and a business simply never hears about an order. It was once hand-tightened in the dashboard, which is why `supabase/migrations/0003_notifications_insert_permissive.sql` exists — **verified correct on the live DB 2026-08-16**, and `supabase/scripts/check_security_state.sql` now checks it on every run. Schema + RLS live in `supabase/migrations/` (**document model**: every table is `data jsonb` = the full domain object + scoping columns owner_id/customer_id/business_id/… that RLS keys on).
3. **api** (Path B) — **BUILT.** A custom **Node/Express + Prisma** server in `backend/` plus a frontend HTTP client `src/data/api/` implementing the same interfaces via `fetch`. This is the "routers → services" backend (thin routers with authz guards; logic in `backend/src/services/`, a faithful port of the mock). ALL 18 repositories are implemented except `places` (device GPS — client-side, like Path A). Swagger at `/docs`. Selected by `EXPO_PUBLIC_BACKEND=api` (+ `EXPO_PUBLIC_API_URL`). See `backend/README.md`.

**The switch** (to wire in `DataProvider.tsx` when Path B lands): `.env` → `EXPO_PUBLIC_BACKEND=supabase|api|mock`. Path B also needs `EXPO_PUBLIC_API_URL`. (Today `DataProvider` just auto-picks supabase when `isSupabaseConfigured`; generalise it to read `EXPO_PUBLIC_BACKEND`.)

**⚠️ STANDING RULE — Supabase-first, queue Path B (token-saving workflow).** To avoid paying twice for every change, do NOT edit both backends in the same pass. Instead:

1. **Make the change in the Supabase backend ONLY** (`src/data/supabase/`), plus any shared `src/domain/types.ts` / `src/data/repositories.ts` / `src/data/mock/` edits and SQL migration. Keep it behaviour-identical to the interface + mock.
2. **Append a self-contained entry to `backend/SYNC_QUEUE.md`** describing exactly what Path B (`backend/` + `src/data/api/`) needs — precise files, logic, endpoints, authz, migration. Use the entry format documented at the top of that file, next free `[SYNC-NNN]` number. Keep entries SMALL and atomic so an interrupted sync can resume. **You must maintain this queue yourself** — add an entry every time you touch data behaviour on the Supabase side.
3. **Later, `/update-backend`** (`.claude/commands/update-backend.md`) reads the queue, applies each entry to Path B one at a time, and **deletes each entry as it lands** — so tokens spent on Path B are batched and interruptible.

The end state is still both backends behaviour-identical to the mock; the queue is just the deferred to-do list. Never migrate/patch Supabase and forget to queue the Path B twin.

### "create the backend" — build trigger

When Sagar says **"create the backend"** (or similar), the full from-scratch build plan for Path B lives in the **`create-backend` skill** (`.claude/skills/create-backend/SKILL.md`) — load it. Do NOT ask him to re-supply context; it all lives in the repo.

### Current backend status (as of this writing)
DB is LIVE (document model, RLS, `handle_new_user` signup trigger, `is_business_member` helper). **Path A (Supabase) is fully BUILT (2026-07-23) and is the backend in use for testing** — every repo runs on the live Supabase Postgres, no mock delegation; 10 test users seeded via auth signup (phones 9812340001–10, password `localo123`). **Path B (api) is also fully BUILT** in `backend/` — all repositories except `places` implemented as Express services over the same Supabase Postgres (Prisma, privileged connection bypassing RLS; authz reimplemented in `backend/src/authz.ts`), plus the frontend client `src/data/api/`. Both `npx tsc --noEmit`/`npx expo export` (app) and `npm run build`/`typecheck` (backend) pass; the server boots and serves `/docs` (90 routes) — the only thing not yet exercised end-to-end is a live DB round-trip, which needs Sagar's own `DATABASE_URL` + `SUPABASE_JWT_SECRET` in `backend/.env`. Local caching landed (`src/lib/queryCache.ts` + `useAsync({ key })` SWR). Sign-up collects a password; phone → synthetic `<digits>@localo.app` email. **Supabase "Confirm email" must be OFF** for sign-in to work (synthetic emails have no inbox). **One account = one device**: every sign-in claims the account for this install (`active_devices`, migration 0022) AND revokes the other sessions server-side (`signOut({ scope: 'others' })`); `SingleDeviceGate` polls the claim and signs a displaced device out within a minute. Both halves are in `src/data/supabase/deviceLock.ts`, shared by Path A and Path B (identity is Supabase on both — no Express twin), best-effort and failing OPEN so a bad connection never logs anyone out; guests are exempt. See `supabase/README.md`, `backend/README.md`, and the memory `localo-backend-deferred`.

## Domain model (`src/domain/types.ts`)

- `ListingType` = 'service' | 'shop' | 'item' | 'rental' — see the taxonomy note below; it is internal capability wiring, never a customer-facing category.
- `Business` — the generic listing. A business can have `products` only, `services` only, or both; `menu` is the shop-items variant, `rentals` are priced per `rentalBasis`. `distanceKm` is computed, not stored.
- `Booking` — an appointment request (`when` is free-text date/time, not a timestamp).
- `Order` — a customer's cart-style request. The `included` flag on each line is how proposals work: the business unticks lines it can't provide. All prices are free-text labels; `lib/money.ts` (`parsePrice`/`formatMoney`) does totals.
- `Bill` — issued by a business to a customer (auto on order acceptance, or by hand); optional `customerId` means in-app delivery.
- `Employee` — `level: 'manager'|'staff'`, `userId?` set if a registered user. Owner = `Business.ownerId` (a User), sits above all employees.
- `SavedPlace` — Current / Home / Work. Used by the location dropdown + distance sorting.
- `ChatMessage` — one thread PER customer PER business (`threadKey = businessId:participantId`). `authorType: 'customer' | 'business'`. Optional `billId` renders the message as a tappable bill card.
- `Call` / `CallParticipant` — a WhatsApp-style internet voice call to a business (no phone numbers exchanged). `status: ringing|active|ended|missed|declined`; each participant has its own `state: ringing|joined|left|declined` so group join/leave works. Ring targets = owner (unless `Business.ownerHandlesCalls === false`) + `callHandlerIds` employees **with an app account** (`userId` set).
- `AppNotification` — per recipient; created when a business replies in chat, on bookings, on missed calls, on order events (`order_requested`/`order_update`, deep-links via `orderId`) and manual bills (`bill_issued`, via `billId`).
- `Vehicle` / `TrackedItem` / `LocationShare` — live tracking. A `Vehicle` (bus/van/truck/…, kinds as data in `catalog.ts` → `VEHICLE_KINDS`) belongs to a business, is identified by its `registrationNumber` (number plate; `name` is the optional pet name, falling back to the plate) and has a `driverEmployeeId`; its live position IS the driver's `LocationShare` (per business, explicitly toggled on/off by the employee). A `TrackedItem` (`kind: 'child' | 'goods'`, e.g. a kid on the school run or a parcel) belongs to a `customerId` and rides on a `vehicleId` — the customer tracks their item by watching that vehicle.
- `Deal` — a live limited-time offer on a `Business` (`deals?`): `tag` ("40% OFF"), `title`, `price`/`wasPrice` labels, `emoji?`. Powers the Browse "Deals near you" carousel.
- `ProductMessage` — one post on a stall product's PUBLIC thread: `businessId`, `productId`, `authorId`/`authorName`, `fromSeller`, `text`, `offerPrice?` (present = it's a price proposal), `replyToId?` (hangs an answer under the question it answers). Read by everyone, posted by anyone signed in.
- `Review` — a rating from any signed-in user (never on your own listing): `businessId`, `customerId`, `rating` 1–5, `comment` (required ≤2 stars), `updatedAt?` on edit. One per customer per business.
- `PortfolioItem` — a piece of the work showcase on a `Business` (`portfolio?`), photo or video.
- `BusinessLocation` carries privacy flags (`isHome`, `hidePreciseLocation`) — respect them when rendering a location.

**Taxonomy note (tags-first):** discovery runs on **tags** — `Business.tags`, vocabulary + helpers in `src/domain/tags.ts` (`TAG_CATALOG`, `SUGGESTED_TAGS`, `hasTag`, `isFoodShop`). A business carries many tags (an MRF dealer is Tyres + Wheel alignment + Vehicle service) and appears under every matching filter; owners can also type custom tags. **Customer browse categories are `INTENT_CATEGORIES` in `domain/intents.ts`** (Food, Health, Home Services, Rentals, Stalls, … — each a bundle of tags); `ListingType` is now *internal-only* capability wiring (register flow shape, stall folding, rental basis) — never a customer-facing category; `subcategoryId` is legacy-but-alive: items still pick one (stall chips run on it), and for other types it's *derived* from tags when one matches (Cafe tag → `cafe`). `offersDineIn` is tag-aware. Don't key new features on subcategory — key them on tags or capabilities. **Listing what a business SELLS** runs on prebuilt libraries, not free text, and all of them are walked as FOLDERS — the flow `FoodMenuEditor` uses for a menu: food from `domain/foodMenu.ts` + `domain/dishes.ts`; goods from `domain/goods.ts` via `features/businesses/GoodsEditor.tsx` (shelf › kind › brand, then spec chips — the picks also WRITE the product's name); services from `domain/offeringSections.ts` (`SERVICE_SECTIONS` + `serviceJobs()`) via `features/businesses/OfferingFolderEditor.tsx` (section › kind of work › the owner’s own folders, nested without limit via `domain/subcategoryPath.ts`, then tap-to-fill job suggestions). Rentals use the same folder editor over `RENTAL_SECTIONS`, whose sections are NESTED (`OfferingSection.folders`: Flats & rooms › Flat › 2 BHK; PG & hostel › For girls › Double sharing) and whose shops/offices/godowns/halls are separate sections, never sub-entries of "flats"; each rental carries its OWN `basis` (per day / per month), printed as a sticker beside the price, with `Business.rentalBasis` demoted to the default for new items. `upgradeRentalFiling()` re-files listings made against the old flat library on read. **Plans are the renewing half of services and their own list** — `Business.plans` (`PlanItem` = a `ServiceItem` plus `basis?: PlanBasis` — monthly/quarterly/half-yearly/yearly, printed as a sticker beside the price), filled from `PLAN_SECTIONS` in the same folder editor, asked as its own register step before the services step. The split is about how you TAKE one, not how it looks: a plan is enrolled in and renews, a service is requested once. Listings made before the split keep their plans in `services` and are NOT migrated — `planOfferings(business)`/`usesServicesAsPlans(business)` read a joinable business's services as its plans (and blank the services bucket so one list can never appear under two buttons); only the owner saving `manage/[businessId]/plans` moves them for good. **Menu, products, services, plans and rentals are ONE model with five names** — `src/domain/offerings.ts` (`offeringBucket`/`offeringBuckets`) flattens all five into one `CatalogItem` shape (key, bucket, order `kind`, category, nested folder `path`, photo, veg dot, per-item badge), so they are filled the same way (the three folder editors above, each item taking a photo) and SHOWN the same way: one catalog screen, `src/features/offerings/OfferingCatalog.tsx` — collapsible sections, nested folders, a photo card per row with an ADD stepper and a sticky “Place order” bar — behind `/menu/[businessId]` (the menu keeps its readable URL) and `/catalog/[businessId]?bucket=products|services|plans|rentals` for the rest, linked from `features/offerings/links.ts`. **What differs between the buckets is only the DOOR** — every block and every catalog screen carries its own action, from `BUCKET_META` in `offerings.ts`: a dish is **🛒 Order**ed, a product **🛍️ Buy**s, a one-off service is **🛠️ Request**ed, a rental is **🔑 Request to rent**, and a plan is **🎟️ Enroll**ed in (`app/enroll` → a pending `Membership`, gated on the `memberships` module; the other four need `orders`). The menu's "Full menu ›" link and its Order button are the same destination on purpose — a heading nobody reads as a way to buy, plus a button that is one. The business page's `OfferingsSection` renders every block identically from the same items, and the shared cart (`CartContext`) holds `CatalogItem`s, so a service is picked exactly like a dish and orders as `kind: 'service'`. Add a new offering list by adding a bucket there, not a new screen. **Filling any of them can also be a PASTE** — every list step in the register wizard carries an “Add the whole list” panel (`src/features/offerings/OfferingImport.tsx`) over a tolerant parser (`src/features/offerings/importOfferings.ts`): nested braces are nested folders (`Beverages: { Cold: { Shake: { Banana: 120 } } }`), the top level is the section, the leaf is the item, a numeric value is the price and other text the description, with `{ price, description, veg, photo, brand, per }` for the explicit form. It reads strict JSON AND the shorthand people type (unquoted names, newlines for commas, `{ Fries, Samosa }`, `[…]` lists, smart quotes), reports errors as “Line 7: …”, previews before committing, and snaps a section name onto the library’s spelling. It only feeds the same editors — nothing it produces is uneditable. The long-term model (customer marketplace + modular business workspace) lives in `docs/direction.md` — read it before big product changes.

## Pasting a whole catalog — the import file format

Every list step in the register wizard (`src/app/register.tsx` — *sell*, *services*, *rent*) carries a
**"📋 Paste the whole list instead"** panel (`src/features/offerings/OfferingImport.tsx`). On the web it can
also read a **`.json` / `.txt` file** ("📄 Choose a .json file"); on a phone it's a paste. The text is parsed on
every keystroke by `src/features/offerings/importOfferings.ts`, previewed before anything is committed, and
then either **Added** to or used to **Replace** the list — after which every row is still editable by hand in
the folder editor below. (The panel lives in the *register* wizard only; Manage has no importer yet.)

### The shape: nesting IS the folder tree

Braces inside braces are folders inside folders, and the innermost name is the thing itself.

```json
{ "Beverages": { "Cold": { "Shake": { "Banana": 120, "Mango": 130 } } } }
```

→ Beverages › Cold › Shake › **Banana ₹120**. **Top level = the section/category**, every level below = the
nested folder path, **leaf = the item**. A value that reads as money becomes the **price**; any other text
becomes the **description**.

**Strict JSON is a valid subset** — quoted keys, numbers, nested objects all parse — so a real `.json` file is
the safest way to hand over a big catalog. The parser is hand-written (not `JSON.parse`) so it *also* accepts
the shorthand people actually type; see "What it forgives" below.

### What each level means, per list

| List | Chosen when | Level 1 | Level 2 | Level 3 | Leaf |
|---|---|---|---|---|---|
| **Menu** (`toMenuItem`) | shop with a food tag — `isFoodShop(tags)` | section from `domain/foodMenu.ts` (`Appetizers`, `Soups`, `Main Course`, `Breads`, `Rice`, `Desserts`, `Beverages`…) | folder | folder (unlimited depth → `subcategory` path) | dish |
| **Products** (`toProductItem`) | any non-food shop | category from `domain/goods.ts` (`Grocery & daily needs`, `Home & cleaning`, `Home electronics`, `Mobiles & computers`, `Kitchen appliances`, `Furniture`, `Beauty & personal care`, `Clothing & footwear`, `Hardware & building`, `Auto parts & accessories`, `Stationery & books`, `Sports & fitness`, `Toys & baby`, `Medical & wellness`, `Pet supplies`, `Farm & garden`, `Other`) | **the kind** → `subcategory` (`Pulses & dal`, `Dairy & eggs`…) | **the brand** → `brand` | product |
| **Services** (`toServiceItem`) | services step | section from `SERVICE_SECTIONS` (`Repairs`, `Installation & fitting`, `Home services`, `Cleaning`, `Beauty & grooming`, `Health & wellness`, `Classes & coaching`, `Transport & moving`, `Events`, `Tailoring & alterations`, `Professional`, `Pet care`, `Farm & agri`, `Other`) | kind of work | folder (unlimited) | job |
| **Rentals** (`toRentalItem`) | rent step | section from `RENTAL_SECTIONS` (`Flats & rooms`, `PG & hostel`, `Shops`, `Offices`, `Godown & storage`, `Halls & venues`, `Cars`, `Bikes`, `Furniture & appliances`, `Equipment & tools`, `Tent & event gear`, `Clothing & costumes`, `Other`) | folder | folder | rental |

**Products are the only list with fixed middle levels** — level 2 is the *kind* and level 3 the *brand*
(the shelf › kind › brand walk `GoodsEditor` does); anything deeper is appended to the subcategory path.
Rentals read `per` / `basis` per item (`day` → daily, `month` → monthly), falling back to the wizard's default.

Section names **snap onto the library's own spelling** (case-insensitive): `beverages` files under
`Beverages`, `grocery & daily needs` under `Grocery & daily needs`. A name the library doesn't know is kept
exactly as written and becomes a custom section — which is fine, but it won't line up with the library chips,
so prefer the exact names above.

### Spelling an item out

A number or plain text after the colon is guessed at. When that isn't enough, use an object of **known keys** —
an object whose keys are ALL known describes ONE item; a single unknown key turns it back into a folder:

```json
{ "Banana Shake": { "price": 120, "description": "Thick, no ice", "veg": true } }
```

| Meaning | Accepted keys |
|---|---|
| price | `price`, `cost`, `rate`, `amount`, `mrp` |
| description | `description`, `desc`, `details`, `about` |
| veg dot (menu) | `veg`, `isVeg` — `true/yes/y/veg/1` vs `false/no/n/non-veg/0` |
| photo URL | `photo`, `image`, `imageUrl`, `img` |
| brand (products) | `brand`, `make` — **wins over the brand folder** |
| rental basis | `basis`, `per` — `day` / `month` |

### What it forgives

Unquoted names (`Virgin Mojito: 150`) · newlines instead of commas · trailing commas · a bare name with no
value (`{ Fries, Samosa }` = two unpriced items) · bracket lists (`Snacks: [Fries, Samosa]`) · smart quotes
from Word · `₹` / `Rs` / `Rs.` / `INR` / `$` / `1,250` · `null` / `nil` / `none` / `-` / `n/a` as "nothing here" ·
an outer `{ … }` or none at all.

### Gotchas that actually bite

- **A comma or a brace ends an unquoted name.** `{` `}` `[` `]` `:` `,` are structural, so a name containing
  one **must be quoted**: `"Sugar, salt & jaggery": { … }`, `"Chips, 100 g": 20`. Same for descriptions.
- **A quoted number is a description, not a price** — `"price": "150"` still works (a known key), but
  `"Toor Dal": "150"` files 150 as the description. Leave prices unquoted.
- **Bare numbers are re-formatted** — `150` → `₹150`. Anything with words (`₹99/plate`, `From ₹200`) is kept
  verbatim, so per-unit pricing survives.
- **One unknown key demotes an item to a folder** — `{ "price": 120, "unit": "kg" }` becomes two folders.
- **Limits:** 1000 items, 8 levels deep. Parse errors read `Line 7: …`.
- Nothing is committed until **Add** / **Replace** is tapped, and everything stays editable afterwards.

A full worked example lives at `docs/testing/sample-imports/b11-jai-kirana-store.json` — the catalog for
test business **B11 Jai Kirana Store**: 162 products over 4 shelves (Grocery & daily needs, Home & cleaning,
Beauty & personal care, Stationery & books), strict JSON, kind › brand throughout.

## Key features & where they live

The full feature map — which screen, component and repository implements each feature — lives in the
**`localo-features` skill** (`.claude/skills/localo-features/SKILL.md`). Load it before changing or
extending any existing feature; it covers home/browse/search, stalls & product threads, orders &
dine-in tabs, billing, customers, memberships, bookings, chat & B2B chat, notifications, calls,
live tracking, reviews, showcase, ads, and the platform console.

## Conventions

- New screen = new file under `src/app/`. Register it in `src/app/_layout.tsx` (for a title) if it's a stack route.
- Use theme tokens from `@/theme/theme` (`useColors()`, `spacing`, `radius`, `fontSize`) — never hardcode colors.
- Use UI primitives from `@/components/ui` (`Text`, `Button`, `Card`, `Input`, `Tag`, `Screen`, `Avatar`, `Stars`, `AutoCarousel`, `SearchIcon`, `ScanIcon`, `LoadingView`/`ErrorView`/`EmptyView`).
- Data fetching: `useAsync(() => repos.x.y(), [deps])`.
- Keep the app **dynamic** — render from repository data, avoid hardcoded IDs/lists.

## Run & verify

- Install (this repo needs it): `npm install --legacy-peer-deps` (a peer conflict blocks plain `npx expo install`).
- Run: `npx expo start --web` (browser preview at http://localhost:8081) or `npx expo start` (Expo Go). In this CLI you can also do `! npx expo start --web`.
- Verify a change: `npx tsc --noEmit` AND `npx expo export --platform web` (both should exit 0).
- **Typed-routes gotcha**: after ADDING a new route file, `.expo/types/router.d.ts` only regenerates while the **dev server is running** — and an ALREADY-RUNNING server regenerates new **dynamic** routes wrongly (as a literal `/foo/[id]` string instead of `/foo/${SingleRoutePart}`, so `router.push(\`/foo/${x}\`)` fails tsc; it may also emit bogus non-route entries). Fix: kill the server, delete `.expo/types/router.d.ts`, start a fresh server, wait ~45s, re-run `tsc`.

## Shipping to Google Play (in progress)

The app is being prepared for its first **Google Play** release (Play only — iOS is not being
prepared). **Read `docs/play-store/RELEASE-STATUS.md` before doing any release work**: it holds the
phase-by-phase status, the open blockers, and the decisions that must not be silently reversed
(hat-free icon for IP reasons; background location deferred to v1.1 behind
`BACKGROUND_LOCATION_ENABLED`; `SYSTEM_ALERT_WINDOW` must stay in the manifest). The rest of
`docs/play-store/` is reference material — what to paste into each Console form.

## What's mocked / deferred (don't assume these exist)

- **Current location uses real GPS** (`expo-location`, behind `PlacesRepository.getCurrentPlace`/`listPlaces` via `lib/location.ts`) — it requests permission and reads the device position, falling back to the seeded `CURRENT_POINT` (Indore, seed.ts) when permission is denied or GPS is unavailable. On web, geolocation only works over `https://` or `localhost`.
- **Map is a real street map** (Leaflet + OpenStreetMap via `RealMap`, works on web + Expo Go). Native Google/Apple map tiles (react-native-maps/expo-maps) would still need a dev build; the `/track` fleet map is still the schematic projection.
- **Call audio is REAL (LiveKit), but native-build-only** — signaling is still the `CallRepository` poll; audio rides on top via LiveKit (`features/calls/useCallAudio.ts`, token from the `dynamic-responder` edge function). Works on web and in a dev/preview build; **Expo Go has no WebRTC native module**, so there the call rings and connects but audio stays simulated. Two rules learned the hard way: never compare a timestamp one device wrote against another device's clock (ring expiry uses the server clock — `shared.serverNow()`, migration 0010), and never call `track.attach()` off web (it's `document.createElement`). Incoming calls ring the phone (`assets/ringtone.wav` + vibration in `IncomingCallGate`) and wake a CLOSED app via Expo push (`push_tokens`, migration 0011 + the `call-ring` edge function); **full-screen lock-screen call UI IS built on Android** — not CallKeep, but a local Expo module, `modules/call-notification/` (`IncomingCallActivity` with `showWhenLocked`/`turnScreenOn`, plus `CallMessagingService` and `CallActionReceiver`). `CallNotifications.showCallScreen` tries TWO routes every time, because either permission can be revoked while the app is closed: **Route 1** launches the activity itself and needs `SYSTEM_ALERT_WINDOW` (added by the WebRTC config plugin — ⛔ **never** put it in `blockedPermissions`, it is the primary path); **Route 2** is a full-screen intent needing `USE_FULL_SCREEN_INTENT`, which Android 14+ withholds until Play classifies the app as a calling app. Neither → an ordinary ringing notification with Answer/Decline. iOS CallKit is still NOT built. **A call is NOT owned by the call screen** — `features/calls/CallSessionContext.tsx` is mounted in the root layout, above the router, and holds the poll, the LiveKit room, the mic and the audio route; `app/call/session/[callId]` and `OngoingCallBar` (the green tap-to-return strip) are only views onto it. Putting any of that back inside the route is what made pressing back kill the audio while the other side's screen still said "On call". Two companions to that: audio defaults to the **earpiece**, not the speaker — LiveKit's own `preferredOutputList` ranks speaker above earpiece, so `livekitNative.native.ts` overrides the order and exposes `listAudioOutputs`/`selectAudioOutput` for the in-call route picker — and a live call runs an Android **foreground service** (`OngoingCallService`, `stopWithTask="false"`, `microphone` type + `FOREGROUND_SERVICE_MICROPHONE`), which is the only thing that keeps the process, and therefore the call, alive through a locked screen or a swipe out of Recents.
- **Vehicle movement is simulated** — active `LocationShare`s random-walk near the business at an exaggerated speed (`advanceShares` in mockRepositories.ts) so the demo visibly moves; the tracking map polls every 3s. Real driver GPS (`expo-location` background updates on the driver's phone + a realtime channel) plugs in behind `TrackingRepository` without UI changes.
- **QR scanning is native-only** — expo-camera has no barcode support on web, so `/scan` on web (our preview) is a paste-a-link fallback. Real scanning works in Expo Go / a dev build.
- **Showcase media is UPLOADED** — the work showcase (`src/app/showcase/[businessId].tsx`) is a gallery, not a form: one ＋ Add button (centered on an empty screen, in the header once there's something), files picked from the camera/gallery and pushed through `uploadMedia`/`uploadAll`, tiles with a ✕ that confirms before removing. No titles, no captions. Caps live in `src/domain/showcase.ts` — **3 photos + 1 video (≤60s) per listing**, because storage scales with every listing that signs up. A business whose showcase IS the business (wedding designer, photographer) adds uncapped `Business.showcaseLinks` instead — Drive/Instagram/YouTube/… links, kind auto-detected from the host, rendered as chips under the gallery by `features/businesses/ShowcaseLinks.tsx`. Uploaded videos play INLINE (expo-video) in the strip and the full-screen viewer; seeded legacy items pointing at a YouTube page still open the watch link (`isPlayableVideo`).
- **Photo and video upload is REAL, and goes to CLOUDINARY** — `PhotosField` (stall product photos, menu item photos, offer photos, the `Business.coverImageUrl` display picture) and `VideoField` (the ≤60s offer reel) route every picked file through `uploadMedia`/`uploadAll` in `lib/upload.ts`, which asks the **`cloudinary-sign` edge function** for a one-time signature and then POSTs the file straight to Cloudinary, storing the returned delivery URL on the domain object. **Why not the Supabase `media` bucket any more:** the free plan is 1 GB of storage and **5 GB of egress a month**, and a browse grid pulling 20 full-size photos spends that in ~1,750 screen views — Cloudinary resizes on delivery, so a 150px tile costs 150px of bytes. (Cloudflare R2 was the first choice and was ruled out: it requires a credit card.) **The bucket and `0015_media_bucket.sql` stay forever** — every URL stored before the move is absolute and still loads from Supabase Storage; dropping the bucket's public-read policy would blank them all. The old path is kept as a LIVE `uploadToSupabaseStorage()` reachable via `EXPO_PUBLIC_MEDIA_BACKEND=supabase` rather than commented out, so `tsc` keeps checking it. Three rules learned here: the **signature and `public_id` are built server-side** from the verified uid, so the client can't name its own key (this is what carries 0015's uid-folder guarantee to a backend with no RLS); **video gets NO transformation** (`lib/media.ts`), because Cloudinary bills video transcoding *per second of footage* — one `q_auto` on the deals feed would be the most expensive line in the codebase; and **`f_auto` is browser-only**, resolved from the `Accept` header, so it is a genuine win on web and a harmless no-op on Android — never "fix" it with `f_webp`, which renders blank on iOS. Widths are named by role in `lib/media.ts` (`THUMB_WIDTH`/`CARD_WIDTH`/`IMAGE_WIDTH`) and reused, because every distinct variant costs a transformation *and* storage against the same 25-credit budget. Uploads talk to storage DIRECTLY on **every** backend and need no Path B twin — `src/data/api/auth.ts` delegates to `createSupabaseAuth()`, so Path B has a Supabase session too and the same JWT verifies at the edge function. Callers never branch on the backend: with nothing configured (mock) or on any failure, `uploadMedia` returns the local `file://`/`blob:` uri and never throws — and **`isLocalUri()` is now checked at every call site**, because a returned local uri otherwise looks exactly like a successful upload. Guests are refused outright (they have no listing to attach a photo to, and anonymous sign-in is open, so it was an unauthenticated write primitive against the storage bill); this is new — the old `!userId` check waved them through, because an anonymous user *has* an id. Account deletion sweeps **both** stores (`delete-account` steps 3 and 3b + `media_keys_unreferenced`, migration 0023) — Postgres cannot see Cloudinary, so without 3b a deleted account would silently keep its photos.
- **Bill "PDF" sharing is text for now** — `lib/share.ts` sends a formatted plain-text bill through the system share sheet (clipboard fallback on web). Real PDF rendering (e.g. `expo-print` + `expo-sharing`) plugs in behind the same share button once the real backend exists.
- **Deferred by user request**: the business-facing "IT services" layer (inventory management, vehicle/fleet tracking). Context only — do NOT build until asked.
