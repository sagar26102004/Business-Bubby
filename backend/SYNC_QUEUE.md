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

## [SYNC-019] Call push must carry title/body again (buttons on a closed app)

- **Area:** CallRepository / calls — the push that rings a closed app
- **Supabase change:** `supabase/functions/call-ring/index.ts` — the Expo push message
  went back to carrying `title` / `body` / `sound` alongside the existing `data`,
  `categoryId: 'incoming_call'`, `channelId: 'calls_v2'`, `ttl: 30`, `priority: 'high'`,
  `_contentAvailable: true`. It was briefly data-only so that Android would draw nothing and
  leave the field to the app's native CallStyle popup; when that popup didn't appear on a
  closed app there was nothing to fall back to, and the phone rang showing an empty
  notification with no way to answer. With a title present, Android renders its own
  notification and `categoryId` puts Accept/Decline on it. The native service
  (`modules/call-notification`) consumes the message before expo-notifications sees it
  whenever it runs, so there is no double notification.
- **Domain/interface:** none.
- **Path B — backend/:** `backend/src/services/calls.ts` → `ringDevices()`. Add to each
  message object, keeping everything else as-is:
  ```ts
  title: `📞 ${call.customerName}`,
  body: `Incoming call for ${call.businessName}`,
  sound: 'default',
  ```
  Replace the "DATA-ONLY on purpose" paragraph in the `ringDevices` doc comment — it now
  states the opposite of what the code does. Say instead that the title/body are the fallback
  Android renders when the app's own notification service doesn't handle the message, and that
  `categoryId` is what gives that fallback its buttons.
- **Path B — src/data/api/:** none.
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`.

## [SYNC-020] Ring push must report Expo's tickets, not assume success

- **Area:** CallRepository / calls — the push that rings a closed app
- **Supabase change:** `supabase/functions/call-ring/index.ts` now reads the per-message
  tickets Expo returns instead of reporting `messages.length` as "sent". Expo answers every
  `/push/send` with HTTP 200 and a `data: Ticket[]` array in which an individual message can
  still be `{ status: 'error', message, details: { error } }` — so the old count claimed
  success for the two failures that actually happen: `InvalidCredentials` (no FCM V1 key on
  the EAS project, so every Android push fails) and `DeviceNotRegistered` (token belongs to a
  gone install). Both are indistinguishable from "the phone ignored it" without this.
- **Domain/interface:** none. `src/features/notifications/ringPushLog.ts` gained optional
  `attempted` / `failures` fields on `RingPushResult` (already done, shared by both backends),
  and `CallAlertsCheck` renders them.
- **Path B — backend/:** `backend/src/services/calls.ts` → `ringDevices()`. After the
  `fetch` to `https://exp.host/--/api/v2/push/send`, parse the response body's `data` array
  index-aligned with the tokens sent (Expo preserves order):
  - delete `push_tokens` rows whose ticket has `details.error === 'DeviceNotRegistered'`
    (ONLY that error — never prune on `InvalidCredentials`, which is a project
    misconfiguration and would destroy good tokens);
  - return `{ sent: <count of status==='ok'>, attempted: <messages.length>, failed,
    failures: <distinct ticket.message strings>, reason }`, where `reason` is the joined
    failure messages when nothing was accepted.
  Keep Expo's messages verbatim — they name their own fix.
- **Path B — src/data/api/:** none (the ring is fired server-side; the client just records
  whatever JSON comes back through `recordRingPush`).
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`.
- **Not applicable to Path B:** the same commit added CORS headers + an `OPTIONS` handler to
  `call-ring`, whose absence meant a browser preflight failed and the ring push was never
  sent from web callers at all. That is a Supabase-edge-function transport bug only — Path B
  fires its ring inside the Express server, with no browser hop to preflight. Just make sure
  the API's own CORS middleware keeps covering the routes the web app calls.

## [SYNC-021] Decline from a closed app must reach the server

- **Area:** CallRepository / calls — the Decline button on the incoming-call notification
- **Supabase change:** new edge function `supabase/functions/call-decline/index.ts`, deployed
  with `--no-verify-jwt`. Body `{ callId, pushToken }`. A killed app has no session, so the
  device's Expo push token IS the credential: the function looks it up in `push_tokens` with
  the service role to resolve the user, requires that user to be a `side: 'business'`
  participant whose `state === 'ringing'` on that call, then applies exactly the same
  transition as `decline()` in `src/data/supabase/calls.ts` (set the participant to
  `declined`; if no business participant is left `ringing` or `joined`, set the call to
  `declined` when it was ringing / `ended` when it was active, stamping `endedAt`).
  Previously the Kotlin receiver only silenced the phone locally, so the caller kept ringing
  for the rest of the 30s window and the call landed in the missed log — declining and
  ignoring were indistinguishable from the caller's side.
- **Domain/interface:** none. Native side (`modules/call-notification`) gained
  `setDeclineEndpoint(url, pushToken)`, called from `PushRegistrar` after
  `repos.push.register` succeeds — both already done and backend-agnostic apart from the URL.
- **Path B — backend/:** add `POST /calls/:callId/decline-by-device` (no auth middleware —
  it must work without a JWT) in the calls router, delegating to a new
  `declineByDevice(callId, pushToken)` in `backend/src/services/calls.ts` with the logic
  above. Authz is the push-token lookup itself; do NOT let it fall through to the normal
  `decline` guard, which expects an authenticated user. Document it in Swagger, noting that
  the push token is the credential and why.
- **Path B — src/data/api/:** none directly, BUT `PushRegistrar` builds the decline URL from
  `SUPABASE_URL`. When Path B is selected it must instead point at
  `${EXPO_PUBLIC_API_URL}/calls/decline-by-device`-shaped route — thread the base URL through
  so the native side is told the right endpoint for the active backend.
- **DB/migration:** none (`push_tokens` from 0011 is enough).
- **Verify:** `cd backend && npm run typecheck && npm run build`.

## [SYNC-022] `PushRepository.isRegistered` — prove the SERVER will ring this phone

- **Area:** PushRepository / push_tokens
- **Supabase change:** `src/data/supabase/push.ts` gained `isRegistered(token)` — selects
  `push_tokens` by `token` AND `user_id = <caller>` and returns whether a row came back
  (errors return false: the row asserts confirmation, and an unreachable server confirms
  nothing). No migration; the existing RLS SELECT policy already scopes to own rows.
- **Domain/interface:** `src/data/repositories.ts` → `PushRepository.isRegistered(token:
  string): Promise<boolean>` (shared, done). Mock implemented in
  `src/data/mock/mockRepositories.ts` (`pushTokens.has(token)`).
- **Why:** `CallAlertsCheck` showed "Registered for calls while closed ✅" purely because
  `getPushToken()` returned a token — a device-side fact. Registration is a SEPARATE
  server-side write that `PushRegistrar` swallows on failure and skips entirely for guest /
  anonymous sessions. So a phone could look fully healthy while `call-ring` reported "no
  registered devices", with both sides telling the truth. The check is now split into "This
  phone has a push address" and "Your account will be rung on this phone".
- **Path B — backend/:** add `GET /push/tokens/:token/registered` returning a bare boolean.
  Authz: authenticated user only; it must answer for the CALLING user's own token —
  `select … where token = :token and user_id = <jwt user>` — never a bare token lookup, or it
  becomes an oracle for whether someone else's device is registered.
- **Path B — src/data/api/:** already added —
  `isRegistered: (token) => http.get<boolean>('/push/tokens/'+seg(token)+'/registered')`.
  Just make the route exist.
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`; app `npx tsc --noEmit`.
- **Also in the same change (frontend, backend-agnostic — no Path B work, just don't undo it):**
  `register()` on the Supabase side now THROWS instead of returning quietly when there is no
  session or no token; `PushRegistrar` retries on every app foreground until a token sticks
  (it was a single silent attempt at cold start, so one throw on a network-less launch left
  the phone permanently unreachable); and `CallAlertsCheck` grew a "Register this phone now"
  button that prints the server's own error. Path B's `POST /push/tokens` should likewise
  answer with a real error status rather than a silent 200 when it cannot resolve the user.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

