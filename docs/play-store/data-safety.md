# Data Safety — the completed questionnaire

Play Console → **App content → Data safety**. Every answer below is derived from the code, with
the file cited. **Wrong answers here are a policy violation, not a mistake** — Google compares
this form against what the app actually does, and against your privacy policy. If you change what
the app collects, change this file in the same commit.

Verified against the codebase on **13 August 2026**.

---

## Section 0 — the opening questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — see "Encryption" below |
| Do you provide a way for users to request that their data be deleted? | **Yes** — in-app (`src/app/delete-account.tsx`) and a web URL (`docs/legal/delete-account.html`) |

**Encryption in transit — the justification.** Every network call the app makes is HTTPS or WSS.
Supabase (REST, Auth, Storage, Realtime) is HTTPS-only (`src/lib/supabase.ts`). Voice call media
rides WebRTC, which is DTLS-SRTP encrypted by mandate — it cannot be sent unencrypted. Push goes
to Expo/FCM over HTTPS (`supabase/functions/call-ring/index.ts`). Map tiles and the Leaflet
library load over HTTPS (`src/components/RealMap.tsx:98`). There is no cleartext endpoint in the
app.

**"Collected" vs "shared" as Google defines them.** *Collected* = transmitted off the device.
*Shared* = transferred to a third party. Localo's processors (Supabase, LiveKit, Expo) are
service providers acting on our instructions, which Google's own guidance says is **not**
"sharing". So almost everything below is **collected: yes, shared: no**. The exceptions are
flagged explicitly.

---

## Section 1 — Personal info

### Name
- **Collected:** Yes · **Shared:** No · **Processed ephemerally:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Display name shown to businesses you order from, message or review. Falls back to the
  username when not given.
- **Cite:** `SignUpInput.name` (`src/data/repositories.ts`), `handle_new_user` trigger
  (`supabase/migrations/0018_usernames.sql:52`), stored in `profiles.data`.

### User IDs
- **Collected:** Yes · **Shared:** No · **Required:** Required
- **Purpose:** App functionality, Account management
- **Why:** The username is the sign-in identifier and is public — it names you to businesses. A
  random uuid is also assigned per account.
- **Cite:** `assertUsername` (`src/data/repositories.ts:294`), `profiles.id`
  (`supabase/migrations/0001_schema.sql:28`).

### Email address
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** An optional contact detail. **Never a credential**, never verified, and nothing is sent
  to it. Also collected when someone chooses "Continue with Google", which returns their address.
- **Cite:** `assertContactDetails` (`src/data/repositories.ts:313`), stored in `profiles_private`
  (`supabase/migrations/0007_profiles_private.sql:38`), Google flow in
  `src/data/supabase/auth.ts` → `signInWithGoogle`.
- **Note for the reviewer, if asked:** the app manufactures an internal address
  `<username>@localo.app` because the auth provider keys accounts to an email column. It is not a
  mailbox, receives nothing, and is never shown. It is not collected *from the user*.

### Phone number
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** An optional contact detail so a business can reach a customer. Never a credential.
  Stored in the private half of the profile, readable only by the account itself or a platform
  operator.
- **Cite:** `profiles_private` + its RLS (`supabase/migrations/0007_profiles_private.sql:49`).

### Other personal info — **YES, declare this one**
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Two cases, both entered by an adult about someone else:
  1. **A tracked child's label** on a school-vehicle run — e.g. "Aarav — Grade 3". A name chosen
     by the parent or the school. No account, photo or contact detail for the child.
  2. **An enrollee name** on a membership taken out for someone else.
- **Cite:** `TrackedItem.label` / `Membership.enrolleeName` (`src/domain/types.ts`).
- **Do not omit this.** It is the answer most likely to be judged inaccurate, and it interacts
  with the Families policy — see §9.

**NOT collected:** address, race/ethnicity, political or religious beliefs, sexual orientation,
or any other personal info type on the form.

---

## Section 2 — Financial info

**Nothing in this section is collected.**

Localo records what was ordered and what a bill totals, but **no payment instrument ever enters
the app**. There is no payment gateway; money changes hands in the real world (cash, UPI, card)
and a business marks the bill paid by hand.

- **Cite:** `Bill.paymentStatus` is flipped by a business member only
  (`src/domain/types.ts`); ad campaigns settle off-app with `AdCampaign.paid` hand-marked
  (`supabase/migrations/0014_ad_campaigns.sql`). No card, bank or payment-processor dependency
  exists in `package.json`.

Order and bill records are declared under **App activity → Other actions** instead, below.

---

## Section 3 — Location

### Approximate location
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Shows businesses near you and sorts results by distance.
- **Cite:** `src/lib/location.ts`, `PlacesRepository.getCurrentPlace`.

### Precise location
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Two distinct uses, and they must be described separately in the permission declaration
  (see `permission-declarations.md`):
  1. **Foreground** — nearby search, distance sorting, and pinning a business's location on the
     map when listing it. **This is the only precise-location use in 1.0.**
  2. 🔁 **Background** — **DEFERRED TO v1.1; do not describe it in the 1.0 Data safety form.**
     `ACCESS_BACKGROUND_LOCATION` is not in the shipped manifest, so declaring background
     collection would overstate what the app does — and a form answer that contradicts the
     manifest is the "data safety mismatch" rejection in `release-checklist.md`. In 1.1 it returns
     as: *only* for a driver who explicitly switches on live sharing for a shift, so the business
     owner and tracking customers can see the vehicle move. Off by default, per business, and
     switched off from the same screen.
- **Cite:** foreground `src/lib/location.ts`; background `src/lib/backgroundLocation.ts:160`
  (`Accuracy.Balanced`, 15s / 25m, with a visible foreground-service notification) — gated off in
  1.0 by `BACKGROUND_LOCATION_ENABLED` at the top of that file.
- **Retention note worth knowing:** one row per driver per business holds the *latest* position
  only — each update replaces the last, so no trail or history is kept
  (`location_shares`, `supabase/migrations/0001_schema.sql:223`, primary key
  `(business_id, user_id)`).

> ⚠️ **Third-party flow you must not overlook.** The map is Leaflet in a WebView loading tiles
> from `tile.openstreetmap.org`, the library from `unpkg.com`, and directions from
> `router.project-osrm.org` (`src/components/RealMap.tsx:67,86,98,139`). Those servers receive the
> device's **IP address and the map viewport**, which is approximate location. Google does not
> require this to be declared as "shared" — it is the user's own browser fetching a map, the same
> as any website — but it **must** appear in your privacy policy, and it does
> (`docs/legal/privacy-policy.html`, processors section). If a reviewer raises it, that is the
> answer.

---

## Section 4 — Photos and videos

### Photos
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Photos of items for sale and a business's display picture. Uploaded only for what the
  user chooses to publish, and they are **public** once on a listing.
- **Cite:** `src/features/media/PhotosField.tsx` (expo-image-picker), stored in the `media` bucket
  under `media/<uid>/…` (`supabase/migrations/0015_media_bucket.sql`).

### Videos
- **Collected:** No — video *links* only.
- **Why:** The work showcase accepts a URL to a video hosted elsewhere (YouTube etc.); the app
  never uploads or stores a video file.
- **Cite:** `PortfolioItem.kind: 'video'` with `url` (`src/domain/types.ts`).

---

## Section 5 — Audio

### Voice or sound recordings
- **Collected:** Yes · **Shared:** No · **Processed ephemerally:** **YES — tick this box**
- **Purpose:** App functionality
- **Why:** Microphone audio carries in-app voice calls between a customer and a business. It is
  streamed live and **never recorded, never stored, and never written to disk or database**.
- **Cite:** LiveKit WebRTC media (`src/features/calls/useCallAudio.ts`); the `calls` table stores
  only call *metadata* — who, when, status, duration — and no audio
  (`supabase/migrations/0001_schema.sql:171`). No recording API is called anywhere.

"Processed ephemerally" is the correct and important answer here — it tells Google the audio is
transient, which is exactly the distinction between a calling app and a recording app.

---

## Section 6 — Messages

### Other in-app messages
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Customer↔business chat, business↔business chat, and the public question/offer threads
  on stall items. Stored so both sides can read the conversation.
- **Cite:** `chat_messages`, `biz_chat_messages`, `product_messages`
  (`supabase/migrations/0001_schema.sql:141,151,194`).
- **Note:** product thread messages are **public by design** — anyone browsing that item reads
  them. That is disclosed in the privacy policy's "what is public" section.

**NOT collected:** emails, SMS/MMS. The app has no access to either.

---

## Section 7 — App activity

### Other user-generated content
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Business listings, menus, services, products, rentals, offers, reviews and ratings.
  Listings and reviews are **public** — that is the point of a directory.
- **Cite:** `businesses`, `reviews` (`supabase/migrations/0001_schema.sql:58,183`).

### Other actions
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Orders, bookings, bills, memberships and membership payments — the record of what a
  customer and a business transacted, visible to both.
- **Cite:** `orders`, `bookings`, `bills`, `memberships`, `membership_payments`
  (`supabase/migrations/0001_schema.sql:110–247`).

**NOT collected:** app interactions/analytics, in-app search history (searches are not logged),
installed apps, page views on other sites, or web browsing history. There is **no analytics SDK in
the project** — verified against `package.json`: no Firebase Analytics, Sentry, Segment,
Amplitude, Mixpanel or Facebook SDK.

---

## Section 8 — Device or other IDs

### Device or other IDs
- **Collected:** Yes · **Shared:** No · **Required:** Optional
- **Purpose:** App functionality
- **Why:** Two things, both operational, neither for tracking:
  1. **Push token** — an Expo/FCM token identifying a device+install, used *solely* to ring
     incoming calls and deliver alerts. Deleted when it stops working, when you sign out, and when
     another account signs in on that handset.
  2. **Update install ID** — `expo-updates` checks `u.expo.dev` for over-the-air updates, sending
     an installation identifier and runtime version.
- **Cite:** `push_tokens` (`supabase/migrations/0011_push_tokens.sql:31`), token lifecycle in
  `0012`/`0013`; updates URL in `app.json` → `expo.updates.url`.

> **There is NO advertising identifier.** The app does not read the GAID, contains no ad SDK, and
> does not track users across apps or sites. If you are asked to complete the "Advertising ID"
> declaration, the answer is **no**. The app's "ads" are businesses paying to be featured inside
> Localo itself (`supabase/migrations/0014_ad_campaigns.sql`) — first-party promoted listings,
> with impression/tap counts used for reporting to that business only, never for profiling or
> targeting.

---

## Section 9 — Data handling practices

| Question | Answer |
|---|---|
| Is data encrypted in transit? | **Yes** (justification at the top) |
| Can users request data deletion? | **Yes** — in-app path and web URL |
| Is data collection required to use the app? | **No.** Browsing, search, the map and viewing listings all work signed out (`useAuth().isGuest`). An account is needed only to transact, message, call, review or list something. |
| Do you follow the Families policy? | **No** — the app is not directed at children (see below) |

**On children.** Set the target audience to **18+**. The app is not directed at children, and the
store listing says so. The only place a child appears is as a *tracked passenger label* entered by
a parent or a school — an adult recording a label about a child, with no account, photo or contact
detail for that child. This is disclosed in `privacy-policy.html` §9. Answering "yes" to the
Families policy would be wrong and would pull in requirements the app does not meet.

---

## Section 10 — Third parties, for the privacy policy (not the form)

Google does not ask you to list processors on the Data Safety form, but your policy must, and a
reviewer may check they match.

| Processor | What it receives | Why |
|---|---|---|
| **Supabase** | All account, listing and transaction data; uploaded photos | Database, authentication, storage |
| **LiveKit** | Live call audio, transiently | Carries in-app voice calls |
| **Expo / Firebase Cloud Messaging** | Push tokens and notification payloads | Ringing incoming calls, delivering alerts |
| **Expo (updates)** | Install ID, runtime version | Over-the-air updates |
| **Google** | Name and email, only for "Continue with Google" | Optional sign-in |
| **OpenStreetMap / OSRM / unpkg** | IP address, map viewport | Map tiles, directions, map library |

---

## Before you submit this form

- [ ] Every answer above matches `docs/legal/privacy-policy.html`. If you edited one, edit both.
- [ ] The privacy policy URL in the listing is character-for-character `PRIVACY_POLICY_URL` from
      `src/lib/legal.ts`.
- [ ] The deletion URL loads **in a private browsing window**, with no login.
- [ ] Target audience is set to 18+.
- [ ] Advertising ID declaration answered **no**.
