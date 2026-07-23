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

## Notes / to harden before launch

- Notification rows are inserted client-side for other users (permissive
  INSERT policy). Move this into `SECURITY DEFINER` triggers on the source
  tables before launch.
- `signInAs` (dev impersonation) can't work against real auth without the
  service-role key; it stays mock-only / disabled in Supabase mode.
- Business sub-data (menu, products, rentals, …) is stored as JSONB on
  `businesses`. Normalise into child tables later if you need to query across
  products/menus directly.
