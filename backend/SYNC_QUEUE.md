# Backend sync queue (Path B ← Supabase)

Pending data-behaviour changes made in the **Supabase** backend (`src/data/supabase/`) that
still need to be replicated into the **Node/Express + Prisma** backend (`backend/`) and its
frontend HTTP client (`src/data/api/`).

**Workflow (see CLAUDE.md → "STANDING RULE"):**
- When a data-behaviour change is made, it is applied to Supabase ONLY, and an entry is
  appended here describing exactly what to do in Path B.
- Running `/update-backend` applies these entries to `backend/` + `src/data/api/`, one at a
  time, and **deletes each entry from this file as soon as it is done and verified**.
- Entries are kept SMALL and self-contained so an interrupted `/update-backend` can resume
  from the next unchecked entry without redoing finished work.

## How to write an entry

Each entry is a `## [SYNC-NNN] <short title>` block. Use the next free number (they only ever
go up; deleting done entries does not recycle numbers). Include everything Path B needs so no
re-derivation from the Supabase diff is required:

```
## [SYNC-001] Add `foo` field to Business

- **Area:** BusinessRepository / businesses
- **Supabase change:** <what was done in src/data/supabase/… + any migration>
- **Domain/interface:** <changes already in src/domain/types.ts or src/data/repositories.ts — shared, usually already done>
- **Path B — backend/:** <exact files + logic: prisma model note, service method, router/controller, authz>
- **Path B — src/data/api/:** <exact client method(s) + endpoint path/shape>
- **DB/migration:** <new SQL migration file, if any — shared DB, apply once>
- **Verify:** <what to check: backend typecheck/build, api client tsc>
```

---

## [SYNC-035] Unnamed (anonymous) customers read as "Guest"

- **Area:** CustomerRepository / customers aggregation
- **Supabase change:** `src/data/supabase/customers.ts` — the chat-row name fallback was
  `names.get(pid) ?? pid`; it is now `names.get(pid) || 'Guest'`. Anonymous identities
  (guest chat, and now guest orders/bookings — see the context below) get a `profiles` row
  with an EMPTY `name`, and `??` does not catch `''`, so those customers rendered as a
  blank row; the old `?? pid` branch showed a raw uuid, which was never useful either.
- **Context (frontend, already shared — no Path B work):** the cart, order/new, party and
  book screens now call `signInGuest()` before writing when nobody is signed in, so a
  logged-out customer acts as a real anonymous auth user instead of the synthetic `'guest'`
  id. That was required for Supabase RLS (`orders_insert`/`bookings_insert` check
  `customer_id = auth.uid()`). Path B authorises server-side and accepts either shape, so
  nothing to change there — but its customer list will now see the same unnamed accounts.
- **Domain/interface:** none.
- **Path B — backend/:** in the customers service (`backend/src/services/customers.ts`),
  apply the same fallback wherever a customer's display name is resolved from a profile:
  an empty/missing profile name must become `'Guest'`, not `''` and not the raw id.
- **Path B — src/data/api/:** none.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` in `backend/`; a business with a guest chat or a guest
  order shows a customer row labelled "Guest".

## [SYNC-036] Work showcase: `Business.showcaseLinks` + upload-only portfolio

- **Area:** BusinessRepository / businesses (document field only — no new endpoint)
- **Supabase change:** none in `src/data/supabase/` — `businesses.update()` already merges the
  whole domain document (`{ ...current, ...patch }` → `data jsonb`), so the new field persists
  with no code change. The frontend showcase editor (`src/app/showcase/[businessId].tsx`) was
  rewritten: media is now UPLOADED through `lib/upload.ts` (Supabase Storage, unchanged on
  every backend) instead of pasted as a URL, capped at 3 photos + 1 video (≤60s) per listing,
  and titles/descriptions are no longer written. Businesses with a bigger showcase add
  uncapped `showcaseLinks` (Drive/Instagram/YouTube/…) instead, rendered as chips on the
  business page.
- **Domain/interface:** `src/domain/types.ts` — new `ShowcaseLinkKind` + `ShowcaseLink`
  (`{ id, kind, url, createdAt }`) and `Business.showcaseLinks?: ShowcaseLink[]`;
  `PortfolioItem.title`/`.description` marked LEGACY (still read, never written). New
  `src/domain/showcase.ts` holds the caps (`MAX_SHOWCASE_PHOTOS = 3`,
  `MAX_SHOWCASE_VIDEOS = 1`, `MAX_SHOWCASE_VIDEO_SECONDS = 60`), URL→kind detection and
  `isPlayableVideo` — all client-side, no backend twin needed.
- **Path B — backend/:** copy the `ShowcaseLinkKind` + `ShowcaseLink` types and the
  `Business.showcaseLinks?` field into `backend/src/domain/types.ts` (the file is a
  hand-kept copy of the frontend domain). No service change: `businesses.update()` in
  `backend/src/services/businesses.ts` does `Object.assign(business, safePatch)` over the
  whole document, so the field round-trips already — this is typing parity only. If the
  Swagger/zod body schema for `PATCH /businesses/:id` enumerates business fields, add
  `showcaseLinks` there so a patch carrying it isn't stripped.
- **Path B — src/data/api/:** none — the showcase writes through the existing
  `businesses.update` client method, and uploads talk to Supabase Storage directly on every
  backend.
- **DB/migration:** none (document model — the field lives inside `businesses.data`).
- **Verify:** `npm run typecheck` in `backend/`; with `EXPO_PUBLIC_BACKEND=api`, add a link in
  Work showcase, reload, and confirm the chip is still on the business page.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

## [SYNC-037] Voice calls: participant liveness lease (dead-peer timeout)

- **Area:** CallRepository / calls
- **Why:** hanging up was only ever a MESSAGE the leaving device sent. A device killed
  mid-call — OS reclaiming memory, force-stop from Recents, flat battery — sent nothing, so
  its participant stayed `joined` for ever: the other side sat on "On call" with no audio,
  and the row never reached `ended` (it stayed `active` in the DB, polluting the call log).
- **Supabase change:** `src/data/supabase/calls.ts`
  - new `PRESENCE_TIMEOUT_MS = 45_000`;
  - new `dropExpiredParticipants(call, createdAt)`: for an **active** call, every
    participant with `state === 'joined'` whose lease has expired becomes `state: 'left'` +
    `leftAt`. If that leaves no joined customer OR no joined business member, the call
    becomes `ended` + `endedAt` — i.e. exactly the same end-of-call rules `leave()` applies.
  - ⚠️ **Expiry is judged on `aliveAt` ONLY, never on `joinedAt`.** `joinedAt` is written by
    the participant's own device, and comparing a device timestamp against the server's
    clock is precisely the bug migration 0010 fixed for ring expiry — here a phone running
    45s slow would be hung up on the instant it joined. A participant with NO `aliveAt` yet
    is judged on the CALL's server-side age (`created_at`) instead, so everyone gets a full
    timeout's grace to produce a first lease.
  - `sweepOne()` calls it after the ring-timeout branch (and returns early when the
    ring-timeout branch already fired), persisting only when something changed;
  - `join()` deliberately sets `p.aliveAt = undefined` — it runs on the device, and only a
    server-stamped lease is trustworthy. The client's first heartbeat fires immediately on
    joining and opens the lease properly.
  - new `heartbeat()` — see below.
- **Domain/interface (shared, already done):** `CallParticipant.aliveAt?: string` in
  `src/domain/types.ts`; `heartbeat(callId, participantId): Promise<Call | null>` added to
  `CallRepository` in `src/data/repositories.ts` (read the doc comment there — it is the spec).
- **Mock (shared, already done):** `src/data/mock/mockRepositories.ts` — same
  `PRESENCE_TIMEOUT_MS`, `dropExpiredParticipants(call, now)` called from `sweepCalls()`,
  and a `heartbeat()` method. **This is the behavioural spec.** It DOES stamp `aliveAt` in
  `join()` and falls back to `joinedAt`, which is not a divergence: the mock runs in one
  process, so there is only one clock and the distinction the real backends must draw
  does not exist.
- **Path B — backend/:** in `backend/src/services/calls.ts`
  - port `PRESENCE_TIMEOUT_MS` + `dropExpiredParticipants` into the existing lazy sweep, so
    every call read runs it. Path B talks to Postgres directly, so "the server clock" is
    simply `new Date()` on the server — no `serverNow()` offset machinery needed. Keep the
    `aliveAt`-only rule and the call-age fallback: Path B's clients are the same phones, so
    `joinedAt` is no more trustworthy there than it is on Path A.
  - add `heartbeat(callId, participantId)`: load the call; return `null` unless its status is
    `ringing`/`active` AND that participant exists AND `state === 'joined'` (a ringing,
    left or declined participant must NOT be able to renew — that would let someone the
    sweep just dropped un-leave themselves); otherwise set `aliveAt = new Date().toISOString()`,
    persist, sweep, and return the call.
  - router: `POST /calls/:callId/heartbeat` with body `{ participantId }`, thin as usual.
  - **authz** (`backend/src/authz.ts` rules apply): the caller must BE that participant —
    `participantId === req.user.id` — and be on the call. Do not accept a participantId for
    someone else; a spoofed heartbeat would keep a dead device's seat alive for ever.
  - Prisma: no schema change — `aliveAt` lives inside the `data` jsonb document.
- **Path B — src/data/api/ (already done):** `repositories.ts` already has
  `heartbeat: (callId, participantId) => http.post<Call | null>(\`/calls/${seg(callId)}/heartbeat\`, { participantId })`.
  Nothing further unless the endpoint path changes.
- **DB/migration:** `supabase/migrations/0021_call_heartbeat.sql` — a `security invoker`
  `call_heartbeat(p_call_id uuid, p_participant_id text)` RPC that stamps `aliveAt` at ONE
  jsonb path with `now()`. **Path A only**: it exists because browser clients write the whole
  `data` document (two concurrent heartbeats would clobber each other) and because the client
  must not be the one timestamping. Path B holds a privileged connection and serialises its
  own writes, so it should update the document in its service and **not** call this RPC.
  The migration is still shared DB state — apply it once; it is harmless to Path B.
- **Client (shared, already done):** `src/features/calls/CallSessionContext.tsx` beats every
  `HEARTBEAT_MS = 10_000` while joined (a quarter of the timeout, so three misses are
  tolerated), best-effort, and folds the returned call into state.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; then two clients on one
  call — kill one outright (force-stop, not hang up) and the other must go to "Call ended"
  within ~45–60s, with the row's status `ended` in the DB.
## [SYNC-038] Goods taxonomy fields on ProductItem (category/subcategory/brand/variants)

- **Area:** BusinessRepository / businesses — product documents only. No endpoint, no authz,
  no RLS and no migration: the four fields ride inside the existing `data` jsonb document.
- **Supabase change:** none needed in `src/data/supabase/` — `businesses.ts` spreads whole
  product objects (`withProductIds`, the `create`/`update` paths), so the new fields persist
  as they are. Verified by inspection; nothing was edited there.
- **Domain/interface (shared, already done):** `src/domain/types.ts` — `ProductItem` gains
  `category?: string`, `subcategory?: string`, `brand?: string`, `variants?: string[]`. They
  come from the new goods library `src/domain/goods.ts` (shelves -> kinds -> brands -> spec
  chips), which the register wizard and Manage > Products now walk through the new
  `src/features/businesses/GoodsEditor.tsx` (folder navigation, same flow as the food menu
  builder).
- **Path B — backend/:** mirror the four optional fields on `ProductItem` in
  `backend/src/domain/types.ts` so the server-side type matches the client's. Check that
  `backend/src/services/businesses.ts` copies products as whole objects when creating and
  updating a listing (it should already — the same document model); if any code rebuilds a
  product field-by-field, add the four fields there so they are not silently dropped.
  There is no new validation to add: every field is optional free text and the library is a
  suggestion source on the client, never a server-enforced vocabulary.
- **Path B — src/data/api/:** nothing. Products are carried inside the business payload the
  existing `businesses` client methods already send.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; then create a listing
  through Path B with a product carrying a brand + variants and read it back — all four
  fields must survive the round trip.

## [SYNC-039] People search matches the username, not just the display name

- **Area:** UserRepository / users — `search(term)`
- **The bug it fixes:** since sign-in moved to username + password, accounts are addressed
  and written down by their handle (`sparksemp1`, `cornercafeown`). Search matched only
  `name`, so typing the handle you signed the account up with returned "No one found" — in
  the super-admin owner-reassign picker, the team-member picker, the bill-a-customer picker
  and the fleet assign picker, all of which call this one method.
- **Domain/interface (shared, already done):** `src/domain/types.ts` gains
  `matchesUserSearch(user, term)` — the single rule: case-insensitive substring over `name`,
  `username` and `email`, plus a digits-only match on `phone` when 4+ digits were typed; a
  leading `@` is stripped. `src/data/repositories.ts` documents it on `search`.
- **Supabase change (done):** `src/data/supabase/users.ts` filters the fetched `profiles`
  rows with `matchesUserSearch` (the public card carries `name` AND `username`). If nothing
  public matches and the term contains a digit or `@`, it merges `profiles_private` and
  retries, so a phone/email search works for the callers RLS lets see those fields (yourself,
  a super-admin) and silently finds nothing for everyone else.
- **Mock (done):** same one-liner via `matchesUserSearch`.
- **Path B — backend/:** in the users service (`backend/src/services/users.ts` or wherever
  `search` lives), replace the name-only filter with the same rule — port
  `matchesUserSearch` into `backend/src/domain/types.ts` (it is pure, copy it verbatim) and
  call it. Two things to get right: the profile row's `data` carries `username`, and the
  server sees phone/email for EVERY user because it holds a privileged connection — so it
  must NOT match on phone/email unless the caller is the user themselves or a super-admin
  (`backend/src/authz.ts` knows). Path A gets that restriction free from RLS; Path B has to
  reimplement it, or it leaks a phone-number lookup to anyone.
- **Path B — src/data/api/:** nothing — the client already calls the same endpoint.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; then search a known
  username (a handle from docs/testing/TEST-DATA.md) and confirm the account comes back,
  and that a non-admin searching someone else's phone number gets nothing.

## [SYNC-040] Per-item rental basis (`RentalItem.basis`)

- **Area:** BusinessRepository / businesses — rental documents only. No endpoint, no authz, no
  migration: the field rides inside the existing `data` jsonb document.
- **Why:** `Business.rentalBasis` was one setting for the whole listing, so a property dealer
  whose flats go per month and whose scooter goes per day could not say so, and the business
  page had no period to print next to a price. The basis now belongs to the ITEM; the business
  setting is just the default a new item starts on.
- **Domain/interface (shared, already done):** `src/domain/types.ts` — `RentalItem` gains
  `basis?: RentalBasis`. `src/domain/catalog.ts` gains `rentalBasisSticker(basis)` ("per day" /
  "per month" / "per day / month") for the tag beside the price.
- **Supabase change:** none needed — `src/data/supabase/businesses.ts` writes whole rental
  objects, so the field persists as it is.
- **Path B — backend/:** mirror `basis?: RentalBasis` on `RentalItem` in
  `backend/src/domain/types.ts`, and check nothing in `backend/src/services/businesses.ts`
  rebuilds rentals field-by-field (it should copy the objects whole, same document model).
  No validation to add — it is an optional enum-ish string the client picks from the library.
- **Path B — src/data/api/:** nothing; rentals ride inside the business payload.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; save a rental with
  `basis: 'daily'` on a listing whose `rentalBasis` is `'monthly'` and read it back unchanged.

## [SYNC-041] Service/rental photos (`ServiceItem.imageUrl`, `RentalItem.imageUrl`)

- **Area:** BusinessRepository / businesses — service and rental documents only. No endpoint,
  no authz, no migration: the field rides inside the existing `data` jsonb document.
- **Why:** menu, products, services and rentals are now one offering model
  (`src/domain/offerings.ts`) shown by one catalog screen
  (`src/features/offerings/OfferingCatalog.tsx`), which leads every row with a photo the way a
  food app does. Dishes and products already carried one; services and rentals did not, so
  those two lists rendered as a wall of emoji placeholders.
- **Domain/interface (shared, already done):** `src/domain/types.ts` — `ServiceItem` and
  `RentalItem` each gain `imageUrl?: string`. Written by
  `src/features/businesses/OfferingFolderEditor.tsx`, which now shows a `PhotosField` (max 1)
  on the composer, exactly as `FoodMenuEditor` does; the upload itself goes straight to
  Supabase Storage on every backend (`lib/upload.ts`), so there is nothing backend-specific
  about the value — it is a public URL string.
- **Supabase change:** none needed — `src/data/supabase/businesses.ts` writes whole
  service/rental objects, so the field persists as it is.
- **Path B — backend/:** mirror `imageUrl?: string` on `ServiceItem` and `RentalItem` in
  `backend/src/domain/types.ts`, and check nothing in `backend/src/services/businesses.ts`
  rebuilds those arrays field-by-field (it should copy the objects whole, same document model
  as [SYNC-040]). No validation to add — an optional URL string.
- **Path B — src/data/api/:** nothing; services and rentals ride inside the business payload.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; save a service with an
  `imageUrl` and read it back unchanged.

## [SYNC-042] Multi-shift opening hours (`DayHours.shifts`)

- **Area:** BusinessRepository / businesses — `openingHours` document field only. No endpoint,
  no authz, no migration: it rides inside the existing `data` jsonb document.
- **Why:** a day could hold ONE open→close pair, so a business open twice a day (a gym at
  5–10 AM and 5–10 PM, a restaurant closed between lunch and dinner) could not be entered —
  picking Mon–Sat again for the evening timing silently replaced the morning one.
- **Domain/interface (shared, already done):** `src/domain/hours.ts` — new
  `Shift { open: string; close: string }`; `DayHours` gains `shifts?: Shift[]`, with the old
  `open`/`close` pair KEPT and mirrored to `shifts[0]` on every write, so an older reader (or
  Path B before this entry lands) still sees the first shift instead of nothing. New readers
  `dayShifts(day)` (usable shifts, earliest first — reads `shifts` or the legacy pair, returns
  `[]` when closed) and `dayFromShifts(shifts)` (build a day, keeping the legacy pair in step);
  `isOpenNow`/`formatDayHours`/`summarizeHours`/`todayHoursLabel`/`weeklySchedule`/
  `hasUsableHours` all loop over shifts, each shift keeping its own overnight handling.
  `src/domain/types.ts` re-exports `Shift`. Editor:
  `src/features/businesses/OpeningHoursField.tsx` — day chips are no longer exclusive between
  timing blocks, so the same day in two blocks is two shifts.
- **Supabase change:** none needed — `src/data/supabase/businesses.ts` writes `openingHours`
  whole, so the new field persists as it is.
- **Path B — backend/:** mirror the shape in `backend/src/domain/types.ts` — add
  `export interface Shift { open: string; close: string }` and `shifts?: Shift[]` to
  `DayHours` (keep `closed`/`open`/`close`). Confirm `backend/src/services/businesses.ts`
  still copies `input.openingHours` whole (it does today, line ~133) rather than rebuilding
  days field-by-field, which would drop `shifts`. Nothing else — the backend never evaluates
  open/closed; only the app does.
- **Path B — src/data/api/:** nothing; `openingHours` rides inside the business payload.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; save a listing whose Mon–Sat
  carry two shifts (`05:00–10:00` and `17:00–22:00`) and read it back with both intact.

## [SYNC-043] Notify the business when a CUSTOMER sends a chat message

- **Area:** ChatRepository / chat (`send`), NotificationRepository (new kind)
- **Supabase change:** `src/data/supabase/chat.ts` — `send()` only notified when
  `author.type === 'business'` (the customer got a `chat_reply`); the other direction was
  silent, so a customer's message landed in the business inbox and nothing told the team.
  It now reads the business document once (reused for both branches) and, for
  `author.type === 'customer'`, emits one `chat_message` notification per business-side
  recipient. New module-level helper `chatHandlerIds(business)`: the owner, plus every
  employee whose `Employee.id` is in `business.chatRecipientIds` AND has a `userId`
  (deduped). This mirrors the call ring targets in `calls.ts` — reading the inbox is the
  wider right (managers can too), but being PINGED follows the routing the owner set.
  The employees read is best-effort: under RLS a customer usually cannot list a business's
  employees, so `data` comes back empty and the notification correctly falls back to the
  owner alone. Notification shape:
  `{ kind: 'chat_message', title: '<customer name> · <business name>', body: <message>,
  businessId, participantId }`.
- **Domain/interface:** already shared, done — `src/domain/types.ts`:
  `AppNotification.kind` gained `'chat_message'`, and `AppNotification` gained
  `participantId?: string` (the customer whose thread it is, so the business side can
  deep-link to `/inbox/<businessId>/<participantId>`).
  `src/domain/notifications.ts`: `categoryOfKind` maps `'chat_message'` → `'chats'`, so the
  existing Chats mute toggle silences it with no new category.
  Frontend (shared, no Path B work): `src/app/(tabs)/chats.tsx` renders 💬 for it and routes
  it to `/inbox/<businessId>/<participantId>` (falling back to `/inbox/<businessId>`).
- **Path B — backend/:** mirror the same in `backend/src/services/chat.ts` `send()`. Port
  `chatHandlerIds` there — Path B runs privileged (RLS bypassed), so its employees read
  always succeeds and routed handlers WILL be notified; that is the intended behaviour, the
  Supabase fallback-to-owner is only an RLS artefact. Also add `'chat_message'` to the kind
  union in `backend/src/domain/types.ts` (+ `participantId?: string` on the notification)
  and the `'chat_message' → 'chats'` case in `backend/src/domain/notifications.ts`.
- **Path B — src/data/api/:** none — `POST /chat/:businessId/:participantId` already returns
  the thread and notifications are read through the existing notifications endpoints.
- **DB/migration:** none — `notifications.data` is jsonb and the new kind/field ride inside it.
- **Verify:** `npm run typecheck` in `backend/`; sign in as a customer, message a business,
  then sign in as that business's owner — the Chat tab shows an Alerts badge and the alert
  opens that customer's inbox thread.

## [SYNC-044] `BusinessQuery.limit` — Home lists the N nearest, not a 20 km ring

- **Area:** BusinessRepository / businesses (`list`)
- **Supabase change:** `src/data/supabase/businesses.ts` `list()` now destructures `limit`
  from the query and, **after** the existing sort, returns `results.slice(0, limit)` when it
  is a number. It must stay after the sort (so `limit` + `sortByDistance` means "the N
  nearest") and it cannot become a PostgREST `.limit()` — distance lives inside the `data`
  jsonb document and is computed in JS, so a DB-side limit would cut an arbitrary 100 rows
  before we know which are close.
- **Domain/interface:** already shared, done — `src/data/repositories.ts` `BusinessQuery`
  gained `limit?: number` ("return at most this many, applied AFTER sorting"). The mock
  (`src/data/mock/mockRepositories.ts`) applies the identical slice.
  Frontend (shared, no Path B work): `src/app/(tabs)/index.tsx` dropped `HOME_RADIUS_KM = 20`
  / `maxDistanceKm` in favour of `HOME_NEARBY_COUNT = 100` / `limit`, and its empty-state
  copy no longer mentions a radius. `maxDistanceKm` itself is UNCHANGED and still used by
  `app/map.tsx` and `LocationPicker` (5 km map viewports) — do not remove it.
- **Path B — backend/:** `backend/src/services/businesses.ts` `list()` — destructure `limit`
  alongside `near, maxDistanceKm, sortByDistance` and apply the same post-sort
  `slice(0, limit)`. `backend/src/routers/businesses.ts` — parse it off the query string
  next to `maxDistanceKm`: `limit: q.limit != null ? num(q.limit) : undefined`. Update the
  Swagger annotation for `GET /businesses` with the new optional integer param.
- **Path B — src/data/api/:** `src/data/api/repositories.ts` around line 98 — add
  `limit: query.limit,` beside `maxDistanceKm` / `sortByDistance` in the businesses `list`
  params so the value actually reaches the server. Until this lands, Path B silently
  returns every business on Home (correct rows, no cap).
- **DB/migration:** none.
- **Verify:** `npm run typecheck` in `backend/`; `GET /businesses?near.latitude=…&
  near.longitude=…&sortByDistance=true&limit=5` returns exactly the 5 closest.

## [SYNC-045] Renewing plans are their own list (`Business.plans`)

- **Area:** BusinessRepository / businesses — a new document field plus one `create` input
  field. No endpoint, no authz, no migration: it rides inside the existing `data` jsonb.
- **Why:** `services` meant two different things at once. A gym membership and a call-out
  electrician sat in one list, so the business page had to guess which button to show —
  and for a joinable business it hid ordering entirely (`joinTakesServices`), because
  Enrol and Order pointed at the same rows and landed in two different workspace
  sections. Plans are now their own list: you ENROL in a plan (`app/enroll` → a pending
  `Membership`) and you REQUEST a service (the orders desk). Same shape, same folder
  editor, same catalog screen — different door.
- **Domain/interface (shared, already done):** `src/domain/types.ts` — `PlanBasis`
  (`'monthly' | 'quarterly' | 'half_yearly' | 'yearly'`), `PlanItem extends ServiceItem`
  with `basis?: PlanBasis`, and `Business.plans?: PlanItem[]`.
  `src/data/repositories.ts` — `CreateBusinessInput.plans?: PlanItem[]`.
  `src/domain/catalog.ts` — `PLAN_BASES` + `planBasisSticker`.
  `src/domain/offeringSections.ts` — `PLAN_SECTIONS` library.
  `src/domain/offerings.ts` — a fifth bucket `'plans'`, plus `planOfferings(business)` and
  `usesServicesAsPlans(business)`.
- **Backwards compatibility — READ THIS BEFORE "migrating" anything:** listings made
  before the split keep their plans in `services`. `planOfferings()` reads a joinable
  business's `services` AS its plans when `plans` is empty (joinable = `commerceVocab`
  mode `enroll`/`subscribe`), and the services bucket then renders EMPTY so the same rows
  can never appear under two buttons. Nothing was migrated in the database and nothing
  should be: the only thing that moves a legacy list is the owner saving
  `manage/[businessId]/plans`, which writes `plans` and clears `services`.
- **Supabase change:** `src/data/supabase/businesses.ts` — `create()` now copies
  `plans: input.plans` into the business document; the search-term list gained
  `...(b.plans ?? []).map((p) => p.name)`; and the collection-capture condition on
  `update()` gained `|| patch.plans`. `update()` itself needed nothing (it merges whole
  documents).
- **Path B — backend/:** mirror `PlanBasis`, `PlanItem` and `Business.plans` in
  `backend/src/domain/types.ts` and `plans` on the create input.
  In `backend/src/services/businesses.ts`: carry `plans` through `create` exactly like
  `services`, and add plan names to whatever backs the `query` search so a plan is findable
  by name (twin of the Supabase change above). Confirm `update` merges the document whole
  rather than rebuilding it field-by-field — if it whitelists fields, add `plans`.
- **Path B — src/data/api/:** nothing new to call; `plans` rides inside the business
  payload on `create`/`update`/`getById`. Just check `src/data/api/businesses.ts` does not
  strip unknown fields when it maps the response.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; register a business with
  one plan and one service and read it back with both lists intact and distinct; open a
  legacy gym (plans still in `services`) and confirm it still shows one "Plans &
  memberships" block with an Enroll button and NO services block.

## [SYNC-046] Drop the verified-customer gate on ratings

- **Area:** ReviewRepository / reviews
- **Why:** rating was gated behind an accepted order, an accepted/completed booking, or a
  bill. Someone who ENROLLED in a plan (a membership — e.g. the school bus service) has
  none of those, so they could never rate the business they subscribe to. Rather than add
  memberships to the gate, the gate is removed: anyone signed in may rate a listing they
  don't own.
- **Supabase change:** `src/data/supabase/reviews.ts` — `eligibilityFor()` now returns
  `{ eligible: true }` for any real (uuid) customer id; it keeps ONLY the two refusals:
  not signed in → `'Sign in to rate businesses.'`, and own listing (`business.ownerId ===
  customerId`) → `'You can’t rate your own business.'`. The orders/bookings/bills lookups
  are gone. The `submit()` fallback message became `'You can’t rate this business.'`.
  Same change in `src/data/mock/mockRepositories.ts` (`reviewEligibilityFor`).
- **Domain/interface (shared, already done):** doc comments only —
  `src/data/repositories.ts` (`ReviewEligibility`, `ReviewRepository`,
  `checkEligibility`) and `src/domain/types.ts` (`Review`). No signature changed.
- **Path B — backend/:** `backend/src/services/reviews.ts` — in `eligibility()`, delete
  the order/booking/bill queries and the "Ratings come only from verified customers…"
  refusal; return `{ eligible: true }` once the caller is signed in and is not the
  business owner. Keep the existing sign-in and owner refusals verbatim. Update the
  `submit()` fallback throw to `'You can’t rate this business.'` and the file header
  comment (it says "verified-customer gate"). The route
  `GET /reviews/business/:businessId/eligibility/:customerId` and its authz are unchanged.
- **Path B — src/data/api/:** none — same endpoints, same shapes.
- **DB/migration:** none. (Supabase RLS on `reviews` already only pins the author, it
  never enforced the transaction gate.)
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; with `EXPO_PUBLIC_BACKEND=api`,
  a signed-in user with no order/booking/bill for a business gets the star picker instead
  of the gate screen, and the owner still gets refused on their own listing.

## [SYNC-047] Remove `User.isProfilePublic` (the public-profile toggle)

- **Area:** UserRepository / users + profiles
- **Why:** the Settings → Privacy "Public profile" switch was the only thing that turned it
  on or off, and all it ever did was decide whether an employee's profile page was
  tappable. It was a confusing extra choice for no real privacy (the `profiles` card is
  world-readable regardless), so the whole concept is gone: an employee row is tappable
  when the person has an app account, full stop.
- **Domain/interface (shared, already done):** `src/domain/types.ts` — `isProfilePublic`
  removed from `User`. `src/data/repositories.ts` — removed from `NewUserInput`.
- **Supabase change:** `src/data/supabase/auth.ts` + `shared.ts` no longer write the field
  onto the User objects they build; `src/data/mock/*` and the UI (`app/settings.tsx`
  Privacy group, `app/employee/[id].tsx` private gate, `app/dev.tsx` 🔒 label,
  `EmployeeEditor`/`OwnerPicker` "Public/Private profile" subtitle, `EmployeeRow.isPublic`
  prop) dropped it too. No SQL ran: stale `isProfilePublic` keys left inside
  `profiles.data` are simply ignored on read.
- **Path B — backend/:** remove `isProfilePublic` from `backend/src/domain/types.ts`
  (`User`) and `backend/src/domain/contracts.ts` (the update/create input). In
  `backend/src/services/users.ts`, delete the `if (patch.isProfilePublic !== undefined)`
  line from the whitelist in `update()` — ⚠️ do NOT loosen the whitelist itself, it is the
  only authz guard on that path — and fix the two comments that mention the field (the
  file header and the note in `search()`).
- **Path B — src/data/api/:** `src/data/api/auth.ts` already stopped emitting the field
  (shared file, done). Nothing else to change; no endpoint shape moved.
- **DB/migration:** none, deliberately. `handle_new_user` and older migrations still seed
  `'isProfilePublic', true` into the profile document; that key is now inert. Don't write
  a migration to strip it — rewriting every profile row buys nothing.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; `PATCH /api/users/<me>`
  with `{"isProfilePublic": false}` is accepted and simply ignored (unknown field), and an
  employee with an account is tappable from the business page on `EXPO_PUBLIC_BACKEND=api`.
