-- REPAIR — finish migration 0007's data move.
--
-- Symptom: `profiles_private` exists and the protective trigger works (a profile
-- edited since 0007 comes out clean), but pre-existing rows still carry `phone`
-- in the world-readable `profiles.data`. So 0007's DDL applied and its one-time
-- backfill/strip did not.
--
-- Verified from the app on 2026-08-07: 15 of 16 profiles still exposed a phone
-- number to any caller holding the public anon key.
--
-- ORDER MATTERS. This copies contact details INTO profiles_private first and
-- only strips profiles afterwards, in one transaction — so a failure can never
-- leave you with the phone numbers deleted and nowhere to read them from.
--
-- Idempotent: safe to run more than once.

begin;

-- ── Before ─────────────────────────────────────────────────────────────────
select 'BEFORE' as stage,
       count(*) filter (where jsonb_exists(data, 'phone')) as profiles_with_phone,
       count(*) filter (where jsonb_exists(data, 'email')) as profiles_with_email,
       count(*) filter (where jsonb_exists(data, 'mutedNotifications')) as profiles_with_mutes,
       count(*) as total
  from public.profiles;

-- ── 1. Copy contact details across (merge, never clobber) ──────────────────
insert into public.profiles_private (id, data)
select p.id,
       jsonb_strip_nulls(jsonb_build_object(
         'phone',              p.data -> 'phone',
         'email',              p.data -> 'email',
         'mutedNotifications', p.data -> 'mutedNotifications'
       ))
  from public.profiles p
on conflict (id) do update
  -- excluded first so an existing private value wins over a stale public one.
  set data = excluded.data || public.profiles_private.data;

-- Anyone with no phone in either place: fall back to their auth login email,
-- which is where the phone came from in the first place (`<digits>@localo.app`).
update public.profiles_private pp
   set data = pp.data || jsonb_build_object(
         'phone', split_part(u.email, '@', 1),
         'email', u.email)
  from auth.users u
 where u.id = pp.id
   and not jsonb_exists(pp.data, 'phone')
   and u.email like '%@localo.app';

-- ── 2. Only now, strip them from the public card ───────────────────────────
update public.profiles
   set data = data - 'phone' - 'email' - 'mutedNotifications'
 where jsonb_exists(data, 'phone')
    or jsonb_exists(data, 'email')
    or jsonb_exists(data, 'mutedNotifications');

-- ── After ──────────────────────────────────────────────────────────────────
select 'AFTER' as stage,
       count(*) filter (where jsonb_exists(data, 'phone')) as profiles_with_phone,
       count(*) filter (where jsonb_exists(data, 'email')) as profiles_with_email,
       count(*) filter (where jsonb_exists(data, 'mutedNotifications')) as profiles_with_mutes,
       count(*) as total
  from public.profiles;

-- Nobody should have lost their phone in the move.
select 'private rows with a phone' as stage,
       count(*) filter (where jsonb_exists(data, 'phone')) as have_phone,
       count(*) as total
  from public.profiles_private;

commit;

-- Expected after commit:
--   AFTER  → profiles_with_phone = 0, profiles_with_email = 0, mutes = 0
--   private rows with a phone → have_phone should equal the BEFORE phone count
--                               (plus anyone recovered from their login email)
--
-- If AFTER still shows phones, something is re-adding them — stop and say so
-- rather than re-running.
