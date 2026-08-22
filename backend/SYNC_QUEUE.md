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
