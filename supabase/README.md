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

## Notes / to harden before launch

- Notification rows are inserted client-side for other users (permissive
  INSERT policy). Move this into `SECURITY DEFINER` triggers on the source
  tables before launch.
- `signInAs` (dev impersonation) can't work against real auth without the
  service-role key; it stays mock-only / disabled in Supabase mode.
- Business sub-data (menu, products, rentals, …) is stored as JSONB on
  `businesses`. Normalise into child tables later if you need to query across
  products/menus directly.
