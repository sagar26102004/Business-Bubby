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
  (`supabase/functions/dynamic-responder/index.ts`; display name "livekit-token"), which verifies the caller's JWT, confirms
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

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->
