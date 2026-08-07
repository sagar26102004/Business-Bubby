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

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->
