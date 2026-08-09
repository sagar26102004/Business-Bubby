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
