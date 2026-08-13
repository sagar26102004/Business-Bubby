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
2. **supabase** (Path A) — `src/data/supabase/`. App talks straight to Supabase (Postgres + Auth + RLS + auto REST). **FULLY BUILT (2026-07-23)** — ALL 18 repos implemented here (`places` is device GPS, client-side); `createSupabaseRepositories()` returns a pure Supabase set with NO mock delegation. This is the backend in use for testing (`.env` → `EXPO_PUBLIC_BACKEND=supabase`). Two RLS-driven adaptations vs the mock: ratingAvg/ratingCount are computed live from `reviews` on read (a customer can't update a business), and a customer accepting a price proposal leaves the order a confirmed open tab the business bills via Move-to-billing. `notify()` is best-effort so a blocked notification never fails the core write. ⚠️ The live DB's notifications INSERT policy was hardened to recipient-only, dropping cross-user notifications — run `supabase/migrations/0003_notifications_insert_permissive.sql` to restore them. Schema + RLS live in `supabase/migrations/` (**document model**: every table is `data jsonb` = the full domain object + scoping columns owner_id/customer_id/business_id/… that RLS keys on).
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
DB is LIVE (document model, RLS, `handle_new_user` signup trigger, `is_business_member` helper). **Path A (Supabase) is fully BUILT (2026-07-23) and is the backend in use for testing** — every repo runs on the live Supabase Postgres, no mock delegation; 10 test users seeded via auth signup (phones 9812340001–10, password `localo123`). **Path B (api) is also fully BUILT** in `backend/` — all repositories except `places` implemented as Express services over the same Supabase Postgres (Prisma, privileged connection bypassing RLS; authz reimplemented in `backend/src/authz.ts`), plus the frontend client `src/data/api/`. Both `npx tsc --noEmit`/`npx expo export` (app) and `npm run build`/`typecheck` (backend) pass; the server boots and serves `/docs` (90 routes) — the only thing not yet exercised end-to-end is a live DB round-trip, which needs Sagar's own `DATABASE_URL` + `SUPABASE_JWT_SECRET` in `backend/.env`. Local caching landed (`src/lib/queryCache.ts` + `useAsync({ key })` SWR). Sign-up collects a password; phone → synthetic `<digits>@localo.app` email. **Supabase "Confirm email" must be OFF** for sign-in to work (synthetic emails have no inbox). See `supabase/README.md`, `backend/README.md`, and the memory `localo-backend-deferred`.

## Domain model (`src/domain/types.ts`)

- `ListingType` = 'service' | 'shop' | 'item' | 'rental' — see the taxonomy note below; it is internal capability wiring, never a customer-facing category.
- `Business` — the generic listing. A business can have `products` only, `services` only, or both; `menu` is the shop-items variant, `rentals` are priced per `rentalBasis`. `distanceKm` is computed, not stored.
- `Booking` — an appointment request (`when` is free-text date/time, not a timestamp).
- `Order` — a customer's cart-style request. The `included` flag on each line is how proposals work: the business unticks lines it can't provide. All prices are free-text labels; `lib/money.ts` (`parsePrice`/`formatMoney`) does totals.
- `Bill` — issued by a business to a customer (auto on order acceptance, or by hand); optional `customerId` means in-app delivery.
- `Employee` — `level: 'manager'|'staff'`, `userId?` set if a registered user. Owner = `Business.ownerId` (a User), sits above all employees.
- `User` — `isProfilePublic` controls whether they're discoverable/tappable as an employee.
- `SavedPlace` — Current / Home / Work. Used by the location dropdown + distance sorting.
- `ChatMessage` — one thread PER customer PER business (`threadKey = businessId:participantId`). `authorType: 'customer' | 'business'`. Optional `billId` renders the message as a tappable bill card.
- `Call` / `CallParticipant` — a WhatsApp-style internet voice call to a business (no phone numbers exchanged). `status: ringing|active|ended|missed|declined`; each participant has its own `state: ringing|joined|left|declined` so group join/leave works. Ring targets = owner (unless `Business.ownerHandlesCalls === false`) + `callHandlerIds` employees **with an app account** (`userId` set).
- `AppNotification` — per recipient; created when a business replies in chat, on bookings, on missed calls, on order events (`order_requested`/`order_update`, deep-links via `orderId`) and manual bills (`bill_issued`, via `billId`).
- `Vehicle` / `TrackedItem` / `LocationShare` — live tracking. A `Vehicle` (bus/van/truck/…, kinds as data in `catalog.ts` → `VEHICLE_KINDS`) belongs to a business, is identified by its `registrationNumber` (number plate; `name` is the optional pet name, falling back to the plate) and has a `driverEmployeeId`; its live position IS the driver's `LocationShare` (per business, explicitly toggled on/off by the employee). A `TrackedItem` (`kind: 'child' | 'goods'`, e.g. a kid on the school run or a parcel) belongs to a `customerId` and rides on a `vehicleId` — the customer tracks their item by watching that vehicle.
- `Deal` — a live limited-time offer on a `Business` (`deals?`): `tag` ("40% OFF"), `title`, `price`/`wasPrice` labels, `emoji?`. Powers the Browse "Deals near you" carousel.
- `ProductMessage` — one post on a stall product's PUBLIC thread: `businessId`, `productId`, `authorId`/`authorName`, `fromSeller`, `text`, `offerPrice?` (present = it's a price proposal), `replyToId?` (hangs an answer under the question it answers). Read by everyone, posted by anyone signed in.
- `Review` — verified-customer rating: `businessId`, `customerId`, `rating` 1–5, `comment` (required ≤2 stars), `updatedAt?` on edit. One per customer per business.
- `PortfolioItem` — a piece of the work showcase on a `Business` (`portfolio?`), photo or video.
- `BusinessLocation` carries privacy flags (`isHome`, `hidePreciseLocation`) — respect them when rendering a location.

**Taxonomy note (tags-first):** discovery runs on **tags** — `Business.tags`, vocabulary + helpers in `src/domain/tags.ts` (`TAG_CATALOG`, `SUGGESTED_TAGS`, `hasTag`, `isFoodShop`). A business carries many tags (an MRF dealer is Tyres + Wheel alignment + Vehicle service) and appears under every matching filter; owners can also type custom tags. **Customer browse categories are `INTENT_CATEGORIES` in `domain/intents.ts`** (Food, Health, Home Services, Rentals, Stalls, … — each a bundle of tags); `ListingType` is now *internal-only* capability wiring (register flow shape, stall folding, rental basis) — never a customer-facing category; `subcategoryId` is legacy-but-alive: items still pick one (stall chips run on it), and for other types it's *derived* from tags when one matches (Cafe tag → `cafe`). `offersDineIn` is tag-aware. Don't key new features on subcategory — key them on tags or capabilities. The long-term model (customer marketplace + modular business workspace) lives in `docs/direction.md` — read it before big product changes.

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

## What's mocked / deferred (don't assume these exist)

- **Current location uses real GPS** (`expo-location`, behind `PlacesRepository.getCurrentPlace`/`listPlaces` via `lib/location.ts`) — it requests permission and reads the device position, falling back to the seeded `CURRENT_POINT` (Indore, seed.ts) when permission is denied or GPS is unavailable. On web, geolocation only works over `https://` or `localhost`.
- **Map is a real street map** (Leaflet + OpenStreetMap via `RealMap`, works on web + Expo Go). Native Google/Apple map tiles (react-native-maps/expo-maps) would still need a dev build; the `/track` fleet map is still the schematic projection.
- **Call audio is REAL (LiveKit), but native-build-only** — signaling is still the `CallRepository` poll; audio rides on top via LiveKit (`features/calls/useCallAudio.ts`, token from the `dynamic-responder` edge function). Works on web and in a dev/preview build; **Expo Go has no WebRTC native module**, so there the call rings and connects but audio stays simulated. Two rules learned the hard way: never compare a timestamp one device wrote against another device's clock (ring expiry uses the server clock — `shared.serverNow()`, migration 0010), and never call `track.attach()` off web (it's `document.createElement`). Incoming calls ring the phone (`assets/ringtone.wav` + vibration in `IncomingCallGate`) and wake a CLOSED app via Expo push (`push_tokens`, migration 0011 + the `call-ring` edge function); **full-screen lock-screen call UI (CallKeep/CallKit) is NOT built**.
- **Vehicle movement is simulated** — active `LocationShare`s random-walk near the business at an exaggerated speed (`advanceShares` in mockRepositories.ts) so the demo visibly moves; the tracking map polls every 3s. Real driver GPS (`expo-location` background updates on the driver's phone + a realtime channel) plugs in behind `TrackingRepository` without UI changes.
- **QR scanning is native-only** — expo-camera has no barcode support on web, so `/scan` on web (our preview) is a paste-a-link fallback. Real scanning works in Expo Go / a dev build.
- **Showcase media is URL-linked** — portfolio photos/videos are added by pasting a link; direct uploads (camera roll → storage) and inline video playback need the real backend.
- **Stall photos and business display pictures aren't uploaded anywhere** — `PhotosField` picks photos and stores the LOCAL uris (`file://` / `blob:`) on `ProductItem.images` (and on `Business.coverImageUrl`, the display picture picked in Manage), so they render for the session and die with the mock backend. Real storage slots in inside `PhotosField` (pick → upload → keep the returned URLs); no caller changes.
- **Bill "PDF" sharing is text for now** — `lib/share.ts` sends a formatted plain-text bill through the system share sheet (clipboard fallback on web). Real PDF rendering (e.g. `expo-print` + `expo-sharing`) plugs in behind the same share button once the real backend exists.
- **Deferred by user request**: the business-facing "IT services" layer (inventory management, vehicle/fleet tracking). Context only — do NOT build until asked.
