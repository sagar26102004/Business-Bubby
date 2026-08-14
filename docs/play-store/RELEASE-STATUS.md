# Release status — where the Play submission actually is

**Read this first when resuming release work.** It is the running state of the v1.0 Google Play
submission: what is done, what is decided, and what is next. The other files in this folder are
*reference* (what to paste, what to record); this one is *status*.

Last updated **14 August 2026**.

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
| 6 | Setup checklist: listing, content rating, target audience, data safety | A.4 / 6.2 | ⬜ Not started — text drafted in `store-listing.md`, `data-safety.md`, `android_description.txt` |
| 7 | Play service account key | A.5 | 🔴 **BLOCKER — see below** |
| 8 | `eas submit` + create release | A.6 / A.7 | ⬜ Not started |
| 9 | Review (1–3 days; up to 7 for a new account) | A.8 | ⬜ |

---

## Open blockers

1. 🔴 **`play-service-account.json` does not exist.** Both submit profiles in `eas.json` reference
   it and `eas submit` fails immediately without it. Correctly gitignored, so it must be placed
   locally or moved to EAS-managed credentials. Walkthrough: guide §A.5.
2. ⬜ **Feature graphic, 1024×500** — required by Play, no iOS equivalent, does not exist. Cannot be
   cropped from the icon; it is a different composition.
3. ⬜ **Screenshots** — minimum 2 phone shots. `app-store/screenshots/` and `screenshot/` are both
   empty.
4. ⬜ **Privacy policy still describes background location** (see decision 2). Live page, so
   changing it is Sagar's call — left as-is deliberately.

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
