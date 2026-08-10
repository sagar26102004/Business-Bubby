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

## [SYNC-019] Ring push must be strictly data-only — drop `channelId` too

> ⚠️ REPLACES an earlier [SYNC-019] that told Path B to ADD `title` / `body` / `sound`.
> That instruction was wrong and would reintroduce the bug below. Do NOT restore it.

- **Area:** CallRepository / calls — the push that rings a closed app
- **Supabase change:** `supabase/functions/call-ring/index.ts` now sends a strictly data-only
  Expo push: `to`, `priority: 'high'`, `categoryId: 'incoming_call'`, `ttl: 30`, `data`,
  `_contentAvailable: true` — and NOTHING else. `title`, `body`, `sound` and `channelId` were
  all removed.
- **Why (measured on a real phone 2026-08-10, realme RMX3241 / Android 13):** Expo's push
  service emits an FCM `android.notification` block if handed ANY field that belongs in one —
  including `channelId` on its own, because that is where `android_channel_id` has to live.
  That block sets `gcm.n.e=1`, and `FirebaseMessagingService.handleIntent()` renders such a
  message ITSELF and returns *before* `onMessageReceived` whenever the app is backgrounded. The
  native `CallMessagingService` was correctly selected (`priority="100"` beats
  expo-notifications' `-1`; confirmed via `adb shell cmd package query-services -a
  com.google.firebase.MESSAGING_EVENT`) and then simply never invoked — so the CallStyle popup,
  the full-screen call screen and even the ring log never ran. Removing `title`/`body` alone is
  NOT enough: `channelId` still triggers it, and the result is a genuinely BLANK notification
  drawn by FCM on calls_v2 (`dumpsys notification` → `tag=FCM-Notification:*`,
  `android.title=null`). That blank render is what made the earlier data-only attempt look like
  a failure and get reverted.
- **Cost of dropping `channelId`:** none for the real path — the popup is posted natively on
  `CallNotifications.RING_CHANNEL_ID` (`'calls_v2'`), and that channel owns the ringtone and
  vibration. Only expo-notifications' last-resort render loses the channel and lands on the
  default one; `categoryId` still gives it Accept/Decline.
- **Domain/interface:** none.
- **Path B — backend/:** `backend/src/services/calls.ts` → `ringDevices()`. It is already
  data-only for title/body, but **still sends `channelId: CALL_CHANNEL_ID`** — remove that
  line and the now-unused `CALL_CHANNEL_ID` const. Keep `priority`, `categoryId`, `ttl`,
  `data`. Extend the "DATA-ONLY on purpose" doc comment to say that `channelId` counts as a
  notification field for this purpose, since that is the non-obvious half.
- **Path B — src/data/api/:** none.
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`. Behavioural check needs a
  real device: `adb logcat -s LocaloCall` during a call must show `call <id> from <name>` →
  `posted the CallStyle notification`, and `FirebaseMessaging: Showing notification` must NOT
  appear.

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
- **DB/migration:** `supabase/migrations/0012_push_tokens_handset_handover.sql` — SHARED DB,
  apply once. Makes the `push_tokens` UPDATE policy's `using` permissive so an upsert can
  reassign a token from the account that previously used that handset (it was failing with
  42501 "(USING expression)", which is why no device was ever registered). Path B connects
  privileged and bypasses RLS, so it needs no code change — but do not "tidy" the policy back.
- **Verify:** `cd backend && npm run typecheck && npm run build`; app `npx tsc --noEmit`.
- **Also in the same change (frontend, backend-agnostic — no Path B work, just don't undo it):**
  `register()` on the Supabase side now THROWS instead of returning quietly when there is no
  session or no token; `PushRegistrar` retries on every app foreground until a token sticks
  (it was a single silent attempt at cold start, so one throw on a network-less launch left
  the phone permanently unreachable); and `CallAlertsCheck` grew a "Register this phone now"
  button that prints the server's own error. Path B's `POST /push/tokens` should likewise
  answer with a real error status rather than a silent 200 when it cannot resolve the user.

## [SYNC-023] AdRepository — the paid ad slot on Home

- **Area:** NEW `AdRepository` / ad campaigns. Path B currently delegates `ads` to the MOCK
  (`src/data/api/index.ts` → `ads: mock.ads`), so ads are per-session and don't match Path A.
  This entry replaces that delegation with real API calls.
- **Supabase change:** new `src/data/supabase/ads.ts`, registered in `src/data/supabase/index.ts`.
  Implements every method of `AdRepository`.
- **Domain/interface (SHARED — already done, do not redo):**
  - `src/domain/types.ts` — `AdCampaign`, `AdCampaignStatus`, `Offer.imageUrl`, and a new
    `'ad_update'` member of `AppNotification['kind']`.
  - `src/domain/ads.ts` — `AD_PLANS` rate card, `FREE_REACH_KM`, `getAdPlan`,
    `isCampaignRunning`, `isCampaignFinished`, `campaignDaysLeft`, `campaignStatusLabel`,
    `campaignTapRate`.
  - `src/domain/offers.ts` — `isOfferLive`/`liveOffers` MOVED here out of
    `features/businesses/offerUtils.ts` (which now re-exports them) so the data layer can use
    them without importing from `features/`.
  - `src/domain/notifications.ts` — new `'ads'` mute family; `ad_update` maps to it.
  - `src/data/repositories.ts` — `AdRepository`, `AdPlacement`, `NewAdCampaignInput`,
    `ads: AdRepository` on the `Repositories` bundle.
  - `src/data/adPlacements.ts` — `buildPlacements(running, businesses, near, now)`, the SHARED
    reach/ordering rule (sponsored first within the bought radius, then any live offer within
    `FREE_REACH_KM`, nearest-first inside each band). Path B's client should call
    `listPlacements` on the server, but the server must produce the SAME order; port this file's
    logic into `backend/src/services/ads.ts` rather than inventing a second rule.
- **Path B — backend/:** new `backend/src/services/ads.ts` + router `backend/src/routers/ads.ts`
  over the `ad_campaigns` table (Prisma: `{ id, businessId, status, data, createdAt }` — run
  `prisma db pull` after the migration below). Port the Supabase file method-for-method:
  - `GET /ads/placements?lat=&lng=` → `AdPlacement[]`. Load campaigns with `status='active'`,
    keep those passing `isCampaignRunning` (use the SERVER clock), load the businesses they
    reference plus (when lat/lng given) all businesses, then `buildPlacements`.
  - `GET /ads/business/:businessId` → members only. `GET /ads` → super-admin only, all campaigns.
  - `POST /ads` → `request`. Authz: caller must be a business member. Validates the plan exists,
    the offer exists and `isOfferLive`, and that the same offer has no `pending`-or-running
    campaign. **Always writes `status: 'pending'`** and freezes `radiusKm`/`days`/`amount` from
    the plan — the client never supplies them.
  - `POST /ads/:id/approve` (super-admin) — sets `status='active'`, `startsAt = now`,
    `endsAt = now + days`, `reviewedAt`, optional `reviewNote`; notifies the business owner with
    kind `ad_update`. The clock starts at APPROVAL, not at request.
  - `POST /ads/:id/reject` (super-admin) — `status='rejected'` + note + `ad_update` notify.
  - `POST /ads/:id/stop` — business member OR super-admin; `status='stopped'`, `endsAt = now`.
  - `POST /ads/:id/paid` (super-admin) — `{ paid: boolean }`.
  - `POST /ads/:id/events` `{ kind: 'impression' | 'tap' }` — **unauthenticated/any caller**,
    increments `data.impressions`/`data.taps` only when the campaign is running, and always
    answers 204 even on failure (it's fired from a carousel a customer is scrolling past).
  Document all of it in Swagger.
- **Path B — src/data/api/:** add `createApiAds()` to `src/data/api/repositories.ts` hitting the
  routes above, and swap `ads: mock.ads` for it in `src/data/api/index.ts` (delete the ⚠️ comment
  there). `recordImpression`/`recordTap` must swallow all errors.
- **DB/migration:** `supabase/migrations/0014_ad_campaigns.sql` — SHARED DB, apply once. Creates
  `ad_campaigns` + RLS + the `ad_record_event(uuid, text)` SECURITY DEFINER RPC. Path B connects
  privileged and bypasses RLS, so it re-implements the authz in `backend/src/authz.ts` terms;
  the RPC is Path A's way of letting a viewer count without update rights and Path B does not
  need it (its `/events` route plays that role). Do not "tidy" the policies away.
- **Verify:** `cd backend && npm run typecheck && npm run build`; app `npx tsc --noEmit` and
  `npx expo export --platform web`. Smoke: promote an offer → it appears in the super-admin
  queue as pending → approve → it shows on Home with a Sponsored badge.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

