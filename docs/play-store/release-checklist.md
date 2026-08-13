# Release checklist — from a clean repo to live on Play

The end-to-end sequence, in order, with the actual commands. Written for a first-time publisher.

**Set expectations before you start:** from "the app works" to "anyone can install it" is
realistically **3–5 weeks**, and almost all of that is waiting on Google, not working. The long
pole is the 14-day closed test (§5), so start it as early as you can — everything else can be done
while it runs.

---

## 0. One-time accounts and costs

| What | Cost | How long |
|---|---|---|
| Google Play developer account | **$25 once** | Identity verification: hours to a few days |
| Expo / EAS account | Free tier is enough | Immediate |
| Supabase | Free tier | Already have it |
| LiveKit | Free tier | Already have it |

Register at play.google.com/console. Choose **personal** unless you have a registered company —
an organisation account needs a D-U-N-S number and takes far longer. Note that a personal account
is the one subject to the closed-testing requirement in §5.

---

## 1. Get the repo and the backend ready

Work through **`production-setup.md`** first — super-admin password rotated, demo data cleared,
test accounts dealt with, auth settings confirmed, advisors clean.

Then:

```bash
git status                     # clean, or commit what you have
npx tsc --noEmit               # must exit 0
npx expo export --platform web # must exit 0
```

Confirm in `src/lib/legal.ts` that all four URLs are real and hosted — no `example.com` left. Load
each in a private browsing window.

Bump the version if this is not your first release:

```jsonc
// app.json
"version": "1.0.0"   // user-visible. Android versionCode is handled by EAS autoIncrement.
```

---

## 2. Build the release

```bash
npm install -g eas-cli          # if you haven't
eas login
eas build:configure             # only if eas.json were missing — it isn't
eas build --platform android --profile production
```

This produces an **.aab** (Android App Bundle), which is what Play requires. `eas.json` already
sets `buildType: app-bundle` and `autoIncrement: true`, so the version code climbs by itself.

Expect 15–30 minutes on the free tier queue. The build runs in Expo's cloud, not on your machine.

### ⚠️ The keystore — read this once, carefully

The first production build makes EAS generate an **upload keystore**, and it stores it for you.

**This key is how Google knows an update is from you. If you lose it, you cannot ever update this
app again** — not with a new key, not with a support ticket. You would have to publish a new
listing under a new package name and lose every install and review.

Back it up the day you create it:

```bash
eas credentials
# Android → production → Keystore → Download
```

Store the downloaded `.jks` and its passwords in a password manager and somewhere offline. **Do
not commit it** — `*.jks` is already gitignored.

Also turn on **Play App Signing** when Play offers it during the first upload (it will). Google
then holds the real app-signing key and your keystore becomes only an *upload* key, which
Google can reset if you lose it. This is the single best insurance available; accept it.

---

## 3. Create the Play listing

In the console: **Create app** → name `One Place`, default language English (India), type **App**,
**Free**.

Then work through the left-hand checklist. Everything you need is already written:

| Console section | Source document |
|---|---|
| Main store listing (copy, icon, feature graphic, screenshots) | `store-listing.md` |
| App content → Privacy policy | hosted `privacy-policy.html` URL |
| App content → Data safety | `data-safety.md` |
| App content → Sensitive app permissions | `permission-declarations.md` + `demo-video-script.md` |
| App content → Account deletion | `account-deletion.md` |
| App content → Content rating | questionnaire — say yes to user-generated content and user-to-user communication |
| App content → Target audience | 18+ |
| App content → Ads | No |
| App content → Government apps, News, COVID | No to all |

Record the background-location video **before** filling the sensitive-permissions form — the form
asks for the link.

---

## 4. Internal testing — do this first, always

**Testing → Internal testing → Create new release.** Upload the `.aab`.

Internal testing is instant: no review, up to 100 testers, available within minutes. Use it to
catch the things that only appear in a real signed build:

- [ ] Sign up a brand-new account and sign back in
- [ ] Continue with Google
- [ ] Location permission prompt appears and nearby businesses load
- [ ] Place an order end to end and receive the bill
- [ ] Send a chat message and get the notification
- [ ] **Voice call rings on a real device with the app closed** — the FCM path
- [ ] Background location: disclosure → permission → vehicle moves while locked
- [ ] Take a photo for a stall item and confirm it uploads and displays
- [ ] **Delete an account** and confirm the tombstone (`account-deletion.md` §7)
- [ ] The Privacy Policy link in Account opens the hosted page
- [ ] Dev Tools is **not** visible anywhere

Fix, rebuild, re-upload. Repeat until this list is clean. Everything after this point is slow, so
do not carry a known bug past it.

---

## 5. Closed testing — the 14-day wall ⚠️

A **personal** developer account must run a closed test before it can apply for production access:
roughly **12 testers, opted in and staying opted in, for 14 continuous days**.

**Verify the current numbers in your own console** — Google has changed them more than once
(it was 20 testers for a long stretch) and your console shows the rule that applies to you.

What this means practically:

- Find 12 real people with Google accounts — friends, family, local shop owners. They must
  **accept the invite and keep the app installed**; someone opting out resets their contribution.
- The 14 days are **continuous**. A gap restarts the clock.
- Start it the moment internal testing is clean. Everything in §3 can be finished while it runs.
- Collect their emails into a list: **Testing → Closed testing → Testers → Create email list**.

The first closed-testing release **does** go through review (a few hours to a few days).

After 14 days, the console shows an **"Apply for production"** button. Apply. That review is
separate and takes days, occasionally longer.

---

## 6. Production

**Production → Create new release.** Upload the same `.aab` (or a newer build), write the release
notes, and roll out.

```bash
# Optional: submit from the command line instead of the console UI
eas submit --platform android --profile production
```

`eas.json` already points at `./play-service-account.json` with `track: internal` and
`releaseStatus: draft`. Create that key in Google Cloud (a service account with the Play Developer
API enabled, granted access in the Play Console under Users and permissions) and drop the JSON in
the repo root — it is gitignored.

**Use a staged rollout**: 20% first. If something is badly wrong you can halt it before it reaches
everyone. Ramp to 100% over a few days.

### Review times to expect

| Stage | Typical | Can be |
|---|---|---|
| Internal testing | Minutes, no review | — |
| First closed-testing review | Hours to 3 days | A week |
| Production review (first ever release) | **3–7 days** | 2+ weeks |
| Later updates | Hours to 2 days | Days |

The **first** production review of a **new developer account** with **background location** is the
slowest combination Play has. Assume two weeks and be pleasantly surprised.

---

## 7. If you are rejected

Normal, especially the first time. The rejection email names the policy. The two likely ones here:

- **Background location** — the disclosure was not visible in the video, or the wording in the
  form did not match the app. Re-record against `demo-video-script.md` and resubmit.
- **Data safety mismatch** — a form answer contradicts the privacy policy. Fix both to agree,
  using `data-safety.md`.

Fix, resubmit, and answer in the console rather than by email. Do not resubmit unchanged hoping
for a different reviewer.

---

## 8. After you are live

- **Set up a Play Console alert** for crashes and ANRs. `expo-updates` is configured, so JS-only
  fixes can ship over the air without a new review — but a native crash needs a full release.
- **Watch the first reviews.** At low volume, one 1-star review moves your rating badly.
- **Answer the deletion and privacy emails.** They come to
  `rathoresagar26@gmail.com`, which is published on the listing, and Play holds you to the 30-day
  response window you promised in the privacy policy.
- **Keep `data-safety.md` current.** If you add a feature that collects something new, the console
  form and the privacy policy both have to change with it — in the same commit, ideally.

---

## The short version

```
1. production-setup.md          →  clean backend, rotate admin password
2. host docs/legal/             →  fill the 4 URLs in src/lib/legal.ts
3. tsc + expo export            →  both exit 0
4. eas build --profile production
5. BACK UP THE KEYSTORE         →  eas credentials, download, password manager
6. internal testing             →  run the whole checklist on a real device
7. record the demo video        →  demo-video-script.md
8. fill the console             →  store-listing.md, data-safety.md,
                                   permission-declarations.md, account-deletion.md
9. closed testing               →  12 testers × 14 continuous days ← start early
10. apply for production        →  review, staged rollout, live
```
