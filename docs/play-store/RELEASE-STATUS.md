# Release status — where the Play submission actually is

**Read this first when resuming release work.** It is the running state of the v1.0 Google Play
submission: what is done, what is decided, and what is next. The other files in this folder are
*reference* (what to paste, what to record); this one is *status*.

Last updated **15 August 2026** (third pass: everything authorable is now written; what remains
needs the Play Console, the Supabase dashboard, or a push that reaches GitHub).

---

## Scope

**Google Play only.** iOS/App Store is not being prepared. The working plan is the guide at
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
| 1 | End-to-end testing | Phase 1 | ✅ Done informally — tested over a long period. Final ring/vibration pass deferred until everything else is submission-ready. |
| 2 | Config + assets | Phase 2 | ✅ **Complete** — see "Phase 2 record" below. |
| 3 | Play Console account ($25, ID verification) | A.1 | ❓ **Unknown — check first.** Approval takes days and gates everything after it. |
| 4 | Production build + keystore backup | A.2 / Phase 3 | ⬜ Not started |
| 5 | Create app in Play Console | A.3 | ⬜ Not started |
| 6 | Setup checklist: listing, content rating, target audience, data safety | A.4 / 6.2 | 🟡 **All assets and copy now exist** — nothing left to author, only to paste. See "Ready to upload" below. |
| 7 | Play service account key | A.5 | 🟡 **Optional for v1.0 — see below** |
| 8 | `eas submit` + create release | A.6 / A.7 | ⬜ Not started |
| 9 | Review (1–3 days; up to 7 for a new account) | A.8 | ⬜ |

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

1. ⬜ **The corrected legal pages are still not live. This is now the oldest open item.**
   `docs/legal/privacy-policy.html` and `support.html` were rewritten on 14 Aug so they no longer
   describe background location the app does not ship, and extended again on 15 Aug (see below).
   They were **committed** on 15 Aug as `d1274c7` — but that commit **has not reached GitHub**:
   `git log origin/main..main` still lists it, and fetching `github.com` times out from this
   machine. Verified the same day by loading the live URL: it still serves the **13 August** text,
   which says the app collects background location. That directly contradicts the Data safety form
   you are about to submit, and a contradiction there is a rejection.
   **Do:** `git push origin main`, wait ~1 min for Pages, then open
   `https://sagar26102004.github.io/Business-Bubby/privacy-policy.html` **in a private window** and
   confirm it reads "Last updated 15 August 2026". If the push fails, it is the network, not the
   repo — the commit is sound.
2. ❓ **Play Console account status is still unknown** (phase 3). Approval takes days and gates
   every step after it. Check it today even if nothing else moves.
3. ⬜ **Screenshots must be re-captured after the data cleanup.** They currently show generated test
   rows (`Vehicles Stall #633`, `Abc's Stall`, an item called `Bottel`), which reads as an
   unfinished app. Do `production-setup.md` §2.3–2.4, then re-run the one command. Details and the
   two shots still missing (an order, a chat — both were empty states) are in
   `screenshots/README.md`.
4. ⬜ **The `production-setup.md` §2 pre-flight has not been started**, and two items in it are live
   exposure the moment the app is public: the super-admin password is still the one written down in
   project notes (§2.1), and ten accounts share the password `localo123` (§2.4). Paste
   `supabase/scripts/check_security_state.sql` into the SQL editor first — as of 15 Aug it also
   reports the launch-readiness items and the 0020 check below, so one run tells you the whole
   database story.
5. 🟡 **Migration `0020_ad_view_bands.sql` is not confirmed applied to the live DB.** The remote
   migration history is empty (everything was pasted by hand), so nothing here can tell. It is
   **not** a crash risk — `recordEvent` in `src/data/supabase/ads.ts` falls back to the 0014
   signature — but if it is missing, every ad view lands unbanded and the distance report a
   business paid for stays empty, silently. `check_security_state.sql` now answers this in one row.
6. 🟡 **`play-service-account.json` still does not exist**, so `eas submit` cannot upload. This is
   **not a blocker for v1.0**: uploading the `.aab` by hand in the Play Console works and skips the
   Google Cloud service-account setup entirely. Create it later, when automating uploads is worth
   it. Walkthrough if you want it now: guide §A.5.

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
