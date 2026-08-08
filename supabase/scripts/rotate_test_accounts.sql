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
-- These accounts own seeded businesses, so DELETING them cascades to those
-- listings. Rotating is usually what you want.
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

-- ── 3. Or delete them outright (⚠️ CASCADES to the businesses they own) ────
-- Check what would go first:
--
-- select b.name, u.email as owner
--   from public.businesses b
--   join auth.users u on u.id = b.owner_id
--  where u.email ~ '^98123400[0-9]+@localo\.app$'
--     or u.email ~ '^78[0-9]+@localo\.app$';
--
-- Then, only if you're happy to lose those listings:
--
-- delete from auth.users
--  where email ~ '^98123400[0-9]+@localo\.app$'
--     or email ~ '^78[0-9]+@localo\.app$';

-- ── 4. Don't forget the super-admin ────────────────────────────────────────
-- Its password was committed to the repository too (and is still in git
-- history). Rotate it separately — Supabase Dashboard → Authentication → Users,
-- or scripts/create_super_admin.sql Part 1.
