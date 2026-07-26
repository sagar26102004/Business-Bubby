-- Create the Localo platform SUPER-ADMIN account.
--
-- Run this in the Supabase SQL editor of the project the APP connects to
-- (EXPO_PUBLIC_SUPABASE_URL in .env → project ref mzxslzouzmiswnrolcaq).
-- Apply migrations/0004_super_admin.sql FIRST (or alongside) so the RLS policies
-- recognise the account.
--
-- Account:  phone 8827548423  ·  name Sagar  ·  password Sagar@2004
-- Login email (synthetic, phone-first): 8827548423@localo.app
--
-- Idempotent: safe to run more than once. If you'd rather not touch auth.users
-- directly, just SIGN UP in the app with the phone/name/password above (the
-- 8827548423 number is a super-admin by the phone allow-list either way) and run
-- only the final profiles UPSERT to persist the isSuperAdmin flag.

create extension if not exists pgcrypto;

do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = '8827548423@localo.app';

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
      '8827548423@localo.app', crypt('Sagar@2004', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Sagar","phone":"8827548423"}'::jsonb,
      now(), now(), '', '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', '8827548423@localo.app', 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- Ensure the profile exists and carries the super-admin flag (the signup
  -- trigger creates it on insert; this covers both new + pre-existing accounts).
  insert into public.profiles (id, data)
  values (uid, jsonb_build_object(
    'id', uid,
    'name', 'Sagar',
    'phone', '8827548423',
    'email', '8827548423@localo.app',
    'isProfilePublic', true,
    'isSuperAdmin', true
  ))
  on conflict (id) do update
    set data = public.profiles.data || '{"isSuperAdmin":true}'::jsonb;
end $$;
