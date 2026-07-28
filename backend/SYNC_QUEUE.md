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

## [SYNC-001] Live voice-call audio — LiveKit token endpoint

- **Area:** CallRepository / calls (real WebRTC audio via LiveKit)
- **Supabase change:** Added `getAudioToken(callId)` to the Supabase CallRepository
  (`src/data/supabase/calls.ts`) — it invokes the edge function at slug `dynamic-responder`
  (`supabase/functions/dynamic-responder/index.ts`), which verifies the caller's JWT, confirms
  they are a participant on the call, and mints a LiveKit access token for room
  `call_<callId>` (identity = user id), returning `{ token, url }`. `livekit-server-sdk` was
  already `npm install`ed into `backend/` in anticipation of this entry.
- **Domain/interface:** DONE (shared) — `CallAudioToken` type + `getAudioToken` added to
  `CallRepository` in `src/data/repositories.ts`; the api client method already added to
  `src/data/api/repositories.ts` (`POST /calls/:callId/token`).
- **Path B — backend/:**
  - Add `POST /calls/:callId/token` in `backend/src/routers/calls.ts`.
  - Service `backend/src/services/calls.ts`: `getAudioToken(callId, userId)` — load the call,
    authorize that `userId` is a participant (mirror the edge function / `authz.ts` call
    guards), then mint the token with `livekit-server-sdk`:
    `new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: userId, name, ttl: '2h' })`,
    `addGrant({ room: 'call_'+callId, roomJoin: true, canPublish: true, canSubscribe: true })`,
    `await at.toJwt()`. Return `{ token, url: LIVEKIT_URL }`.
  - Read `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from `backend/src/config.ts`
    (env). If unset, respond 501 "Live audio is not configured".
  - Document the route in `backend/src/swagger.ts`.
- **Path B — src/data/api/:** DONE — `getAudioToken: (callId) => http.post('/calls/'+callId+'/token', {})`.
- **DB/migration:** none (reuses the `calls` table).
- **Verify:** backend `npm run typecheck`/`build`; server boots and `/docs` lists the new route;
  api-client `npx tsc --noEmit` (already green). End-to-end needs the LIVEKIT_* env + a real call.

## [SYNC-002] Vehicle journeys (saved routes with stops)

- **Area:** TrackingRepository / vehicles
- **Supabase change:** NONE needed — journeys are stored on the `Vehicle` object
  (`Vehicle.journeys: VehicleJourney[]` + `Vehicle.activeJourneyId`) and persisted through the
  existing generic `updateVehicle(id, patch)` (`{ ...current, ...patch }` merge into the
  `vehicles.data` jsonb). Supabase/mock/api all already round-trip it with no code change.
- **Domain/interface:** DONE (shared) — added `JourneyStop`, `VehicleJourney`, and the two new
  optional `Vehicle` fields (`journeys?`, `activeJourneyId?`) to `src/domain/types.ts`. Frontend
  is a new owner screen `src/app/fleet/[businessId]/journey.tsx` that reads/writes them via
  `tracking.updateVehicle`; `RouteMap` extended with `stops`/`fromEmoji`/`fromColor` for the
  route preview. No new repository methods.
- **Path B — backend/:** TYPE-ONLY. Mirror the new shapes in `backend/src/domain/types.ts`:
  add `JourneyStop` + `VehicleJourney` interfaces and the `journeys?: VehicleJourney[]` /
  `activeJourneyId?: string` fields on `Vehicle`. `services/tracking.ts:updateVehicle` already
  spreads the whole object into `data` jsonb, so journeys persist with NO logic change. No new
  router/endpoint, no authz change (updateVehicle stays owner/member-guarded as today).
- **Path B — src/data/api/:** none — `updateVehicle` client method already sends the full patch.
- **DB/migration:** none (jsonb column already holds it).
- **Verify:** backend `npm run typecheck`/`build` stays green after the type mirror; a
  round-trip PATCH `/tracking/vehicles/:id` with a `journeys` array returns it back intact.

## [SYNC-003] Guest voice calls — anonymous sign-in identity

- **Area:** AuthRepository / auth (let guests place calls without a sign-up form)
- **Supabase change:** Added `signInGuest()` to the Supabase AuthRepository
  (`src/data/supabase/auth.ts`): reuses an existing session, else `sb.auth.signInAnonymously()`;
  returns a `User` with `isAnonymous: true, name: 'Guest'`. `getCurrentUser()` now maps a
  `session.user.is_anonymous` session to that same guest User (so a reload stays a guest with a
  real uid). Requires the project's **Anonymous sign-ins** toggle ON (Supabase Auth settings) —
  no SQL/RLS change: anonymous users are in the `authenticated` role, so `calls_insert`
  (`customer_id = auth.uid()`) and the token function's `getUser()` already accept them, and the
  `handle_new_user` trigger creates their profile row (empty name via `coalesce`).
- **Domain/interface:** DONE (shared) — added `User.isAnonymous?` (`src/domain/types.ts`),
  `signInGuest()` to `AuthRepository` (`src/data/repositories.ts`), and wired
  `DataProvider.signInGuest` + `useAuth().isGuest = !currentUser || currentUser.isAnonymous`.
  Frontend: the call pre-screen (`src/app/call/[businessId].tsx`) calls `signInGuest()` before
  `calls.start` when there's no `currentUser`. **The api client twin is already done** —
  `src/data/api/auth.ts` implements `signInGuest()` (same Supabase anonymous sign-in) and marks
  anonymous sessions in `getCurrentUser()`.
- **Path B — backend/:** VERIFY-ONLY (auth identity is Supabase in both paths, so no new
  endpoint). Confirm the Express JWT middleware/`authz.ts` accepts an anonymous Supabase JWT
  (valid `sub`/uid, `is_anonymous` claim) and does NOT require a non-anonymous profile — i.e. an
  anonymous caller can `POST /calls` (start) and `POST /calls/:callId/token`. The customer/member
  guards key on the uid only, so this should already pass; add a test call to be sure.
- **Path B — src/data/api/:** DONE (see above).
- **DB/migration:** none. Operational: enable **Anonymous sign-ins** in the Supabase dashboard.
- **Verify:** backend `npm run typecheck`/`build`; a guest (anonymous JWT) can start a call and
  fetch an audio token end-to-end.

## [SYNC-004] Voice call — never ring the caller / dedupe participants

- **Area:** CallRepository / calls (`start`)
- **Supabase change:** In `src/data/supabase/calls.ts` `start()`, after building the business
  `targets`, exclude any target whose id equals the caller's (`customer.id`) and dedupe by id
  before composing `participants`. Prevents a person who is the business's owner/handler AND the
  caller from appearing twice (duplicate participant id → crashes the session list's React keys)
  and from ringing themselves. If nothing remains after exclusion, throw
  `"You're set to answer this business's calls yourself — there's no one else to ring."` when the
  caller was among the targets, else the existing "No one … can take voice calls" message. Same
  fix already applied to the mock (`src/data/mock/mockRepositories.ts` `start`).
- **Domain/interface:** none (behaviour only).
- **Path B — backend/:** Apply the identical guard in `backend/src/services/calls.ts` `start()`:
  filter the owner/handler targets to exclude `customerId` and dedupe by id before saving
  participants; mirror the empty-after-exclusion error message.
- **Path B — src/data/api/:** none (client passes through).
- **Frontend note (shared, already done):** `src/app/call/session/[callId].tsx` now dedupes
  `call.participants` before mapping (defensive against calls created before this fix).
- **DB/migration:** none.
- **Verify:** backend build/typecheck; a member calling their own business either rings the OTHER
  members only, or errors clearly — never returns a call with a duplicate participant id.

## [SYNC-005] Incoming-call poll — filter by data.status, not a bare column

- **Area:** CallRepository / calls (`getIncomingForUser`) — THE bug that stopped the receiver ever
  ringing.
- **Supabase change:** `src/data/supabase/calls.ts` `getIncomingForUser` was filtering
  `.in('status', [...])` on a non-existent top-level column (the `calls` table is
  `{id, business_id, customer_id, data jsonb, …}` — `status` lives in `data`). Postgres returned
  42703 "column calls.status does not exist" every 2s poll; the gate's `.catch` swallowed it, so no
  incoming call ever surfaced. Fixed to `.in('data->>status', ['ringing','active'])`.
- **Domain/interface:** none.
- **Path B — backend/:** VERIFY `backend/src/services/calls.ts` `getIncomingForUser` does the same
  correctly — with Prisma the `calls` model is `{ data: Json }`, so filter on the JSON path
  (`where: { data: { path: ['status'], in: ['ringing','active'] } }`) or load the caller's visible
  calls and filter in JS by `call.status`. Ensure it does NOT reference a scalar `status` column.
- **Path B — src/data/api/:** none (client passes through).
- **DB/migration:** none.
- **Verify:** a ringing call is returned to a business member's `getIncomingForUser`; the incoming
  overlay appears on the receiver within the poll interval.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->
