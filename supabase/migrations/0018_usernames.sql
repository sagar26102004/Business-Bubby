-- Localo — a username and a password, and nothing else required.
--
-- WHAT CHANGES
-- 0016 made an account "a real email and/or a phone number". In practice both
-- of those cost something before a person can even get in: an email has to be
-- verified to mean anything (and Supabase locks the email templates behind
-- custom SMTP), and a phone has to be verified by SMS (which in India needs DLT
-- registration and a per-message bill). Sign-up should not depend on either.
--
-- So the credential is now a USERNAME. Email and phone remain, demoted to what
-- they always really were here: contact details, unverified, never a way in.
--
-- HOW UNIQUENESS IS ENFORCED — deliberately not by us
-- The credential address is derived from the handle (`<username>@localo.app`),
-- and `auth.users.email` already carries a unique constraint. So a taken
-- username is refused by Postgres inside the same statement that would have
-- created the account. There is no check-then-insert, and therefore no race
-- where two people who typed the same handle at the same moment both win.
-- The index below is for READING (looking someone up by handle), not for that.
--
-- THREE ADDRESS SCHEMES LIVE ON ONE DOMAIN, and cannot collide:
--   sagar@localo.app        a username account — everything created from now on
--   9812340001@localo.app   a phone-first account — the ten seeded test users
--                           and the super-admin, all still signing in by phone
--   me@gmail.com            a real address — Google accounts, plus any made
--                           during the short-lived email-first period
-- `assertUsername` (src/data/repositories.ts) forbids a leading digit, which is
-- what keeps the first two apart. Do not relax that rule without reading this.
--
-- NOTHING EXISTING BREAKS. No row in auth.users is touched. Every account that
-- could sign in yesterday signs in today with the same thing it typed then.
--
-- Requires 0007_profiles_private.sql and 0016_real_identity.sql.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Find a profile by handle
-- ---------------------------------------------------------------------------
-- The handle is PUBLIC — it goes on the directory card next to the display
-- name, because it is how one person refers to another, not a secret. The
-- secret is the password.
create index if not exists profiles_username_idx
  on public.profiles ((lower(data ->> 'username')));

-- ---------------------------------------------------------------------------
-- 2. Sign-up writes the username to the public card
-- ---------------------------------------------------------------------------
-- Replaces the 0016 version. The difference: `username` is stored on the public
-- profile, and the credential address is never mistaken for a contact address —
-- `%@localo.app` now covers BOTH the phone aliases and the new username
-- aliases, and neither is an inbox anyone can reach.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  -- Only a REAL address counts as contact. `new.email` is the credential, which
  -- for a username or phone account is a manufactured one.
  v_email := coalesce(
    nullif(new.raw_user_meta_data ->> 'email', ''),
    case when new.email is not null and new.email not like '%@localo.app'
         then new.email end
  );

  -- Public directory card: display name + handle. No contact details, ever.
  insert into public.profiles (id, data)
  values (new.id, jsonb_strip_nulls(jsonb_build_object(
    'id', new.id,
    'name', coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
                     new.raw_user_meta_data ->> 'username',
                     ''),
    'username', lower(nullif(new.raw_user_meta_data ->> 'username', '')),
    'isProfilePublic', true
  )))
  on conflict (id) do nothing;

  -- Private contact details, both optional and neither verified.
  insert into public.profiles_private (id, data)
  values (new.id, jsonb_strip_nulls(jsonb_build_object(
    'phone', nullif(new.raw_user_meta_data ->> 'phone', ''),
    'email', v_email
  )))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A handle cannot be rewritten by its owner
-- ---------------------------------------------------------------------------
-- The app writes the WHOLE profile document back on every edit, and `profiles`
-- is user-writable. Without this, editing a display name could carry a changed
-- `username` with it — which would say one thing on the directory card while
-- the account still signs in under the old handle, because the credential
-- address in auth.users would not have moved. Pin it to whatever was stored.
--
-- Extends the 0007 guard rather than replacing it: that one strips
-- isSuperAdmin/phone/email/mutedNotifications, and both must keep happening.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin'   -- derived from platform_admins (0006)
                      - 'phone'          -- lives in profiles_private
                      - 'email'
                      - 'mutedNotifications';

  -- Keep the stored handle, whatever the client sent — including nothing, which
  -- is how an older client would silently erase it.
  --
  -- The one exception is an operator running SQL by hand (the username backfill
  -- in supabase/scripts/), which announces itself with a transaction-local flag
  -- PostgREST gives a client no way to set. Without this escape a backfill would
  -- be stripped by this very trigger and appear to do nothing at all.
  if coalesce(current_setting('localo.allow_username_write', true), '') = 'on' then
    return new;
  end if;

  if old.data ? 'username' then
    new.data = new.data || jsonb_build_object('username', old.data -> 'username');
  else
    new.data = new.data - 'username';
  end if;

  return new;
end;
$$;

-- INSERT keeps the 0007 behaviour: a client may not seed private fields. It may
-- set a username, because that is exactly what sign-up does through the trigger
-- above, and an account created any other way still has to pick one.
create or replace function public.protect_profile_fields_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin' - 'phone' - 'email' - 'mutedNotifications';
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   -- a seeded account is untouched and still has no handle:
--   select data ->> 'username' from profiles
--    where id = (select id from auth.users where email = '9812340001@localo.app');
--
--   -- as a signed-in user, a hand-written handle change must not stick:
--   update profiles set data = data || '{"username":"someone_else"}' where id = auth.uid();
--   select data ->> 'username' from profiles where id = auth.uid();  -- unchanged
--
-- AFTER RUNNING:  notify pgrst, 'reload schema';
