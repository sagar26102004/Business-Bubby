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

## [SYNC-009] Memberships: `add` carries `enrolleeName`, payer may have no account

- **Area:** MembershipRepository / memberships (workspace Members ＋ Add)
- **Supabase change:** `src/data/supabase/memberships.ts` → `add()` now sets
  `enrolleeName: input.enrolleeName?.trim() || undefined` on the created `Membership`
  (same line the existing `request()` already has). Nothing else changed — `add()` already
  writes the `customer_id` scoping column through `uuidOrNull()`, so a payer with no Localo
  account (`customerId` = `walkin:<lowercased name>`) stores `null` there and simply never
  appears in anyone's Subscriptions, while still grouping and billing normally in the
  workspace. The mock (`src/data/mock/mockRepositories.ts` → `MockMembershipRepository.add`)
  got the same one-line change.
- **Domain/interface:** DONE (shared) — `NewMembershipInput` in `src/data/repositories.ts`
  gained `enrolleeName?: string`, and its `customerId` doc now states it may be a
  `walkin:<lowercased name>` key rather than a user id.
- **Path B — backend/:** `backend/src/services/memberships.ts` → in `add()` (the
  `const membership: Membership = {…}` literal around line 172), add
  `enrolleeName: input.enrolleeName?.trim() || undefined,` after `customerName`. Verify the
  input type used by `add()` mirrors the shared `NewMembershipInput` (add the optional
  `enrolleeName` field to it and to the request-body validation in
  `backend/src/routers/memberships.ts` → `POST /memberships`, accepting an optional string).
  **Do NOT add a uuid guard on `customerId`** — it must keep accepting `walkin:…` /
  `standalone:…` keys; `uuidOrNull(membership.customerId)` at the Prisma write already
  handles the scoping column. Check the POST /memberships authz guard is business-member-only
  (it must not try to resolve `customerId` to a real user).
- **Path B — src/data/api/:** no change needed — `add` already posts the whole
  `NewMembershipInput` to `POST /memberships`.
- **DB/migration:** none (document model — `enrolleeName` lives inside `data` jsonb).
- **Swagger:** add optional `enrolleeName` to the `NewMembershipInput` schema in
  `backend/src/swagger.ts` and note `customerId` accepts a `walkin:<name>` key.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; `npx tsc --noEmit` at the
  repo root. Smoke: POST a membership with `customerId: "walkin:ramesh kumar"` +
  `enrolleeName: "Aarav"` and confirm it lists under the business's members.

## [SYNC-010] Calls: `listForBusiness` (workspace call log, last 7 days)

- **Area:** CallRepository / calls (new workspace screen `app/workspace/[businessId]/calls.tsx`)
- **Supabase change:** `src/data/supabase/calls.ts` gained
  `listForBusiness(businessId, sinceIso?)`: `since = sinceIso ?? now - 7 days`; selects
  `data` from `calls` where `business_id = businessId` and `created_at >= since`, ordered by
  `created_at` desc; runs each row through the existing `sweepOne()` (so a call that rang out
  reads as `missed`, persisting + notifying like every other read path) and returns them
  sorted by `startedAt` desc. Added the module constant `CALL_LOG_WINDOW_MS = 7 days`.
  The mock (`src/data/mock/mockRepositories.ts` → `MockCallRepository.listForBusiness`) is
  identical: `sweepCalls()` first, filter by business + `startedAt >= since`, sort desc.
- **Domain/interface:** DONE (shared) — `CallRepository.listForBusiness(businessId: string,
  sinceIso?: string): Promise<Call[]>` in `src/data/repositories.ts`.
- **Path B — backend/:** add `listForBusiness` to `backend/src/services/calls.ts` mirroring
  the mock: sweep ring-timeouts (reuse whatever the service already does for
  `getById`/`getIncomingForUser` — 30s `RING_TIMEOUT_MS` → status `missed` + `endedAt` +
  missed-call notifications), then return this business's calls with
  `startedAt >= since` (default now − 7 days), newest first. Router:
  `GET /calls/business/:businessId?since=<iso>` in `backend/src/routers/calls.ts`.
  **Authz:** business members only — `isBusinessMember(businessId, userId)` from
  `backend/src/authz.ts` (this mirrors the `calls_read` RLS policy's member branch; the
  customer branch is irrelevant here since the endpoint is business-scoped).
- **Path B — src/data/api/:** DONE — `createApiCalls().listForBusiness` in
  `src/data/api/repositories.ts` already calls
  `GET /calls/business/{businessId}` with an optional `?since=` query param.
- **DB/migration:** none — `calls.business_id` + `calls.created_at` already exist and
  `calls_business_idx` covers the lookup. RLS already lets members read.
- **Swagger:** document `GET /calls/business/{businessId}` (path param, optional `since`
  ISO query param, returns `Call[]`).
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; `npx tsc --noEmit` at the
  repo root. Smoke: place a call, let it ring out, then open
  Workspace › Customers & chats › Call log and confirm it appears as "Missed".

## [SYNC-011] Notifications: per-user mutes filter Alerts + unread badge

- **Area:** NotificationRepository / notifications (new "Manage notifications" screens)
- **Supabase change:** `src/data/supabase/notifications.ts` now filters MUTED alerts out of
  `listForUser` and `unreadCount`. A local `mutesOf(recipientId)` reads
  `profiles.data->mutedNotifications` (`string[]`); `listForUser` fetches rows + mutes in
  parallel and drops any where `isNotificationMuted(n, mutes)`; `unreadCount` keeps the cheap
  `head: true` count when the user has NO mutes, and otherwise selects the unread rows'
  `data` and counts the ones that survive the filter. Nothing is blocked at WRITE time —
  `notify()` is unchanged, so the work behind a muted alert still exists everywhere else
  (workspace orders, call log, chats). The mock got the same treatment
  (`MockNotificationRepository.mutesOf` reads the in-memory `users` array).
- **Domain/interface:** DONE (shared) — new `src/domain/notifications.ts` (
  `NotificationCategory` = orders|chats|calls|bookings|billing|members|reviews|stall,
  `NOTIFICATION_CATEGORIES`, `categoryOfKind`, `muteKey`, `isCategoryMuted`,
  `isNotificationMuted`, `toggleMute`) and `User.mutedNotifications?: string[]` in
  `src/domain/types.ts`. Keys are `"<businessId>:<category>"`, with businessId `*` meaning
  "everywhere". The repository interface is UNCHANGED — mutes are written through the
  existing `UserRepository.update(id, { mutedNotifications })`.
- **Path B — backend/:** in `backend/src/services/notifications.ts`, apply the same filter:
  load the recipient profile's `data.mutedNotifications` and drop muted rows in
  `listForUser` and `unreadCount` (import `isNotificationMuted` — either from the shared
  `src/domain/notifications.ts` if the backend already reaches into the app's domain folder,
  or port the ~30-line `categoryOfKind` + key check verbatim into
  `backend/src/domain/notifications.ts`; keep the category mapping IDENTICAL or mutes will
  silence the wrong families). No change to any `notify()` call site. Confirm
  `PATCH /users/:id` (the `UserRepository.update` route) passes `mutedNotifications` through
  into `profiles.data` — it merges the whole patch today, so it should already work; add it
  to the User schema in `backend/src/swagger.ts`.
- **Path B — src/data/api/:** no change needed — reads go through the existing
  notification endpoints and writes through the existing `users.update`.
- **DB/migration:** none (document model — `mutedNotifications` lives inside
  `profiles.data`).
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; `npx tsc --noEmit` at the
  repo root. Smoke: as a business owner mute "Orders" in Workspace › Manage notifications,
  have a customer place an order, and confirm no alert/badge appears while the order still
  shows in the workspace orders desk.

## [SYNC-012] Offers on Business + `offerings`/`offers` access services

- **Area:** BusinessRepository / businesses (Workspace › Offers, Manage, business page)
- **Supabase change:** NONE needed, and none was made. `Offer` lives inside `Business` as
  `offers?: Offer[]`, so it rides the existing `data jsonb` document. Both
  `src/data/supabase/businesses.ts` → `update()` and the mock's `update()` already spread the
  patch (`{ ...current, ...patch }` / `Object.assign`), so offers persist through the plain
  `BusinessRepository.update` with no new repo method, no new endpoint and **no SQL migration**.
- **Domain/interface:** DONE (shared) — `src/domain/types.ts` gained `OfferLineKind`,
  `OfferLine` and `Offer`, plus `Business.offers?: Offer[]`. `Offer` is deliberately a
  superset of `Deal` (tag/title/price/wasPrice/emoji) so a future paid Home-carousel
  placement needs no reshaping. `src/domain/access.ts` gained two universal (no-module)
  `ServiceId`s: `'offerings'` (label "Menu & pricing") and `'offers'` (label "Offers").
- **Path B — backend/:**
  1. `backend/src/domain/types.ts` — mirror the three new types verbatim from
     `src/domain/types.ts` (they sit just after `Deal`), and add `offers?: Offer[]` to the
     `Business` interface next to the existing `deals?: Deal[]` on line ~313.
  2. Nothing else. `businessService.update` (`backend/src/services/businesses.ts`) already does
     `Object.assign(business, patch)` and `PATCH /api/businesses/:id` already guards with
     `requireBusinessMember`, so offers round-trip once the type exists.
  3. **Authz note (do NOT skip):** the two new services are enforced CLIENT-side only, exactly
     like the existing seven (`canAccessService` runs in the app). Path B's
     `requireBusinessMember` on `PATCH /businesses/:id` is what actually gates the write, so
     any member can still write `offers`/`menu`/`services` at the API level. If per-service
     enforcement is ever added server-side, do it for all nine ids at once rather than
     special-casing these two.
- **Path B — src/data/api/:** nothing. `repositories.ts` → `businesses.update` already sends
  the whole patch through `http.patch('/businesses/:id', patch)`.
- **Not a Path B concern:** `src/domain/access.ts` was also refactored to take a `Viewer`
  object instead of a bare `viewerId` (so super-admins pass every check, matching
  `0004_super_admin.sql`). That file has NO backend twin — `backend/src/domain/types.ts`
  keeps `Employee.permissions?: string[]` and nothing reads it server-side. Nothing to port.
- **DB/migration:** none (document model).
- **Verify:** `cd backend && npm run typecheck && npm run build`; then with
  `EXPO_PUBLIC_BACKEND=api`, create an offer in Workspace › Offers and confirm it renders under
  the description on the business page after a reload.

## [SYNC-013] SECURITY: super-admin grant moves to `platform_admins`

- **Area:** authz / super-admin (`backend/src/lib/superAdmin.ts`)
- **Why:** `isSuperAdmin()` decided platform-operator status from
  `profiles.data ->> 'isSuperAdmin'` and a phone allow-list — both inside a document
  every user can rewrite (`profiles_update`, and on Path B `PATCH /api/users/:id`).
  Any signed-in user could promote themselves and then update ANY business.
  **Path B is currently vulnerable in exactly the same way and this entry is the fix.**
- **Supabase change:** new migration `supabase/migrations/0006_platform_admins.sql` —
  creates `platform_admins (user_id pk, note, granted_at)` with RLS on and NO write
  policy (service role only, read-own for the app), migrates existing admins across,
  repoints `public.is_super_admin()` at the table, adds a BEFORE UPDATE trigger on
  `profiles` stripping `isSuperAdmin` and pinning `phone`, and clears the stale flag.
  Client side: `User.isSuperAdmin` is now DERIVED per session — `src/data/supabase/shared.ts`
  gained `fetchIsSuperAdmin()` / `withAdminFlag()`, the auth repo stamps it on every
  session-establishing call, and `users.update` strips it before writing.
- **Domain/interface:** DONE (shared) — `src/domain/superAdmin.ts` → `isSuperAdminUser`
  now trusts ONLY `user.isSuperAdmin` (the derived flag); the phone list is documented
  as provisioning/mock-only and is no longer a trust path.
- **Path B — backend/:**
  1. `prisma db pull` to pick up the new `platform_admins` table (or hand-add the model:
     `model PlatformAdmin { userId String @id @map("user_id") @db.Uuid; note String?;
     grantedAt DateTime @default(now()) @map("granted_at"); @@map("platform_admins") }`).
  2. `backend/src/lib/superAdmin.ts` → replace the body of `isSuperAdmin(uid)` with a
     lookup: `return (await prisma.platformAdmin.count({ where: { userId: uid } })) > 0;`
     Delete the `SUPER_ADMIN_PHONES` / `isSuperAdminPhone` trust path (keep the constant
     only if something still needs it for provisioning — nothing on the server does).
  3. `backend/src/services/users.ts` → `update()` must WHITELIST editable fields rather
     than spreading `req.body`. Allow `name`, `isProfilePublic`, `mutedNotifications`,
     `avatarUrl`; drop everything else, `isSuperAdmin` and `phone` especially. Prisma
     uses the privileged connection, so the 0006 trigger does NOT protect this path —
     the whitelist is the only guard on Path B.
- **Path B — src/data/api/:** `auth.ts` must stamp the derived flag like the Supabase
  repo does. Simplest: add `GET /api/users/me/is-super-admin` (requireAuth, returns
  `{ isSuperAdmin: await isSuperAdmin(userId(req)) }`) and have the api auth repo call it
  wherever it builds the session user, mirroring `withAdminFlag`.
- **DB/migration:** `supabase/migrations/0006_platform_admins.sql` — SHARED DB, apply once.
  Path B needs it applied before its Prisma model resolves.
- **Verify:** `cd backend && npm run typecheck && npm run build`. Then, as a NON-admin user,
  confirm `PATCH /api/users/<own id>` with `{"isSuperAdmin":true}` does NOT grant anything
  (re-read the profile, and check a super-admin-only route still 403s).

## [SYNC-014] SECURITY: contact details split into `profiles_private`

- **Area:** UserRepository / profiles (+ notifications mute lookup)
- **Why:** `profiles_read` is `using (true)` (public directory), and the whole domain
  `User` — phone and email included — sat in that one world-readable `data` document.
  RLS is row-level and cannot hide a field, so `GET /rest/v1/profiles?select=data`
  dumped every user's phone + email to anyone holding the public anon key. On Path B
  the equivalent is `GET /api/users` and `GET /api/users/search`, which return full
  profiles through `optionalAuth` — i.e. **to guests**. Path B is vulnerable today.
- **Supabase change:** migration `supabase/migrations/0007_profiles_private.sql` —
  new `profiles_private (id uuid pk → profiles, data jsonb, updated_at)` holding
  `phone`, `email`, `mutedNotifications`; RLS select = `id = auth.uid() or is_super_admin()`,
  insert/update = own row only. Values backfilled out of `profiles.data` and stripped
  from it; `handle_new_user` now writes both halves; the 0006 `protect_profile_fields`
  trigger extended (and an INSERT twin added) to strip all four private keys.
  Client: `src/data/supabase/shared.ts` gained `PRIVATE_PROFILE_KEYS`,
  `fetchPrivateProfile`, `fetchPrivateProfiles`; `fetchProfile` merges both halves;
  `users.update` partitions the write; `users.list`/`search` merge only what RLS
  returns; `notifications.ts` → `mutesOf` reads `profiles_private`.
- **Domain/interface:** DONE (shared) — `src/domain/types.ts` `User` doc now states
  `phone`/`email` are private and may be absent on other people's Users.
- **Path B — backend/:**
  1. `prisma db pull` for `profiles_private` (or add the model by hand, `@@map("profiles_private")`).
  2. `backend/src/services/users.ts` — Prisma bypasses RLS, so the API must enforce the
     split ITSELF. `list()` and `search()` must return the PUBLIC card only (strip
     `phone`, `email`, `mutedNotifications`) unless the caller `isSuperAdmin(uid)`.
     `getById(id)` returns the public card plus the private half only when
     `id === uid || isSuperAdmin(uid)`. `update()` must write the two halves separately
     — and see [SYNC-013] for the field whitelist it also needs.
  3. `backend/src/services/notifications.ts` — the mute lookup must read
     `profiles_private`, not `profiles`.
  4. `backend/src/routers/users.ts` — `GET /` and `GET /search` are `optionalAuth`, so
     guests hit them. Keep them public (the directory needs names) but ONLY after the
     service strips private fields. Do not "fix" this by requiring auth: a signed-in
     stranger is exactly the threat model here.
- **Path B — src/data/api/:** no signature changes; the endpoints return the same
  `User` shape with fields absent. Confirm `api/auth.ts` `signInAs` still reads
  `profile.phone` and fails gracefully when it's absent (mirrors the Supabase repo).
- **DB/migration:** `supabase/migrations/0007_profiles_private.sql` — SHARED DB, apply
  once, and 0006 must be applied first (`is_super_admin()`).
- **Verify:** `cd backend && npm run typecheck && npm run build`. Then as a guest (no
  token) call `GET /api/users` and confirm no `phone` or `email` appears in the response;
  as a super-admin confirm they do.

## [SYNC-015] SECURITY: an employee can seize the business (ownership + rank)

- **Area:** authz — businesses PATCH, employees add/update/remove
- **Why:** two chained holes. (1) `businesses_update` authorises with
  `is_business_member`, which never inspects `owner_id` — so a staff member could set
  `owner_id` (or just the `data.ownerId` the app actually reads) to themselves and own
  the shop. (2) `employees_write` was `FOR ALL` to any member and `Employee.level` lives
  in `data`, so staff could promote themselves to manager.
  **Path B is fully vulnerable and the new triggers do NOT protect it** — they skip their
  checks when `auth.uid()` is null, which is exactly the Prisma/service-role connection.
  Path B must reimplement these rules in `authz`.
- **Supabase change:** migration `supabase/migrations/0008_business_ownership_lock.sql` —
  adds `is_business_owner()` / `is_business_manager()`; a BEFORE UPDATE trigger on
  `businesses` that (a) allows an `owner_id` change only for the current owner or a
  super-admin, (b) requires manager+ to change `employeeIds`/`callHandlerIds`/
  `chatRecipientIds`/`scanHandlerIds`/`modules`, and (c) force-syncs `data.ownerId` to the
  column on every write (plus an INSERT twin); splits `employees_write` into
  owner-only INSERT/DELETE + member UPDATE, with a trigger blocking changes to
  `level`, `userId`/`user_id` and `business_id` by anyone but the owner.
- **Domain/interface:** none — no shape changes.
- **Path B — backend/:**
  1. `backend/src/services/businesses.ts` → `update()` currently does
     `Object.assign(business, patch)`. Strip `ownerId` and `id` from the patch outright
     (ownership moves only through `reassignOwner`), and after assigning, force
     `business.ownerId` to the row's `ownerId` column so the document can't drift.
     Never write the `ownerId` column from `update()`.
  2. `backend/src/routers/businesses.ts` → `PATCH /:id` keeps `requireBusinessMember`,
     but add a manager-or-owner check when the body touches `employeeIds`,
     `callHandlerIds`, `chatRecipientIds`, `scanHandlerIds` or `modules`.
  3. `backend/src/authz.ts` → add `isBusinessManager(businessId, uid)` (owner, or an
     employee row whose `data.level === 'manager'`) and `requireBusinessManager`.
  4. `backend/src/routers/employees.ts` → `POST /business/:businessId` and
     `DELETE /:id` must use `requireOwner` (which already exists) or super-admin, NOT
     `requireBusinessMember`. `PATCH /:id` stays member-level BUT the service must reject
     changes to `level`, `userId` and `businessId` unless the actor owns the business or
     is a super-admin. Also fix the fail-open `if (emp)` guards while you're in there —
     throw `notFound()` when the row is missing instead of skipping the check.
- **Path B — src/data/api/:** none.
- **DB/migration:** `supabase/migrations/0008_business_ownership_lock.sql` — SHARED DB,
  apply once; needs 0006 (`is_super_admin`).
- **Verify:** `cd backend && npm run typecheck && npm run build`. Then as a STAFF member:
  `PATCH /api/businesses/:id {"ownerId":"<me>"}` must not change ownership (re-read it),
  `PATCH /api/employees/<own row> {"level":"manager"}` must 403, and
  `DELETE /api/employees/<any>` must 403. As a MANAGER, granting `permissions` on a
  teammate's row must still succeed.

## [SYNC-016] SECURITY: order pricing & state transitions are no longer client-trusted

- **Area:** OrderRepository / orders (create, append, proposal) + billing
- **Why:** `orders_update` let the CUSTOMER rewrite their own order document. Place an
  order, let the business accept it (dine-in tabs and accepted proposals stay open by
  design), then rewrite the line prices to zero — "Move to billing" bills from
  `order.lines`, so the bill totals ₹0 and the business never re-checks because it
  already approved. Same write also forged `status`, `billId` and `respondedByName`.
  **Path B is PARTLY protected already**, and this matters for how you fix it: it has no
  generic `PATCH /orders/:id`, only per-transition endpoints whose logic runs on the
  server — so status forgery is not reachable there. What IS reachable is **price
  trust**: `POST /orders` and `POST /orders/:id/append` take line prices straight from
  the request body.
- **Supabase change:** migration `supabase/migrations/0009_order_integrity.sql` —
  adds `catalog_price(bid, line)` (looks a line's unit price up in the business's own
  menu/products/services/rentals/partyPackages by name); a BEFORE INSERT trigger
  `sanitize_customer_order` that, for a non-member actor, forces `status='requested'`,
  strips `billId`/`respondedByName`/`responseMessage`, pins `customerId`/`businessId`
  to the scoping columns, and rebuilds every line keeping only kind/name/quantity/
  offerPrice with a catalog-derived `price` and `included=true`; narrows
  `orders_update` to business members only; and adds two SECURITY DEFINER functions,
  `decide_order_proposal(order_id, accept)` and `append_order_lines(order_id, new_lines)`,
  as the customer's only two mutations (execute granted to `authenticated` only).
  Client: `src/data/supabase/orders.ts` → `decideProposal` and `appendLines` now call
  those RPCs instead of writing; `create` reads the row back so it returns what was
  actually stored.
- **Domain/interface:** none — no shape changes.
- **Path B — backend/:**
  1. Port `catalogPrice(business, line)` into `backend/src/services/orders.ts` (or
     `lib/`): match `line.name` case-insensitively against the business's `menu`,
     `products`, `services`, `rentals` and `partyPackages`, return that item's `price`.
  2. `orderService.create()` — when the actor is NOT a business member, ignore
     `input.lines[].price` and use `catalogPrice(...) ?? input price`; force
     `status='requested'`, no `billId`, and drop any client-sent `counterPrice`/
     `included`. `create` currently takes no actor, so thread the caller's uid in from
     the router (`routers/orders.ts` already has it for `requireCustomerOrMember`).
  3. `orderService.appendLines()` — same price derivation; it already forces
     `status='requested'` server-side, so only the pricing needs fixing.
  4. Leave `respond` / `moveToBilling` / `markDelivered` alone — they're member-only
     and their prices ARE authoritative.
- **Path B — src/data/api/:** none. `decideProposal`/`appendLines` already POST to
  transition endpoints; the server does the work.
- **DB/migration:** `supabase/migrations/0009_order_integrity.sql` — SHARED DB, apply
  once. Note the trigger and both functions no-op their checks when `auth.uid()` is
  null, i.e. on Prisma's service-role connection — Path B gets NO protection from them
  and must do the above itself.
- **Verify:** `cd backend && npm run typecheck && npm run build`. Then as a customer,
  `POST /api/orders` with a line priced `"₹0"` for an item the business lists at ₹120 —
  re-read the order and confirm the stored price is ₹120.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

---

## [SYNC-017] Voice-call ring timeout must use the SERVER clock, not the device's

- **Area:** CallRepository / calls
- **Supabase change:** `src/data/supabase/calls.ts` — `sweepOne(call, createdAt?)` now measures
  a call's age from the row's **server `created_at`** against a **server-anchored now**, instead
  of `data.startedAt` vs the reader's `Date.now()`. Every read path (`getById`, `join`,
  `decline`, `leave`, `getIncomingForUser`, `listForBusiness`) selects `created_at` and passes
  it; `getById`/`getIncomingForUser`/`listForBusiness` `await syncServerClock()` first.
  New helpers in `src/data/supabase/shared.ts`: `syncServerClock()` / `serverNow()` (offset
  learned from the `server_now()` RPC, falling back to the HTTP `Date` header, then the local
  clock; 5-min refresh, 15s retry floor). `src/lib/supabase.ts` now exports `SUPABASE_URL` /
  `SUPABASE_ANON_KEY`.
- **Why:** the caller stamped `startedAt` with ITS clock and every business member's poll judged
  it against THEIRS. A phone running ~39s fast expired brand-new calls on its first poll — the
  caller saw "No answer" in ~2s and that phone never rang (the sweep beats the ringing check).
- **Domain/interface:** none.
- **Path B — backend/:** **likely NOTHING to do.** `backend/src/services/calls.ts` `sweepCall()`
  already runs server-side, and `start()` generates `startedAt` on the same machine, so both
  sides of the comparison share one clock. **Verify only** — confirm `sweepCall` compares
  server-generated values; if it ever reads a client-supplied timestamp, switch it to the row's
  `createdAt` column.
- **Path B — src/data/api/:** nothing.
- **DB/migration:** `supabase/migrations/0010_server_now.sql` — `public.server_now()`, a
  `stable` SQL function returning `now()`, execute granted to `anon, authenticated`. Shared DB,
  apply once. Path B does not need it (it has a real server clock).
- **Verify:** backend typecheck/build; confirm no client timestamp feeds a timeout decision.

---

## [SYNC-018] Push tokens + `call-ring`: ring a business whose app is CLOSED

- **Area:** New PushRepository; CallRepository.start side effect
- **Supabase change:**
  - New `src/data/supabase/push.ts` → `createSupabasePush()`: `register(token, platform)`
    upserts `{token, user_id: <caller>, platform, updated_at}` into `push_tokens`
    (`onConflict: 'token'`, so a handset changing hands reassigns rather than duplicates);
    `unregister(token)` deletes by token (RLS scopes it to the caller). Both no-op on an empty
    token; `register` no-ops for a guest. Registered in `src/data/supabase/index.ts`.
  - `src/data/supabase/calls.ts` → `start()` now fires
    `sb().functions.invoke('call-ring', { body: { callId } })` after the insert, **not awaited
    and errors swallowed** — a failed push must never stop a call being placed.
  - New edge function `supabase/functions/call-ring/index.ts`: verifies the caller's JWT,
    requires that they are the call's `customerId`, requires `status === 'ringing'`, collects
    business participants still in state `ringing`, reads their tokens with the SERVICE ROLE
    (RLS hides other users' tokens by design), and POSTs to
    `https://exp.host/--/api/v2/push/send` with `priority: 'high'`, `channelId: 'calls'`,
    `ttl: 30`, `data: { callId, kind: 'incoming_call' }`.
- **Domain/interface:** `PushRepository` added to `src/data/repositories.ts` and to the
  `Repositories` type (**shared — already done**). Mock impl `MockPushRepository` (in-memory
  Map, never sends) already added.
- **Path B — backend/:**
  - Prisma: introspect the new `push_tokens` table (`prisma db pull`) — columns
    `token text PK`, `user_id uuid FK profiles`, `platform text`, `created_at`, `updated_at`.
  - `backend/src/services/push.ts`: `register(userId, token, platform)` = upsert by token
    (**must overwrite `user_id`** so a shared handset follows the current account);
    `unregister(userId, token)` = delete where token AND user_id = caller.
  - `backend/src/services/calls.ts` → `start()` calls a new `ringDevices(call)`: same target
    selection + Expo push POST as the edge function above. Best-effort; never throws into
    `start()`.
  - Router `backend/src/routers/push.ts`: `POST /push/tokens` `{token, platform}` and
    `DELETE /push/tokens/:token`, both **authenticated, self-only** (userId comes from the JWT,
    never the body). Add to Swagger.
  - Authz note: a push token is a routable address for a device — never expose a read/list
    endpoint, and never let one user register or delete another's token.
- **Path B — src/data/api/:** **already written** — `createApiPush()` in
  `src/data/api/repositories.ts` posts `/push/tokens` and deletes `/push/tokens/:token`, wired
  in `src/data/api/index.ts`. Until the routes exist these 404, which the caller swallows.
- **DB/migration:** `supabase/migrations/0011_push_tokens.sql` (table + RLS: own rows only;
  UPDATE uses `using (true) with check (user_id = auth.uid())` so a handset can change hands).
  Shared DB, apply once.
- **Verify:** backend typecheck/build; `POST /push/tokens` upserts and cannot write another
  user's row; starting a call pushes to registered devices and still succeeds when push fails.
