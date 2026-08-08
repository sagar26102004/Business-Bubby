-- Create (or top up) a Localo platform SUPER-ADMIN account.
--
-- Run in the Supabase SQL editor of the project the APP connects to
-- (EXPO_PUBLIC_SUPABASE_URL in .env). Apply migrations/0006_platform_admins.sql
-- FIRST — the grant lives in that table, and nothing else confers it.
--
-- ⚠️ NEVER commit a real password in this file. It is in the repository, so
-- anything saved here is readable by everyone with repo access, forever
-- (including in git history after you delete it). Type the password into the
-- editor for the run, then undo the edit before saving.
--
-- EASIER AND SAFER: sign up through the app with the phone you want, then run
-- only Part 2 (or scripts/grant_super_admin.sql). Then this file never holds a
-- password at all.
--
-- Idempotent: safe to run more than once.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Part 1 — the auth account. SKIP THIS ENTIRELY if you signed up in the app.
-- Edit the three values at the top of the block, run, then undo your edit.
-- ---------------------------------------------------------------------------
do $$
declare
  -- ── edit these ──
  admin_phone text := '8827548423';
  admin_name  text := 'Sagar';
  admin_pw    text := 'REPLACE_ME_BEFORE_RUNNING';
  -- ────────────────
  uid         uuid;
  admin_email text;
begin
  admin_email := admin_phone || '@localo.app';

  if admin_pw = 'REPLACE_ME_BEFORE_RUNNING' then
    raise exception 'Set admin_pw to a real password (from a password manager) first.';
  end if;

  select u.id into uid from auth.users u where u.email = admin_email;

  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      admin_email, crypt(admin_pw, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', admin_name, 'phone', admin_phone),
      now(), now(), '', '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', admin_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    -- Existing account: reset the password to the one supplied above.
    update auth.users
       set encrypted_password = crypt(admin_pw, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = uid;
  end if;

  -- The signup trigger normally creates the profile; cover the direct-insert path.
  insert into public.profiles (id, data)
  values (uid, jsonb_build_object(
    'id', uid, 'name', admin_name, 'phone', admin_phone,
    'email', admin_email, 'isProfilePublic', true
  ))
  on conflict (id) do nothing;

  -- Part 2, inline: THE GRANT. This is the only thing that confers the role.
  -- Note there is no `isSuperAdmin` flag anywhere — `profiles.data` is
  -- user-writable, so a flag there could be forged by any account.
  -- `platform_admins` has no insert policy at all: only a service-role session
  -- (this editor) can write it.
  insert into public.platform_admins (user_id, note)
  values (uid, admin_name || ' — provisioned by create_super_admin.sql')
  on conflict (user_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2 — grant on its own (for an account that signed up through the app).
-- Edit the email, uncomment, run.
-- ---------------------------------------------------------------------------
-- insert into public.platform_admins (user_id, note)
-- select id, 'Sagar — founder'
--   from auth.users
--  where email = '8827548423@localo.app'
-- on conflict (user_id) do nothing;

-- Confirm who holds the grant right now.
select a.granted_at, a.note, u.email
  from public.platform_admins a
  join auth.users u on u.id = a.user_id
 order by a.granted_at;
