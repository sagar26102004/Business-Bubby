# Localo — Supabase backend

This folder holds the database definition for Localo. It is applied to **your
own** Supabase project (not the one currently linked to the dev tooling).

## Files

- `migrations/0001_schema.sql` — tables, helper functions, the sign-up trigger.
- `migrations/0002_policies.sql` — Row-Level Security (who can read/write what).

## One-time setup

1. Create a project at https://supabase.com (region: **ap-south-1 / Mumbai**
   is closest to India). Free tier is fine.
2. In the project's **SQL Editor**, run `0001_schema.sql`, then
   `0002_policies.sql` (in that order).
3. Under **Authentication → Providers**, keep **Email** enabled. Turn **OFF**
   "Confirm email" for now so sign-up logs you straight in during development
   (re-enable it before real launch).
4. Copy **Project URL** and the **anon public** key from
   **Project Settings → API** into a `.env` file at the repo root:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
   ```

   (`.env.example` is the template; `.env` is gitignored.)
5. Restart the dev server (`npx expo start --web`) so the vars load. Once set,
   `isSupabaseConfigured` becomes true and the app talks to your project.

## Auth model

Localo is phone-first, so we use Supabase **email + password** auth with a
synthetic email derived from the phone number (`<digits>@localo.app`) — this
gives real accounts and sessions with **no paid SMS provider**. The `name` and
`phone` entered at sign-up are stored as auth metadata and copied into the
`profiles` row by the `handle_new_user` trigger. Phone OTP can be layered on
later without changing the schema.

## One account, one device

An account may be signed in on exactly ONE device at a time. Signing in
somewhere else takes the account with you and the previous handset is signed
out, told why, and left at the sign-in screen. **Last sign-in wins** — refusing
the new device instead would lock someone out of their own account the moment
they lose a phone.

Supabase can do this itself (**Single session per user**, Auth → Sessions), but
only on **Pro plans and up**, and only "at intervals of the JWT expiration
time" — up to an hour of two live devices. So the app enforces it, in two
layers that cover each other:

1. **`signOut({ scope: 'others' })` on every sign-in** destroys the other
   sessions' refresh tokens. Real, server-side revocation — but an
   already-issued *access* token stays valid until it expires, so on its own
   the old phone keeps working for up to an hour.
2. **The `active_devices` claim** (`migrations/0022_single_device_session.sql`),
   polled once a minute and on every foreground by `SingleDeviceGate`, so the
   displaced device signs itself out inside a minute with a sentence a person
   can read.

Both halves live in `src/data/supabase/deviceLock.ts` and are shared by Path A
and Path B — identity is Supabase on both, so there is no Express twin to keep
in step (same as media uploads). Everything there is **best-effort and fails
open**: a claim that can't be written never fails a sign-in, and a check that
can't be read (offline, or 0022 not applied) never signs anyone out. Guests
(anonymous sessions) are exempt — that identity is minted per install and
shared with nobody.

`device_id` is a random uuid in the app's own storage (`src/lib/device.ts`), not
a hardware id. Clearing app data, reinstalling, or a private browser window all
read as a new device, which is the honest answer.

If you'd rather have Supabase do it on a Pro plan, turn the dashboard setting on
*as well* — the two don't conflict — but don't remove the client half, or
eviction goes back to taking up to an hour.

## Edge functions

```
supabase functions deploy call-ring
supabase functions deploy call-decline --no-verify-jwt
supabase functions deploy dynamic-responder
supabase functions deploy cloudinary-sign
supabase functions deploy delete-account
```

⚠️ **`call-decline` MUST be deployed with `--no-verify-jwt`.** It is called from
a broadcast receiver in an app that isn't running, which has no session to sign
with — it authenticates by the device's own push token instead (see the header
comment in that function for why that is sufficient). Deployed with the default
JWT verification, every decline is rejected at the gateway before the function
runs, and the only symptom is Decline quietly going back to letting the call
ring out.

`call-ring` is what makes a **closed** app ring at all. If phones only ring
while Localo is open, check in this order:

1. **FCM credentials.** Android pushes go out through Firebase, and Expo needs
   the project's **FCM V1 service account key** uploaded — `google-services.json`
   in the app is only half of it. Without it every push fails with
   `InvalidCredentials`, which `call-ring` now reports verbatim (Account →
   "📞 Call alerts on this phone" → last call you placed). Check with
   `eas credentials` → Android → *Push Notifications: FCM V1*.
2. **A registered device.** "no registered devices" means nobody's token is in
   `push_tokens` — the callee must have signed in on that phone at least once
   since the feature shipped, and granted the notification permission.
3. **Battery optimisation**, which stops delivery outright on aggressive ROMs.
   The in-app check offers the settings screen.

## Media storage (Cloudinary)

Photos and videos go to **Cloudinary**, not to Supabase Storage. The free Supabase
plan gives 1 GB of storage and **5 GB of egress a month**, and a browse grid
pulling twenty full-size photos spends that in roughly 1,750 screen views —
Cloudinary resizes on delivery, so a 150 px tile costs 150 px worth of bytes.
(Cloudflare R2 was the first choice and was ruled out: it needs a credit card.)

**The `media` bucket and `0015_media_bucket.sql` stay in place permanently.**
Every URL stored before the move is absolute and still served from there; drop
the bucket or its public-read policy and every one of those photos goes blank.
Do not edit that migration either — it is applied.

### Setting it up

1. Create the Cloudinary account (free, no card). Copy the **cloud name** from
   the dashboard — it is not the API key.
2. **Settings → Upload → Upload presets → Add**, named `localo_media`:
   - **Signing mode: Signed.** Unsigned would let anyone who unzips the APK
     upload to the account, and could not pin a file to the person who sent it.
   - **Asset folder: empty.** The `<uid>/` prefix comes from the signed
     `public_id`; a preset folder would be prepended and double-nest it.
   - **Use filename / unique filename: off** — we supply the `public_id`.
   - **Overwrite: off.** The `public_id` carries a timestamp and random suffix,
     so a collision is a bug, not a replacement.
   - **Allowed formats:** `jpg,jpeg,png,webp,heic,heif,mp4,mov,webm` — the same
     set `0015`'s `allowed_mime_types` accepts, so both paths take the same files.
   - **Max file size:** `10000000`, if the console exposes it. This is the only
     ceiling a modified client cannot talk past; the byte count in the request
     body is a declared value that exists to produce a readable error.
   - **Format:** leave **empty**. It converts every upload to one format, which
     would mangle video and override the extension the app derived.
   - **Incoming transformation:** leave **EMPTY**, and see the warning below.
   - **Eager transformations:** leave **empty**. Eager variants are generated at
     upload time and billed whether or not anyone ever requests them.

⚠️ **Do not put an incoming transformation on the preset.** The preset is shared
by image and video uploads, so one set there applies to BOTH — and an incoming
transformation on a video means transcoding, which Cloudinary bills per second of
footage. The image cap (`c_limit,w_1600,h_1600,q_auto:good`) is therefore signed
per request by `cloudinary-sign`, for `resource_type=image` only, where it is
visible in code and cannot silently start applying to reels.
3. **Settings → Security: leave "Strict transformations" OFF.** `thumbUrl`
   generates transformation URLs on the fly; strict mode would require every
   width to be pre-registered as a named transformation first.
4. Secrets, then deploy:
   ```
   supabase secrets set CLOUDINARY_CLOUD_NAME=<cloud name> \
                        CLOUDINARY_API_KEY=<api key> \
                        CLOUDINARY_API_SECRET=<api secret> \
                        CLOUDINARY_UPLOAD_PRESET=localo_media
   supabase functions deploy cloudinary-sign
   supabase functions deploy delete-account
   ```
   `delete-account` needs the same three: it sweeps Cloudinary as well as the
   bucket, and without them that half silently removes nothing.

There is **nothing to configure for CORS** — Cloudinary's upload endpoint is
CORS-open by design, since its own browser widget posts straight to it.

### The rules that cost money if broken

- **Video gets no transformation, ever.** Cloudinary bills video transcoding
  *per second of footage* (~2 transformations a second for SD h264), so one
  `q_auto` on a 60-second reel is 120+ transformations every time a variant is
  asked for. `lib/media.ts` returns video URLs untouched; keep it that way.
  Video size is controlled only by the duration caps in `domain/showcase.ts` and
  `features/media/VideoField.tsx`.
- **Three widths, named by role** in `lib/media.ts` — `THUMB_WIDTH`,
  `CARD_WIDTH`, `IMAGE_WIDTH` — and reused, never chosen per component. Each
  distinct variant is a derived asset consuming a transformation *and* storage
  against the same 25-credit monthly budget.
- **`f_auto` is browser-only.** It resolves from the request's `Accept` header,
  so it genuinely serves WebP/AVIF on web and falls back to the original format
  under React Native, which sends no meaningful `Accept`. That is free upside on
  web and a harmless no-op on Android. Do not "fix" it by hardcoding `f_webp`:
  one stored URL is shared by web, Android and any future iOS build, and iOS
  cannot decode WebP through React Native's `Image`.

Free tier is **25 credits/month**, where 1 credit = 1 GB stored *or* 1 GB
delivered *or* 1,000 transformations — one shared budget. Bandwidth is what
actually runs out, and reels are what spend it: a 12 MB clip viewed 100 times is
1.2 credits. Roughly **2,000 reel views a month, total**, and the deals feed
autoplays. That is a product constraint worth knowing before building more video
surface; `react-native-compressor` (needs a native rebuild) would multiply it
4–5×.

## Notes / to harden before launch

- Notification rows are inserted client-side for other users (permissive
  INSERT policy). Move this into `SECURITY DEFINER` triggers on the source
  tables before launch.
- `signInAs` (dev impersonation) can't work against real auth without the
  service-role key; it stays mock-only / disabled in Supabase mode.
- Business sub-data (menu, products, rentals, …) is stored as JSONB on
  `businesses`. Normalise into child tables later if you need to query across
  products/menus directly.
