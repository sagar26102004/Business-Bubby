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

## [SYNC-024] Deals feed — viewer-chosen radius on `listPlacements`, and `Offer.videoUrl`

> Depends on **[SYNC-023]**. If SYNC-023 has not landed yet, fold this into it rather than
> doing it twice — Path B still delegates `ads` to the mock, so nothing here is broken today.

- **Area:** `AdRepository.listPlacements` + the `Offer` shape (the new `/deals` feed).
- **Supabase change:** `src/data/supabase/ads.ts` → `listPlacements(near?, options?)` now forwards
  `options?.radiusKm` to `buildPlacements` as its 5th argument. No query change: the same rows
  are read, the RULE applied to them differs. Nothing else in the file moved.
- **Domain/interface (SHARED — already done, do not redo):**
  - `src/data/repositories.ts` — new `PlacementOptions { radiusKm?: number }`;
    `listPlacements(near?: GeoPoint, options?: PlacementOptions)`.
  - `src/data/adPlacements.ts` — `buildPlacements(running, businesses, near, now, viewerRadiusKm?)`.
    With a `viewerRadiusKm`: the free band becomes exactly that radius, the cold-start top-up is
    SKIPPED (it exists to fill a fixed 5-card slot; a feed has no slot), a sponsored placement is
    capped at `min(campaign.radiusKm, viewerRadiusKm)`, and a business with no computable distance
    is dropped rather than shown (in the Home slot it is still kept). An offer whose campaign is
    out of its bought reach but inside the viewer's radius still appears — as an ordinary,
    unlabelled card, because it is not a sponsored placement there. Port this behaviour exactly;
    do not re-derive it.
  - `src/domain/types.ts` — `Offer.videoUrl?: string` (the reel). Pure passthrough: no backend
    logic keys on it, the feed just plays it instead of showing `imageUrl`.
- **Path B — backend/:** in `backend/src/services/ads.ts`, `listPlacements` takes an optional
  `radiusKm` and passes it into the ported `buildPlacements`. Router: `GET /ads/placements` gains
  an optional `radiusKm` query param (number, km) — document it in Swagger. `Offer` is stored
  inside `businesses.data`, so `videoUrl` needs NO backend work; just don't strip unknown offer
  fields anywhere.
- **Path B — src/data/api/:** `createApiAds().listPlacements(near, options)` appends
  `&radiusKm=` when `options?.radiusKm` is set.
- **DB/migration:** none for this entry. Separately, `supabase/migrations/0015_media_bucket.sql`
  (public `media` storage bucket + policies) is a SHARED-DB migration to apply once — it is not
  Path B work: `src/lib/upload.ts` talks to Supabase Storage directly on every backend, because
  Path B already requires Supabase for auth.
- **Verify:** `cd backend && npm run typecheck && npm run build`; app `npx tsc --noEmit`. Smoke:
  `GET /ads/placements?lat=&lng=&radiusKm=1` returns strictly fewer placements than `radiusKm=25`
  for the same point.

## [SYNC-025] `BusinessRepository.remove` — the owner takes a listing down

- **Area:** BusinessRepository / businesses
- **Supabase change:** `src/data/supabase/businesses.ts` gained `remove(id, actorId)`. It reads
  the business first, throws `Only the owner can take a listing down.` when
  `ownerId !== actorId`, then `delete from businesses where id = …`. The pre-check exists
  because RLS refuses by returning **0 rows, not an error** — without it a blocked delete would
  report success. No migration: `businesses_delete` (migration 0002) already allows
  `owner_id = auth.uid()`, and every child table is `on delete cascade` (0001), so team, orders,
  bills, chats, calls, memberships, reviews, product threads, vehicles and ad campaigns go with
  it. Deliberately NOT extended to super-admins: an admin who needs a stranger's listing gone
  uses `reassignOwner` first.
- **Domain/interface:** `src/data/repositories.ts` → `remove(id: string, actorId: string):
  Promise<void>` on `BusinessRepository` (shared, already done). The mock
  (`src/data/mock/mockRepositories.ts`) implements the same rule plus a hand-written cascade
  (`dropByBusiness`) mirroring the SQL foreign keys — that is the behavioural spec.
- **Path B — backend/:** `backend/src/services/businesses.ts` → `remove(id, actorId)`: load the
  row, 404 when missing, **403 unless `data.ownerId === actorId`** (Prisma runs on a privileged
  connection that bypasses RLS, so this check is the ONLY thing standing between a member and
  someone else's shop — do not weaken it to `isBusinessMember`, and do not add a super-admin
  bypass). Then `prisma.businesses.delete({ where: { id } })` and let Postgres cascade.
  Router `backend/src/routers/businesses.ts`: `DELETE /businesses/:id`, auth required, actor =
  the JWT's user id, 204 on success. Document in Swagger.
- **Path B — src/data/api/:** already written — `remove: async (id) => { await
  http.del(`/businesses/${seg(id)}`); }` in `createApiBusinesses()`. Just make the route exist.
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`. Smoke: as the owner,
  `DELETE /businesses/<own id>` → 204 and the listing is gone from `GET /businesses`; as any
  other signed-in user → 403 and the row survives.

## [SYNC-026] Real identity — sign in with a real email AND/OR a phone number

- **Area:** AuthRepository / auth + `profiles_private`

- **Supabase change:** `src/data/supabase/auth.ts`.
  - `signUp` now takes `{ name, email?, phone?, password }` and requires AT LEAST ONE of
    email/phone. The **login address** is the real email when given, otherwise the synthetic
    `<digits>@localo.app` alias from the phone. Sign-up metadata is now
    `{ name, phone, email }` — what the PERSON typed, which is not always the credential
    address.
  - `signIn(phoneOrEmail, password)` genuinely accepts either, resolved in TWO LAYERS:
    1. try `phoneToEmail(typed)` (unchanged behaviour: passes an `@` through untouched,
       otherwise builds the synthetic alias) — no round trip, and this is what every
       phone-first account still uses, including the seeded ten;
    2. only if that fails AND the input is not an email, call the
       `resolve_login_email(p_phone, p_password)` RPC and retry with what it returns.
    Layer 2 failing (or the function not existing) must degrade to layer 1's error, never
    to a hard failure — that is what keeps an un-migrated project working.
  - `src/data/supabase/shared.ts` gained `looksLikeEmail()` and `isSyntheticEmail()`;
    `niceAuthError` no longer says "phone number" where either identifier may be meant, and
    the invalid-login text is deliberately vague (anti-enumeration).

- **Domain/interface (shared — already done):** `src/data/repositories.ts`
  - `SignUpInput` is now `{ name, email?, phone?, password? }`.
  - NEW exports `MIN_PASSWORD_LENGTH`, `assertIdentity({email,phone})`, `assertPassword(pw)`.
    These are the single source of both rules and are already used by the mock, Path A, the
    Path B client and the sign-in screen. **Path B's server must enforce the same two rules
    with the same messages** — do not re-derive them.

- **Path B — `src/data/api/auth.ts`:** PARTIALLY DONE. `signUp` was updated in the P05 pass
  (only because it otherwise failed to compile against the new `SignUpInput`): it calls
  `assertIdentity`/`assertPassword` and picks the same login address. **Still to do:** give
  `signIn` the same two-layer resolution as Path A — currently it only does layer 1, so an
  account whose login address is a real email cannot sign in by typing its phone number.

- **Path B — `backend/`:** identity is still Supabase's (the API verifies the JWT and never
  issues one), so there is no sign-in endpoint to change. What DOES need doing:
  - any place the server writes a profile on first sight must file `phone`/`email` into
    `profiles_private` and must NOT store a `%@localo.app` address as a contact email —
    mirror `handle_new_user` in migration 0016;
  - if a future endpoint provisions accounts, apply `assertIdentity`/`assertPassword`.

- **DB/migration:** `supabase/migrations/0016_real_identity.sql` — SHARED DB, apply ONCE.
  Adds an expression index on the digits of `profiles_private.data->>'phone'`; adds the
  SECURITY DEFINER `resolve_login_email(text, text)` (verifies the password against
  `auth.users.encrypted_password` with `crypt` so the address is only handed to a caller who
  could already sign in — uniform NULL on every failure, so it is not an enumeration oracle);
  rewrites `handle_new_user` for the new metadata shape; and strips previously-stored
  synthetic addresses out of `profiles_private.data.email`. Existing accounts (the seeded ten,
  the super-admin) are deliberately LEFT ALONE and keep signing in by phone + password.

- **Verify:** `npx tsc --noEmit` and `npx expo export --platform web` in the app;
  `npm run typecheck && npm run build` in `backend/`. Functionally: sign in with a seeded
  phone (must still work), sign up with email only, phone only, and both; then sign in with
  each identifier the account carries.

## [SYNC-030] Username + password is the whole login

> ⚠️ SUPERSEDES the deleted [SYNC-027] (email OTP verification) and [SYNC-028] (password
> reset). Neither exists in the product any more. If either was already applied to Path B,
> DELETE it: `sendEmailOtp`, `verifyEmailOtp`, `sendPasswordReset`, `completePasswordReset`,
> `User.emailVerifiedAt`, and anything calling a `mark_email_verified` RPC (migration 0017
> was never applied and has been deleted).

- **Area:** AuthRepository / auth + `profiles.username`

- **Why:** every previous scheme made sign-up depend on something outside the app — an inbox
  Supabase would not let us template without paid SMTP, or an SMS provider needing Indian DLT
  registration. A username needs neither. Email and phone survive as CONTACT DETAILS:
  optional, unverified, never credentials.

- **Supabase change:**
  - `src/data/supabase/shared.ts` gained `usernameToEmail(handle)` → `<handle>@localo.app`.
    `niceAuthError` now maps a duplicate-address rejection to "That username is taken." and
    invalid-login to "Wrong username or password."
  - `signUp` derives the credential address from the handle, so **uniqueness is enforced by
    the `auth.users.email` unique constraint** — there is no check-then-insert to race.
    Metadata is `{ name, username, phone, email }`; display name falls back to the username.
  - `signIn` derives the address on the device with no lookup: `@` → itself; leading digit →
    `phoneToEmail`; otherwise → `usernameToEmail`. The `resolve_login_email` RPC (0016) stays
    as a SECOND attempt for the digits case only.

- **Domain/interface (shared — already done):** `SignUpInput` is
  `{ username, name?, email?, phone?, password? }`. NEW `assertUsername` and
  `assertContactDetails` replace `assertIdentity`; `assertPassword` unchanged.
  `USERNAME_MIN_LENGTH`/`USERNAME_MAX_LENGTH` exported. `User.username?: string` added
  (PUBLIC — it is a handle, and lives on `profiles`, not `profiles_private`).
  `User.emailVerifiedAt` and the OTP constants were removed.

- **⚠️ THE INVARIANT THAT KEEPS THE SCHEMES APART:** `assertUsername` forbids a leading digit,
  which is the only thing preventing a username alias from colliding with a phone alias on the
  shared `@localo.app` domain. Do not relax it in any backend.

- **Path B — `src/data/api/auth.ts`:** DONE — `signUp` mirrors the derivation above.

- **Path B — `backend/`:** return `username` on `GET /users/:id` (public, alongside `name`),
  and REJECT it on profile writes — a handle cannot be rewritten by its owner, because the
  credential address in `auth.users` would not move with it. Migration 0018 enforces this with
  a trigger; the API must not offer a way around it.

- **DB/migration:** `supabase/migrations/0018_usernames.sql` — SHARED DB, apply ONCE. Indexes
  `lower(data->>'username')` on `profiles`, rewrites `handle_new_user` to store the handle on
  the public card, and extends `protect_profile_fields` to pin `username` on UPDATE.

- **Known gap (deliberate):** there is NO password recovery. A username account's address has
  no inbox, so nothing can be sent to it. Google sign-in is the recovery route — an account
  with no password cannot forget one. Restoring reset needs custom SMTP AND a verified address
  stored on the account; do not reintroduce a reset screen before both exist.

- **Verify:** `npx tsc --noEmit` + `npx expo export --platform web`; `npm run typecheck &&
  npm run build` in `backend/`. Functionally: sign up with just a username and password; sign
  up again with the same handle (must say it is taken); sign in with a seeded phone
  (9812340001) — the regression that matters most.

## [SYNC-029] Sign in with Google (and email verification REMOVED)

> ⚠️ SUPERSEDES the deleted [SYNC-027], which described an email-verification OTP flow. That
> flow has been removed from the product — do not implement it. If any of it was already
> applied to Path B, delete it: `sendEmailOtp`, `verifyEmailOtp`, `User.emailVerifiedAt`, and
> anything reading a `mark_email_verified` RPC (migration 0017 was never applied and has been
> deleted).

- **Area:** AuthRepository / auth

- **Why:** Supabase locks email-template editing behind custom SMTP, so the OTP code could
  not be put into the mail at all on the current plan. Verification was cut; Google sign-in
  replaces it as the trustworthy-identity route, and brings its own already-verified address.

- **Supabase change:** `src/data/supabase/auth.ts` gained `signInWithGoogle()`.
  `auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect } })`
  → open `data.url` with `WebBrowser.openAuthSessionAsync(url, redirectTo)` → read `code` from
  the returned URL → `auth.exchangeCodeForSession(code)` → `clearCache()` → `fetchProfile`.
  `redirectTo` is `Linking.createURL('/auth-callback')`, which resolves per platform.
  A `result.type !== 'success'` is a CANCELLATION and must read as one, not as a failure.

- **Client config (shared):** `src/lib/supabase.ts` now sets `flowType: 'pkce'`, which
  `exchangeCodeForSession` requires. `detectSessionInUrl` stays false — the redirect is read
  by hand on every platform. New dependency: `expo-web-browser` (config plugin auto-added to
  app.json).

- **Domain/interface (shared — already done):** `AuthRepository.signInWithGoogle(): Promise<User>`.
  `User.emailVerifiedAt` was REMOVED. `OTP_CODE_LENGTH` / `OTP_RESEND_COOLDOWN_SECONDS` remain,
  still used by the password reset in [SYNC-028].

- **Path B — `src/data/api/auth.ts`:** DONE, by delegation to `createSupabaseAuth()` (identity
  is Supabase in Path B too), with the profile re-read via `GET /users/:id`.

- **Path B — `backend/`:** nothing required — no token is issued by Express. Confirm the
  profile serialiser no longer references `emailVerifiedAt`, and that a Google-created user
  (whose row is written by the `handle_new_user` trigger from Google's metadata) reads back
  correctly through `GET /users/:id`.

- **DB/migration:** none. The `handle_new_user` trigger from 0016 already handles a Google
  sign-up: Google supplies `name` and a real, non-synthetic `email`, which is exactly what it
  files into `profiles_private`.

- **⚠️ Dashboard prerequisites (not code):** Google provider enabled in Supabase with a Google
  Cloud OAuth client id/secret; `https://<ref>.supabase.co/auth/v1/callback` listed as an
  authorised redirect URI in Google Cloud; and the app's own redirect (`localo://auth-callback`
  plus the dev-server origin) added under Authentication → URL Configuration.

- **Verify:** `npx tsc --noEmit` + `npx expo export --platform web`; `npm run typecheck &&
  npm run build` in `backend/`. Functionally: Continue with Google on web and on a device,
  cancel it once (must not show an error), and confirm a first-time Google user gets a profile.

## [SYNC-031] `AuthRepository.deleteAccount()` — closing an account for good

- **Area:** AuthRepository / account deletion (Google Play hard requirement)

- **Supabase change:** new edge function `supabase/functions/delete-account/index.ts` plus
  migration `0019_account_deletion.sql`. `src/data/supabase/auth.ts` gained `deleteAccount()`,
  which `functions.invoke('delete-account')` with an EMPTY body — the uid comes from the verified
  JWT and there is deliberately no user-id parameter, so the endpoint can only ever delete the
  caller. It reads the error body off `error.context` (a `FunctionsHttpError` hides the server's
  message there) to tell a BLOCKED deletion from a real fault, then `signOut()` + `clearCache()`
  on success.

- **Domain/interface (shared — already done):** `AccountDeletionBlocker` and `DeleteAccountResult`
  (`{ deleted: true; listingsRemoved } | { deleted: false; blockers }`) in
  `src/data/repositories.ts`, plus `deleteAccount(): Promise<DeleteAccountResult>` on
  `AuthRepository`. `User.deletedAt?: string` added in `src/domain/types.ts`. A refusal is a
  RESULT, not a throw — owning a live business is an ordinary state, and the screen renders the
  list. `DataProvider` exposes `deleteAccount()` and clears the session only when
  `result.deleted`.

- **Path B — `src/data/api/auth.ts`:** DONE, by delegation to `createSupabaseAuth().deleteAccount()`
  — same reasoning as Google sign-in ([SYNC-029]): the account being deleted is a Supabase auth
  user in Path B too (Express verifies JWTs, never issues them), and both backends share ONE
  database, so 0019's scrub covers Path B's data as well. **Leave it delegated** unless Path B
  ever stops using Supabase Auth.

- **Path B — `backend/`:** nothing REQUIRED. Optional, only if you want Express to own the flow:
  a `DELETE /users/me` that reimplements the edge function's four steps (blockers → scrub →
  storage sweep → admin delete) using the service-role Prisma connection plus a Supabase admin
  client for `auth.admin.deleteUser`. If you do add it, the identity must still come from the
  verified JWT in `backend/src/authz.ts` and never from a path/body parameter.

- **DB/migration:** `supabase/migrations/0019_account_deletion.sql` — SHARED DB, apply ONCE, and
  before the function is deployed or every deletion fails on missing RPCs. It:
  - **drops the `profiles → auth.users` foreign key** (found by shape, not by name). This is the
    load-bearing change: that FK is `on delete cascade`, and `businesses.owner_id → profiles` is
    too, so deleting an auth user used to detonate into every business the person owned and every
    order, bill, review and employment record hanging off it. With the FK gone the profile row
    survives as a TOMBSTONE, no cascade fires anywhere, and every foreign key still resolves.
    ⚠️ Path B's Prisma schema was introspected from the old shape — re-run `prisma db pull` after
    applying, or Prisma will keep modelling a relation the database no longer has.
  - adds `account_deletion_blockers(uuid)`, `unreferenced_media_paths(uuid)` and
    `anonymize_account(uuid)`, all SECURITY DEFINER and all **revoked from `anon`/`authenticated`,
    granted to `service_role` only** — `anonymize_account` takes a uid argument, so a session able
    to call it could erase anyone.
  - refuses outright for any `platform_admins` row (the console must not be able to lock itself
    out) and for any still-owned non-empty listing.

- **⚠️ Deployment (not code):** `supabase functions deploy delete-account` on every project the app
  ships against. Secrets are platform-injected. The function answers `OPTIONS` and returns the CORS
  header block — without them a deletion from the web preview fails as the generic "Failed to send
  a request to the Edge Function", exactly as `call-ring` once did.

- **Verify:** `npx tsc --noEmit` + `npx expo export --platform web` (app); `npm run typecheck &&
  npm run build` in `backend/`. Functionally, against a throwaway account: delete it and confirm
  the profile is a tombstone, `profiles_private` is empty, orders read "Deleted user" and the
  chats are gone; then confirm an account owning a listing WITH an order is refused, naming it.

---

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

