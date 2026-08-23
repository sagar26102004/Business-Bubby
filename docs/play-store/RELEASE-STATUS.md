# Release status — where the Play submission actually is

**Read this first when resuming release work.** It is the running state of the v1.0 Google Play
submission: what is done, what is decided, and what is next. The other files in this folder are
*reference* (what to paste, what to record); this one is *status*.

Last updated **23 August 2026** (fifth pass, amended late the same day by decision 6: a bundle has reached **internal testing**, so the
Console is live and the form-filling era is over. The whole game is now the **closed-testing
14-day clock** — see "Fifth pass record" below, which is the section to read first).

> **Two facts in this file are inferred, not seen.** Nobody has driven the Play Console from this
> repo — its state is read from the traces a run leaves behind (a workflow note saying a bundle was
> uploaded, a `versionCode` default that was bumped). Anything marked 🔎 is an inference with the
> evidence named; confirm it with one glance at the Console and strike the marker. Everything
> marked ✅ was verified against a real system — the live database, the git history, this repo.

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
| 3 | Play Console account ($25, ID verification) | A.1 | 🔎 **Cleared.** A bundle has since been uploaded to internal testing (`android-aab.yml` records "3 by the 16 Aug 2026 Actions run and the first internal-testing upload", written into the file on 20 Aug), which cannot happen without a working Console. No longer the critical path. Confirm no verification banner is still showing. |
| 4 | Production build + keystore backup | A.2 / Phase 3 | ✅ **Repeatable.** Built by GitHub Actions, not EAS (decision 5). Keystore backed up off-machine to Google Drive; local copies at `credentials/android/keystore.jks` + `credentials.json`, both gitignored and never committed. The 16 Aug artefact's 14-day retention no longer matters — rebuilding is a button, and every rebuild is signed with the same secret-held keystore, so Play keeps seeing the same app. |
| 5 | Create app in Play Console | A.3 | 🔎 **Done** — implied by the internal-testing upload (phase 3). |
| 6 | Setup checklist: listing, content rating, target audience, data safety | A.4 / 6.2 | 🟡 **All assets and copy exist** — nothing left to author, only to paste. Unblocked now. See "Ready to upload" below. |
| 7 | Play service account key | A.5 | ⬜ **Not needed for v1.0 and now doubly so** — the build no longer comes from EAS, so `eas submit` is not the upload path. Upload the `.aab` by hand. |
| 8 | Upload the `.aab` + create release | A.6 / A.7 | 🟡 **Internal testing has a build** (versionCode 3). **Closed testing does not** — and only closed counts for phase 10. Next upload goes to the *closed* track. Manual upload, **not** `eas submit` — decision 5. |
| 9 | Review (1–3 days; up to 7 for a new account) | A.8 | ⬜ |
| 10 | Closed test → apply for production access | — | 🔴 **THE CRITICAL PATH — and the only thing on this list that cannot be hurried.** 12 testers, 14 *continuous* days, closed track only. The clock has not started. Decision 4, and "Fifth pass record" below. |

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
network connection this repo cannot reach. Numbers are kept stable so older notes keep pointing at
the right item — the resolved ones stay, struck through in spirit, rather than being renumbered.

**As of 23 Aug three are still live:** 8 (auth toggles — sharp, do it before any tester sees the
app), 4's leftovers (§2.5 is 8; §2.7 advisors is a five-minute re-run), and 3 (screenshots — soft,
it can wait for the production promotion).

1. ✅ **RESOLVED 15 Aug 2026 — the corrected legal pages are live.** Verified by loading the
   published URLs, not just by checking git: `privacy-policy.html` reads "Last updated 15 August
   2026", carries the new §5 "Promoted listings", and lists OpenStreetMap in the Service providers
   table; `support.html` carries the rewritten location FAQ. The live pages and the Data safety
   answers now agree, which was the standing rejection risk.
   **If you ever edit a page under `docs/legal/`, this is the check:** push, wait ~1 min for Pages,
   then load the URL in a private window and confirm the date changed. GitHub Pages deploys from
   `main`, so an unpushed commit means the app links to text you no longer stand behind.
2. ✅ **RESOLVED — Console verification is no longer a blocker** (phase 3). A bundle reached
   internal testing, which settles it. **What replaced it is worse, because waiting is the whole
   of it: the closed-testing 14-day clock has not started.** Nothing in this repo shortens it
   either, but unlike verification it does not start on its own — somebody has to open the track
   and get 12 people to opt in. See the fifth pass record.
3. 🟡 **Screenshots still show obviously-fake names** — `Vehicles Stall #633`, `Abc's Stall`, `Fth`.
   Downgraded by decision 4: for a testing track these are seen by testers, not the public, and
   renaming those three listings is enough (one `update … jsonb_set` on `businesses.data`).
   **Recapturing against real listings is a production-promotion blocker, not a v1.0 one.** The two
   shots still missing (an order, a chat — both came out as empty states) are in
   `screenshots/README.md`.
4. 🟢 **`production-setup.md` §2 is all but finished.** §2.1 (**super-admin password rotated**,
   16 Aug), §2.4 (test accounts deleted, 15 Aug) and §2.6 (migrations + functions — the 28-row
   `check_security_state.sql` run came back green, 16 Aug) are **done**. The old plaintext password
   in §2.1 is dead and the section has been rewritten to say so.
   **Left: §2.5 and §2.7, both dashboard-only and both about five minutes.**
   - **§2.5 auth settings** — the one with a real failure mode. Four toggles under Authentication →
     Sign In / Providers: Anonymous sign-ins **ON** (off = guest voice calling breaks), Confirm
     email **OFF** (synthetic `<username>@localo.app` addresses have no inbox, so sign-in dies),
     leaked-password protection ON, Google provider configured. Plus `localo://auth-callback` in
     URL Configuration or Google sign-in returns nowhere on a device. The Google half of this —
     the Cloud OAuth client, the provider toggle and the redirect list — is now written out step
     by step in `docs/google-sign-in.md`; it is the only part that also needs a *second* console
     (Google Cloud), so do it from there rather than from memory.
   - **§2.7 advisors** — Dashboard → Advisors → Security. The one check that catches a table added
     without a policy, which the SQL script cannot know to look for. **Worth re-running now:**
     migration 0022 added a new table (`active_devices`) since the last green run. Its RLS and four
     policies were verified by hand on 23 Aug, so this is confirmation rather than suspicion — but
     a new table is exactly the case this check exists for.
5. ✅ **Migration `0020_ad_view_bands.sql` is applied** (confirmed 15 Aug). It is idempotent — two
   `drop function if exists`, a `create`, a `comment` and a `grant`, with no data backfill — so
   re-running it is safe if ever in doubt. The one thing that can still go wrong is PostgREST
   caching the old signature, which fails **silently**: `recordEvent` in `src/data/supabase/ads.ts`
   falls back to the 2-arg call, so every view lands unbanded and the distance report stays empty
   while everything looks fine. Fix with `notify pgrst, 'reload schema';`.
6. ✅ **`play-service-account.json` is no longer wanted for v1.0.** It only ever existed to let
   `eas submit` upload, and the build has moved off EAS entirely (decision 5) — so the upload is a
   manual one in the Console either way. Revisit only if automated uploads become worth the Google
   Cloud setup. Walkthrough if you ever want it: guide §A.5.

7. ✅ **Moot — stop worrying about artifact retention.** The 16 Aug bundle is superseded (a fresh
   one was built 22 Aug, and another will be built on top of today's fixes), and a rebuild is a
   button on a branch that is always releasable. Expiring artifacts cost nothing; only a lost
   *keystore* would, and that lives in GitHub secrets plus an off-machine backup.

8. 🟡 **Do blocker 4's §2.5 BEFORE the invite links go out — not before the upload, before the
   *invites*.** The toggles themselves are listed in 4; what's new is the deadline. Two of them
   decide whether a tester's first minute works at all: **Confirm email OFF** (synthetic
   `<username>@localo.app` addresses have no inbox, so sign-in dies waiting for a mail that will
   never arrive) and **Anonymous sign-ins ON** (guest browse and guest calls). Getting it wrong
   burns the scarcest resource in this release — the goodwill of 12 volunteers — on day one of a
   clock where re-recruiting costs days that cannot be recovered.

## Fifth pass record — 23 August 2026

**The shape of the release changed today, so read this before the older records.** For a month the
blocker was always something Google had to do. It isn't any more. The Console works, a bundle has
been through it, and the only thing between here and production access is **14 days that have not
started counting**.

### The one thing that matters

The 14-day closed test runs *while you keep working*. A build uploaded to the closed track today
does not stop you shipping five more this fortnight — **updating the app during a closed test does
not reset the clock**. So the instinct to polish before starting is exactly backwards: every day
spent perfecting the build before the track opens is a day added to the total, while a day spent
perfecting it *after* is free.

The corollary is the tester count. Twelve must be opted in **continuously**; drop below and the run
is compromised, so invite ~18–20 to land 12 (decision 4). Recruiting is the part with human latency
in it — people take days to tap a link — so it should start the same day the track does, not after.

**Practical order:** open the closed track with the next build → send invites the same day →
confirm 12 opted in → then go back to features.

### What happened

- **22 Aug** — an `.aab` was built (GitHub Actions). Never uploaded: new bugs were spotted first.
- **23 Aug** — those fixes landed on `main` as two commits, and the branch is clean and pushed:
  - `c133b15` **multi-shift opening hours** — a day now holds a *list* of shifts, so a gym open
    5–10 AM and 5–10 PM can say so. Before this, entering the evening shift silently erased the
    morning one, which is a data-loss bug in a form owners fill exactly once.
  - `aeccd5a` **one account, one device** — sign-in claims the account for the install and revokes
    other sessions. Relevant to testing: a tester signing in on a second handset now displaces the
    first *by design*. Say so in the invite, or it reads as a bug report waiting to happen.
- **23 Aug, later** — `app.json` drops `FOREGROUND_SERVICE_MEDIA_PLAYBACK` by turning off
  `expo-audio`'s `enableBackgroundPlayback`. One permission fewer to declare, and one Console
  form fewer to fill. See decision 6.
- The 22 Aug bundle is superseded. Build a fresh one from `main`; nothing carries over from the
  unused one.

### versionCode — the one rule

Must be **higher than any versionCode already uploaded to Play**, not higher than everything ever
built. A bundle that never reached the Console burns nothing.

| versionCode | Where it went |
|---|---|
| 1, 2 | `eas build` (superseded, decision 5) |
| 3 | 16 Aug Actions run → **uploaded to internal testing** |
| 4 (probable) | 22 Aug run — the workflow default had been bumped to `5` by then, so 4 was likely used earlier; **never uploaded** either way |
| **6 or higher** | the next build — safely clear of both |

Gaps are free; Play only requires the number to go up. Confirm the highest *uploaded* number under
Releases before running, and bump the workflow's default input afterwards so a later click can't
silently reuse one.

### Verified against live systems today

- ✅ **Migration `0022_single_device_session.sql` IS applied to the live project** (`mzxslzouzmiswnrolcaq`).
  Checked directly, not assumed: table present, `PRIMARY KEY (user_id)`, FK to `profiles` with
  `ON DELETE CASCADE`, RLS enabled, all four policies, and one live claim row. It had been reported
  as not applied; it was applied all along — see the next point for why it looked otherwise.
- ⚠️ **The Supabase MCP tools are signed into a DIFFERENT account** and cannot see this project at
  all. Asked about `active_devices`, they answer about another database entirely and report it
  missing — confidently and wrongly. **Never check Localo's DB state through them.** Use
  `npx supabase db query "<sql>" --linked`, which runs against the live project and needs no DB
  password.
- ⚠️ **The remote migration-history table is empty.** `supabase migration list --linked` shows
  every local migration 0001–0022 with a blank `remote`, because they were all applied by pasting
  into the SQL editor rather than by `db push`. The schema is correct; the CLI just doesn't know
  it. **Do not run `supabase db push`** — it would try to re-run all 21. Repair the history first
  (`supabase migration repair --status applied <version>`, which only writes history rows).
- ✅ The AAB workflow bakes in the right backend at build time (`EXPO_PUBLIC_BACKEND=supabase`,
  the live URL and publishable key), and deliberately leaves `EXPO_PUBLIC_DEV_TOOLS` and
  `EXPO_PUBLIC_SEED_PASSWORD` absent. Nothing to set by hand before a release build.

### Still unconfirmed — one glance each

These are the 🔎 items. None needs work, only looking:

1. The verification banner is gone from the Console (phase 3).
2. The exact versionCode of the 22 Aug run — Actions → the run → its `versionCode` input.
3. `production-setup.md` §2.5 auth toggles, especially **Confirm email OFF** — blocker 8, and the
   one that would break a tester's very first minute.

---

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

### 5. Release bundles are built by GitHub Actions, not EAS

Decided 15–16 Aug 2026, forced by circumstance: **EAS Build's free Android quota ran out** mid-
release, and waiting for a monthly reset was not an acceptable way to stall a submission.
`.github/workflows/android-aab.yml` builds the same thing on a free Ubuntu runner — `expo prebuild`
then `bundleRelease`, signed with a real upload key — and produced the bundle now in hand.

**Three things this changes, all of which bite silently:**

1. **`versionCode` is now yours to increment.** `eas build` tracked it remotely via
   `appVersionSource: "remote"`; Gradle has no memory, so the number is a workflow input. EAS
   already burned 1 and 2, so the first Actions build is **3** and every upload after it must be
   higher — Play refuses a versionCode it has seen before. Still **do not** put a `versionCode` in
   `app.json`; the workflow patches `build.gradle` directly.
2. **`eas submit` is not the upload path.** Upload the `.aab` by hand in the Console. This is also
   why the service-account key stopped mattering (blocker 6).
3. **The keystore must stay the one EAS generated.** Play permanently binds the listing to the
   first key it sees. Reusing the EAS key is what keeps `eas build` a viable fallback when the
   quota resets; generating a second key would kill one of the two paths forever.

⚠️ **Keystore backup is the one unrecoverable item in this whole submission.** Losing it does not
make updates awkward — it ends them, and the app would need a new package name and a new listing at
zero installs. Current state: backed up to Google Drive (off-machine), plus `credentials/android/`
and `credentials.json` locally, both gitignored and confirmed absent from git history. GitHub
secrets are write-only, so the Actions copy is **not** a backup — you cannot read it back out.

`android-apk.yml` next door is unaffected: it still builds an installable APK for putting the app
on a phone by hand, and Play will not accept an APK for a new app anyway.

---

### 6. `FOREGROUND_SERVICE_MEDIA_PLAYBACK` is out of the manifest, not declared

Decided 23 Aug 2026 while answering the Console's foreground-service form, which is the first time
anyone read this permission against what the app actually does.

**It was never ours.** It came from the `expo-audio` config plugin, whose `enableBackgroundPlayback`
defaults to **true** (`node_modules/expo-audio/plugin/build/withAudio.js`). Listed bare as
`"expo-audio"`, the plugin injected both the permission *and* a service —
`expo.modules.audio.service.AudioControlsService`, `foregroundServiceType="mediaPlayback"`. The fix
is the plugin option, not `blockedPermissions`: blocking the permission would have stripped the
permission and left the service declared.

```json
["expo-audio", { "enableBackgroundPlayback": false }]
```

**Nothing in the app ever started that service.** The only `expo-audio` use in the codebase is the
incoming-call ringtone in `src/features/calls/IncomingCallGate.tsx:15` (`useAudioPlayer` +
`setAudioModeAsync`), which plays through the ordinary player. `expo-video` contributes nothing here
— its plugin injects only on an explicit `supportsBackgroundPlayback`, and it is passed no options.

⚠️ **This corrects `permission-declarations.md` §6 on two points**, both now fixed there. It called
media-playback "the only one in the 1.0 manifest" — `FOREGROUND_SERVICE_MICROPHONE` is also in it,
declared in `app.json` and again in `modules/call-notification/.../AndroidManifest.xml:23`. And it
justified the permission as keeping the ringtone audible while backgrounded, which no code does.

**What this changes:** the media-playback declaration is **no longer owed** — from the next bundle
onward the Console should stop asking for it. The microphone one stays and is answered
**"Background audio input"**: `OngoingCallService` starts with
`FOREGROUND_SERVICE_TYPE_MICROPHONE` (`OngoingCallService.kt:77`) to hold a LiveKit call's mic
capture open while the app is backgrounded or the screen is locked.

🔎 **Verify on the next build, two ways.** Nothing here was checked against a merged manifest —
there is no `android/` directory in the repo, so the plugin source is the only local evidence.
Either `npx expo prebuild --platform android` and read
`android/app/src/main/AndroidManifest.xml`, or upload the bundle and confirm the Console has
dropped the question. **Also worth one device check in internal testing:** that an incoming call
still rings audibly with the app backgrounded. Background audio playback does not itself require a
foreground service, and the closed-app ring comes from the notification sound and
`CallNotifications` rather than `expo-audio` — but that path has never been exercised on a real
handset, and this is the change that would expose it.

---

## Fourth pass record — 16 Aug 2026

- **Super-admin password rotated** (`production-setup.md` §2.1), closing the last item that was
  real exposure rather than paperwork. §2.1 rewritten so it no longer prints the dead password.
- **Signed release `.aab` built** via the new GitHub Actions workflow — see decision 5. Keystore
  backed up off-machine.
- **Play Console paid for and submitted for ID verification.** Now the sole hard blocker.
- **Verified in the repo, not assumed:** `credentials.json` (repo root) and `credentials/` are both
  matched by `.gitignore`, neither is tracked, and neither appears anywhere in git history; no
  stray `keystore.b64` was left behind after the secret was saved. `npx tsc --noEmit` exits 0 and
  `main` is level with `origin/main`.

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

🔎 **Some of this may already be done.** The Console makes you clear the "App content"
declarations before a release goes out to a track, and one already reached internal testing — so
walk the list and tick off what the Console already shows as complete rather than redoing it. The
copy to paste is all authored either way.

- `USE_FULL_SCREEN_INTENT` declaration — `permission-declarations.md` §2
- ~~`FOREGROUND_SERVICE_MEDIA_PLAYBACK` service-type declaration~~ — **dropped, decision 6.**
  The permission is out of the manifest as of 23 Aug; from the next bundle the Console should
  stop asking. Nothing to write.
- `FOREGROUND_SERVICE_MICROPHONE` service-type declaration — answer **"Background audio input"**
  (in-app voice calls). ⚠️ **This form wants a demo video link**, contrary to the "light form, no
  video" note that used to sit here — the Console asked for one on 23 Aug. One recording of an
  in-app call, backgrounded mid-call, covers it; it can likely double as the §2
  `USE_FULL_SCREEN_INTENT` video.
- Data safety, content rating (IARC), target audience — `data-safety.md`, `release-checklist.md`
- **Not** the Location Permissions declaration. Not in 1.0.
