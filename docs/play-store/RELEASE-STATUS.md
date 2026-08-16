# Release status — where the Play submission actually is

**Read this first when resuming release work.** It is the running state of the v1.0 Google Play
submission: what is done, what is decided, and what is next. The other files in this folder are
*reference* (what to paste, what to record); this one is *status*.

Last updated **15 August 2026** (third pass: everything authorable is now written; what remains
needs the Play Console, the Supabase dashboard, or a push that reaches GitHub).

---

## Scope

**Google Play only.** iOS/App Store is not being prepared.

**v1.0 goes to a TESTING TRACK, not production** — decided 15 Aug 2026, see decision 4. Everything
below still has to be done; the only thing that changes is which track the release is rolled out
to at the end, and that the demo listings are deliberately kept rather than deleted. The working plan is the guide at
`Complete Guide_ Expo App to App Store (and Play Store).docx` in the repo root — but that document
is iOS-first with Play as an addendum, so the phase numbers do **not** map one-to-one. For a
Play-only run:

- **Skip entirely:** Phase 4 (Apple Developer Program), Phase 5 (App Store Connect), Phase 6.1/6.3
  (App Privacy, Content Rights), Phase 7 (TestFlight upload), Phase 8's Apple guideline numbers.
- **Skip inside §2.1:** `ITSAppUsesNonExemptEncryption` and the `infoPlist` strings — Apple-only.
  They are present in `app.json` and harmless; they simply do nothing here.
- **Play has no keywords field.** The guide's keyword advice is iOS-only.

---

## Phase status

| # | Phase | Guide ref | Status |
|---|---|---|---|
| 1 | End-to-end testing | Phase 1 | ✅ **Full feature sweep done 16 Aug 2026** — every screen driven in the web preview, four real bugs found and fixed. See "Pre-publish QA sweep" below. Final on-device ring/vibration pass still deferred. |
| 2 | Config + assets | Phase 2 | ✅ **Complete** — see "Phase 2 record" below. |
| 3 | Play Console account ($25, ID verification) | A.1 | 🟡 **Account created, ID documents submitted — awaiting Google's verification** (15 Aug 2026). Nothing uploaded yet, no track live. Testing to date has been EAS **preview** APKs on Sagar's own device — real testing, but not a Play artefact. Verification takes days; steps 4 and §2.1 below do not wait on it. |
| 4 | Production build + keystore backup | A.2 / Phase 3 | ⬜ Not started |
| 5 | Create app in Play Console | A.3 | ⬜ Not started |
| 6 | Setup checklist: listing, content rating, target audience, data safety | A.4 / 6.2 | 🟡 **All assets and copy now exist** — nothing left to author, only to paste. See "Ready to upload" below. |
| 7 | Play service account key | A.5 | 🟡 **Optional for v1.0 — see below** |
| 8 | `eas submit` + create release | A.6 / A.7 | ⬜ Not started. **Testing track, not production** — decision 4. Use the `internal` submit profile in `eas.json`, never `production`. |
| 9 | Review (1–3 days; up to 7 for a new account) | A.8 | ⬜ |
| 10 | Closed test → apply for production access | — | ⬜ **Check whether this applies to you** — a personal account registered after 13 Nov 2023 needs 12 testers for 14 continuous days on a *closed* track first. Decision 4. |

---

## Ready to upload — built 14 Aug 2026

| Asset | Where | Notes |
|---|---|---|
| Store icon 512×512 | `play-icon-512.png` | Was already there |
| **Feature graphic 1024×500** | **`play-feature-graphic-1024x500.png`** | RGB, no alpha, 31 KB. Regenerate with `python scripts/make-feature-graphic.py` |
| **Phone screenshots ×5** | **`screenshots/`** | 1080×1920 each. Regenerate with `node scripts/play-screenshots.mjs` |
| Listing copy | `store-listing.md` | Final text, within every character limit |
| Release notes | `release-notes.md` | "What's new" for 1.0, under the 500-char cap |
| Data safety answers | `data-safety.md` | |
| Permission declarations | `permission-declarations.md` | |

## Open blockers

**Nothing on this list needs more writing.** Every one of them needs an account, a dashboard, or a
network connection this repo cannot reach. They are ordered by how long they take to clear, not by
severity — 1 and 2 have waiting built into them, so start them first.

1. ✅ **RESOLVED 15 Aug 2026 — the corrected legal pages are live.** Verified by loading the
   published URLs, not just by checking git: `privacy-policy.html` reads "Last updated 15 August
   2026", carries the new §5 "Promoted listings", and lists OpenStreetMap in the Service providers
   table; `support.html` carries the rewritten location FAQ. The live pages and the Data safety
   answers now agree, which was the standing rejection risk.
   **If you ever edit a page under `docs/legal/`, this is the check:** push, wait ~1 min for Pages,
   then load the URL in a private window and confirm the date changed. GitHub Pages deploys from
   `main`, so an unpushed commit means the app links to text you no longer stand behind.
2. ❓ **Play Console account status is still unknown** (phase 3). Approval takes days and gates
   every step after it. Check it today even if nothing else moves.
3. 🟡 **Screenshots still show obviously-fake names** — `Vehicles Stall #633`, `Abc's Stall`, `Fth`.
   Downgraded by decision 4: for a testing track these are seen by testers, not the public, and
   renaming those three listings is enough (one `update … jsonb_set` on `businesses.data`).
   **Recapturing against real listings is a production-promotion blocker, not a v1.0 one.** The two
   shots still missing (an order, a chat — both came out as empty states) are in
   `screenshots/README.md`.
4. 🟡 **`production-setup.md` §2 is half done.** §2.4 is **complete** — the shared-password test
   accounts are gone from `auth.users`, verified 15 Aug. Still open and still real exposure: **§2.1,
   rotating the super-admin password**, which is short, guessable and written down in project notes,
   on an account that can read every user's private contact details and reassign listing ownership.
   Then §2.5 (auth settings), §2.6 (migrations + edge functions) and §2.7 (advisors). Paste
   `supabase/scripts/check_security_state.sql` — one run covers §2.6, §2.7's main case and the
   launch-readiness rows.
5. ✅ **Migration `0020_ad_view_bands.sql` is applied** (confirmed 15 Aug). It is idempotent — two
   `drop function if exists`, a `create`, a `comment` and a `grant`, with no data backfill — so
   re-running it is safe if ever in doubt. The one thing that can still go wrong is PostgREST
   caching the old signature, which fails **silently**: `recordEvent` in `src/data/supabase/ads.ts`
   falls back to the 2-arg call, so every view lands unbanded and the distance report stays empty
   while everything looks fine. Fix with `notify pgrst, 'reload schema';`.
6. 🟡 **`play-service-account.json` still does not exist**, so `eas submit` cannot upload. This is
   **not a blocker for v1.0**: uploading the `.aab` by hand in the Play Console works and skips the
   Google Cloud service-account setup entirely. Create it later, when automating uploads is worth
   it. Walkthrough if you want it now: guide §A.5.

## Pre-publish QA sweep — 16 Aug 2026

Every feature area driven end to end in the web preview (mock backend with the demo seed on, for
coverage; then the deep-link fix re-verified against the live Supabase backend). Guest browse,
category/intent pages, search, stalls & product threads, map, business page, the full order
lifecycle (place → accept → auto-bill → both sides notified → review unlocked → rating posted →
average updated), dine-in tabs, bookings, memberships & payment history, manual billing, customers,
chats, B2B chat, voice calls (ring → incoming overlay → call log), fleet & live tracking, the
register wizard on both branches, offers → promote → ad review → sponsored placement → "who saw
it", the platform console, and every members-only gate.

**Four real defects found and fixed:**

1. **Deep links were dead on arrival (release blocker).** `ColdStartRedirect` in `app/_layout.tsx`
   bounced *any* non-`/` route to Home on the first mount after an app load — unconditionally. It
   was written for the in-memory mock, which resets on reload, but the app ships on Supabase where
   the session and the data both persist. Everything the app hands out as a link arrives as a cold
   start: **the printed business QR code** (`localo://business/<id>` — the storefront-sign feature),
   a push notification opening a call or an order, any Android App Link. All of them landed on Home.
   Fixed with `src/data/backend.ts` (`selectedBackend()` / `IS_EPHEMERAL_BACKEND`), which resolves
   the effective backend once; the bounce now runs on the mock only. `DataProvider` was rewritten to
   use the same resolver so the two can't disagree. Verified: `/settings`, `/map`, `/browse/food`,
   `/deals`, `/scan` all now open directly on the Supabase build.
2. **…which would have trapped people, so the header back button became a home button.** A stack
   screen opened cold has no back stack *and* no tab bar, and `HeaderBack` used to render nothing in
   that case. It now falls back to a home icon (`router.replace('/')`). The same problem in content
   buttons — a bare `router.back()` after a completed action silently does nothing — is fixed by
   `useDismiss(fallback)` in `src/lib/navigation.ts`, applied to the 16 screens where back *is* the
   completion action. It was reproducible before the fix: submitting a rating saved it but left the
   form on screen ("The action 'GO_BACK' was not handled by any navigator").
3. **The business inbox had no members-only gate.** Every sibling screen (customers, bills, manage,
   fleet, promote, workspace) turns a non-member away; `/inbox/[businessId]` and its thread screen
   did not — the file even called itself a dev surface. No data actually leaked on Supabase (the
   `chat_read` policy is participant-or-member), but it showed a stranger an inbox instead of a
   closed door, and any backend that trusts the client would have served the rows. Both screens now
   gate on chat recipients + owner/managers, the same rule the workspace tile uses.
4. **Every new listing claimed "Open now", forever.** `create()` stamped `openNow: true`, which is
   the legacy fallback badge for listings with no structured hours — and hours are an *optional*
   wizard step. A shop that skipped it said "Open now" at 3 a.m. with "Opening hours: Not set" in
   Manage beside it. Removed from the Supabase and mock create paths; queued for Path B as
   `[SYNC-035]`. Existing rows keep whatever they have.

Also fixed: `locationSummary()` fell back to the bare string `"Location"` when a listing had a map
pin but no typed address — which is **every listing in the live directory today**, so the real
production data reads "📍 Location" on both the card and the page. Now "Pinned on the map".

Not fixed, judged not worth it before launch: the deals reel logs an `AbortError` from
`play()` when a video page scrolls out of view (web-only, inside expo-video, harmless); the seeded
demo listings have a legacy `hours` string but no structured `openingHours`, so Manage shows
"Not set" for them (seed data only — the register wizard always writes both).

`npx tsc --noEmit` and `npx expo export --platform web` both exit 0 after the changes.

**Live database checked the same day.** `check_security_state.sql` came back green on all 27 rows.
It had a blind spot, though: nothing in it looked at the **notifications INSERT policy** — the one
piece of drift `0003` exists to undo, and the one that fails *silently* (a business is simply never
told about an order). Checked by hand, it is correct — `with_check = (auth.uid() IS NOT NULL)` — and
a 28th check now guards it, so a future green report actually means what it looks like it means.
`CLAUDE.md`'s standing ⚠️ about that policy was stale and has been rewritten.

---

## Third pass record — 15 Aug 2026

- **Privacy policy extended, and `data-safety.md` brought back into agreement with it.** Two real
  gaps were found by reading the two documents against each other:
  - The §4 processors table listed only Supabase, LiveKit and Expo push — while `data-safety.md`
    §10 asserted the policy discloses OpenStreetMap/OSRM/unpkg, Google sign-in and Expo updates.
    It did not. All three are now in the table. That assertion was going to fail the moment a
    reviewer checked it.
  - Nothing disclosed **promoted listings** at all, and migration 0020 had just made an ad view
    carry the viewer's distance band. New **§5 "Promoted listings"** covers both. The Data safety
    *form* is unchanged and the Advertising ID answer is still **no** — the reasoning is recorded
    in `data-safety.md` §8, because "we decided this needs no declaration" is worth being able to
    defend later.
  - Sections renumbered 5→13 as a result; the one cross-reference (`data-safety.md` → policy §9,
    children) was updated to §10.
- **`supabase/scripts/rotate_test_accounts.sql` was stale and dangerous.** It told you deleting the
  test accounts cascades their listings away. Since migration 0019 that is false — the profile
  survives as a tombstone and the listing stays live in the directory owned by an account nobody
  can sign into, with no in-app way to remove it. Its "check what would go first" query also
  referenced a `businesses.name` column that does not exist in the document model, so it would have
  errored mid-cleanup. Rewritten: take listings down first, then the accounts, then the tombstones
  **by id** — with a warning against the blanket tombstone delete, which would cascade real users'
  anonymised orders and reviews away and undo the point of 0019.
- **`check_security_state.sql` extended** to cover 0014/0015/0016/0019/0020 and three
  launch-readiness rows (test accounts still live, listings owned by a tombstone, directory size).
- **Verified:** `npx tsc --noEmit` and `npx expo export --platform web` both exit 0.

---

## Decisions made — do not silently reverse these

### 1. The app icon must not contain the One Piece straw hat

The original icon was Luffy's straw hat + "OP". That is Shueisha/Toei copyrighted character
artwork, and "OP" is the standard fan abbreviation, so the pun on "One Place" read as deliberate.
Play IP strikes land on the **developer account**, not just the app, and accumulate toward
termination — the only unbounded-downside item in the whole submission.

Replaced 14 Aug 2026 with a hat-free "OP" wordmark. Source artwork: `assets/icon-source.png`.
Regenerated: `assets/icon.png`, `splash-icon.png`, `android-icon-foreground.png`,
`android-icon-monochrome.png`, `favicon.png`, `docs/play-store/play-icon-512.png`.
`assets/Logo.png` (also hatted, unreferenced) was deleted.

⚠️ **The old hatted assets are still in git history.** Do not "restore" them.

Residuals judged acceptable and left alone: the name "One Place" vs "One Piece" (different
category, no visual hook remains), and the Firebase project id `one-piece-52204`, which ships in
`google-services.json` but is an internal identifier and is immutable without a new project.

### 2. Background location is deferred to v1.1 (Option A)

Not removed — **switched off**. `BACKGROUND_LOCATION_ENABLED = false` in
`src/lib/backgroundLocation.ts`, which carries the four-step re-enable recipe.
`ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION` are in `blockedPermissions`.

Rationale: declaring the permission obliges a Location Permissions declaration plus a demo video,
which is the slowest item in a first submission. Drivers share foreground-only in 1.0. The feature
is fully built and its docs are intact, marked `DEFERRED TO v1.1` throughout this folder.

**The published legal pages were brought into line on 14 Aug 2026.** Play compares the Data safety
form against the privacy policy and a contradiction is a rejection, so
`docs/legal/privacy-policy.html` now states plainly that the app does not collect background
location, and the driver-sharing paragraph says sharing runs only while the app is on screen.
`support.html`'s "Why does the app ask for background location?" FAQ was rewritten for the same
reason. Both keep a forward-looking sentence so re-enabling in v1.1 is an edit, not a rewrite.

It was **not** done with an `EXPO_PUBLIC_` env var on purpose: env vars only reach the JS bundle,
while the permission Play scans is baked into `AndroidManifest.xml` at prebuild. A runtime-only
flag hides the feature and still ships the permission.

### 3. `SYSTEM_ALERT_WINDOW` must stay in the manifest

Blocked on 14 Aug 2026 and reverted the same day. It is **Route 1** of
`CallNotifications.showCallScreen` (`CallNotifications.kt:301`), not dead weight from WebRTC.
Blocking it makes `Settings.canDrawOverlays()` permanently false and deletes the primary path to
the incoming-call screen. Full reasoning in `permission-declarations.md` §3.

---

### 4. v1.0 ships to a testing track, and the demo listings STAY

Decided 15 Aug 2026, after actually looking at the live database. The inventory (`production-setup.md`
§2.2) returned **8 businesses, and every one of them is test data**: School Bus Service and
Vehicles Stall #633 (seed identity Aarav Mehta), Ananya Iyer's Stall (seed identity), Abc's Stall,
Prajapat Tent house (a Dev Tools account), Fth and Gayatri Tent House (the super-admin), Cafe
Corner (Sagar's own). **There is not one real business in the directory.**

That makes a production launch self-defeating in a way no Play checklist catches: someone in Indore
installs a local directory, sees nothing near them, and uninstalls. So v1.0 goes to a testing track
and the demo listings are kept — testers need something to test against.

**What this changes:**
- §2.3 "Remove the demo listings" is **deferred to the production promotion**, not done now. Do not
  delete them as routine cleanup; the empty directory is the problem, not the fake one.
- §2.4 is **already done** — the ten `9812340001`–`10` accounts and the Dev Tools `78…` accounts
  no longer exist in `auth.users` (verified 15 Aug). What remains of §2 is §2.1 (rotate the
  super-admin password), §2.5, §2.6 and §2.7.
- The screenshots problem softens but does not vanish: they are testers' first impression rather
  than the public's. Renaming the three obviously-fake names is enough for a testing track;
  recapturing against real listings is a **production-promotion** blocker.

⚠️ **Check this before planning dates.** Google requires a personal developer account registered
after 13 Nov 2023 to run a **closed** test with **12 testers opted in for 14 continuous days**
before it can even apply for production access. Internal testing does *not* satisfy it — only
closed testing does, which is the detail that catches people, because internal is the easier track.

**Testers are volunteers, not a cost.** A tester is anyone with a Gmail address who taps an opt-in
link and leaves the app installed — friends, family, classmates. Nobody is paid and nothing beyond
the one-time $25 registration fee is spent. Invite ~18–20 people to land 12; some never tap the
link.

The account here is personal, so plan on this applying. The practical consequence is ordering, not
effort: **the 14-day clock should start as early as the app is stable**, because it runs while you
keep polishing. Internal testing first (bugs on real phones — especially call ringing and the
lock-screen call UI, which has never run outside a dev build), then closed testing with the 12,
then apply for production access.

Confirm the current numbers in the Console; this is a policy Google has revised more than once.

---

## Phase 2 record (complete)

- **`app.json`** — added `VIBRATE` (the app calls `Vibration.vibrate()` in `IncomingCallGate.tsx`
  and nothing declared it, so it silently no-opped) and `POST_NOTIFICATIONS`; background-location
  permissions blocked per decision 2.
- **`eas.json`** — submit profiles split into `internal` (internal track, draft) and `production`
  (production track, completed) so the irreversible one must be named explicitly. Production build
  is `app-bundle` with `autoIncrement` + `appVersionSource: "remote"` — **do not add a
  `versionCode` to `app.json`**, that combination is correct as-is.
- **Assets** — all 1024², no alpha except the monochrome (which needs it). Adaptive foreground sits
  inside the launcher safe zone (content `216..808` against `174..850`).
- **Env** — production profile carries `EXPO_PUBLIC_BACKEND`/`SUPABASE_URL`/`SUPABASE_ANON_KEY`;
  verified against every `process.env.EXPO_PUBLIC_*` read in `src/`. `DEV_TOOLS` and
  `SEED_PASSWORD` are correctly absent from release builds.

Verified with `npx tsc --noEmit` and `npx expo export --platform web`, both exit 0.

---

## Still owed in Play Console (1.0)

- `USE_FULL_SCREEN_INTENT` declaration — `permission-declarations.md` §2
- `FOREGROUND_SERVICE_MEDIA_PLAYBACK` service-type declaration — §6 (light form, no video)
- Data safety, content rating (IARC), target audience — `data-safety.md`, `release-checklist.md`
- **Not** the Location Permissions declaration. Not in 1.0.
