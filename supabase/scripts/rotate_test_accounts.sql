-- Rotate the shared password on the SEEDED test accounts.
--
-- WHY THIS MATTERS
-- The seed set (phones 9812340001–10) and every account made through Dev Tools'
-- "Add a test account" (phones starting 78…) share one password, and that
-- password used to be hardcoded in `src/data/supabase/shared.ts` — which ships
-- inside the app bundle, readable by anyone who downloads the app or opens the
-- web build's JS. Combined with `phoneToEmail` (a login email is just
-- `<digits>@localo.app`) and a world-readable profile list, that was a complete
-- account-takeover path for every one of those accounts.
--
-- The code no longer contains a password (it comes from EXPO_PUBLIC_SEED_PASSWORD
-- in a local .env, and release builds strip the whole branch). But the ACCOUNTS
-- still carry the old value, and it is public. Rotate or delete them.
--
-- These accounts own seeded businesses. Rotating is usually what you want —
-- and since migration 0019, DELETING them is the more dangerous option, not the
-- tidier one. See §3 before you reach for it.
--
-- Run in the Supabase SQL editor. Then put the same new value in your local
-- `.env` as EXPO_PUBLIC_SEED_PASSWORD and restart the dev server.

create extension if not exists pgcrypto;

-- ── 1. See what's affected ─────────────────────────────────────────────────
select u.email, u.created_at
  from auth.users u
 where u.email ~ '^98123400[0-9]+@localo\.app$'   -- the seeded ten
    or u.email ~ '^78[0-9]+@localo\.app$'         -- Dev Tools test accounts
 order by u.email;

-- ── 2. Rotate them ─────────────────────────────────────────────────────────
-- Edit the password below to a fresh value, then uncomment and run.
--
-- do $$
-- declare
--   new_pw text := 'CHANGE_ME';
-- begin
--   if new_pw = 'CHANGE_ME' then
--     raise exception 'Pick a new password first.';
--   end if;
--   update auth.users
--      set encrypted_password = crypt(new_pw, gen_salt('bf'))
--    where email ~ '^98123400[0-9]+@localo\.app$'
--       or email ~ '^78[0-9]+@localo\.app$';
-- end $$;

-- ── 3. Or delete them outright ─────────────────────────────────────────────
-- ⚠️ READ THIS FIRST — it changed in migration 0019.
--
-- Deleting the auth user NO LONGER removes their listings. 0019 dropped the
-- `profiles.id references auth.users on delete cascade`, so the profile row
-- survives as a tombstone — and `businesses.owner_id references profiles`
-- still points at it. The listing stays live in the directory, owned by an
-- account nobody can sign into, and there is no in-app way to transfer or take
-- it down. That is worse than leaving the test account alone.
--
-- So: TAKE THE LISTINGS DOWN FIRST, then delete the accounts.
--
-- 3a. See what they own (`businesses` is the document model — the name lives
--     in `data`, there is no `name` column):
--
-- select u.id as owner_uuid, u.email as owner,
--        b.id as listing_id, b.data->>'name' as listing, b.type
--   from auth.users u
--   left join public.businesses b on b.owner_id = u.id
--  where u.email ~ '^98123400[0-9]+@localo\.app$'
--     or u.email ~ '^78[0-9]+@localo\.app$'
--  order by u.email;
--
--     `left join` on purpose: it lists every test account, including the ones
--     that own nothing, so you have all the uuids 3d needs.
--
-- 3b. Remove those listings. Prefer the app's own "take down" action where you
--     can — it is the tested path. Otherwise delete the rows you just listed;
--     the children DO cascade off `businesses` (0001_schema.sql):
--
-- delete from public.businesses where id in ( '<id>', '<id>' );
--
-- 3c. Only once 3a returns no rows, delete the accounts:
--
-- delete from auth.users
--  where email ~ '^98123400[0-9]+@localo\.app$'
--     or email ~ '^78[0-9]+@localo\.app$';
--
-- 3d. Clear the tombstone profiles they leave behind — BY ID, never in bulk.
--
--     ⛔ Do NOT run `delete from profiles where not exists (select 1 from
--     auth.users …)`. Every genuinely deleted user is also a tombstone, and
--     0019 keeps those on purpose so their anonymised orders, bills and reviews
--     still resolve to "Deleted user". A blanket delete cascades those away and
--     rewrites other people's records — the exact thing 0019 was written to
--     prevent.
--
--     Note the uuids from 3a BEFORE you run 3b, because deleting the auth user
--     takes the email with it. Then:
--
-- delete from public.profiles where id in ( '<uuid>', '<uuid>' );

-- ── 4. Don't forget the super-admin ────────────────────────────────────────
-- Its password was committed to the repository too (and is still in git
-- history). Rotate it separately — Supabase Dashboard → Authentication → Users,
-- or scripts/create_super_admin.sql Part 1.
