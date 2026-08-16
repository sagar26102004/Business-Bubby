-- What is ACTUALLY applied to this Supabase project?
--
-- Paste the whole file into the SQL editor and run it. One row per check, with
-- the migration to run when something is missing. Read-only.
--
-- Worth running because this project has drifted before — `0004` and `0005`
-- were once found unapplied, and `0003` exists only because a policy was
-- hand-edited in the dashboard. Don't assume; look.
--
-- Built as a pg_temp function on purpose: Postgres parses a whole query before
-- executing it, so a plain `select ... from platform_admins` would fail with
-- "relation does not exist" on a project that hasn't run 0006 yet — the very
-- situation this script exists to report on. Row counts for tables that may not
-- exist therefore go through EXECUTE. pg_temp is session-local and disappears
-- on its own; nothing is left behind.

create or replace function pg_temp.security_report()
returns table (item text, status text)
language plpgsql
as $$
declare
  n bigint;
  missing text;
begin
  -- ── Tables ───────────────────────────────────────────────────────────────
  return query select 'table · catalog_entries (admin screen)'::text,
    case when to_regclass('public.catalog_entries') is null
         then '❌ missing — run migrations/0005_catalog_entries.sql'
         else '✅ present' end::text;

  return query select 'table · platform_admins (super-admin grant)'::text,
    case when to_regclass('public.platform_admins') is null
         then '❌ missing — run migrations/0006_platform_admins.sql'
         else '✅ present' end::text;

  return query select 'table · profiles_private (phone/email)'::text,
    case when to_regclass('public.profiles_private') is null
         then '❌ missing — run migrations/0007_profiles_private.sql'
         else '✅ present' end::text;

  -- ── Functions ────────────────────────────────────────────────────────────
  return query select 'fn · is_super_admin'::text,
    case when to_regprocedure('public.is_super_admin()') is null
         then '❌ missing — run 0006' else '✅ present' end::text;

  return query select 'fn · is_business_owner / is_business_manager'::text,
    case when to_regprocedure('public.is_business_owner(uuid,uuid)') is null
           or to_regprocedure('public.is_business_manager(uuid,uuid)') is null
         then '❌ missing — run 0008' else '✅ present' end::text;

  return query select 'fn · decide_order_proposal / append_order_lines'::text,
    case when to_regprocedure('public.decide_order_proposal(uuid,boolean)') is null
           or to_regprocedure('public.append_order_lines(uuid,jsonb)') is null
         then '❌ missing — run 0009' else '✅ present' end::text;

  -- ── Triggers ─────────────────────────────────────────────────────────────
  return query select 'trigger · profiles_protect_fields (strips isSuperAdmin/phone)'::text,
    case when not exists (select 1 from pg_trigger
                           where tgname = 'profiles_protect_fields' and not tgisinternal)
         then '❌ missing — run 0006 then 0007' else '✅ present' end::text;

  return query select 'trigger · businesses_protect_privileged (ownership lock)'::text,
    case when not exists (select 1 from pg_trigger
                           where tgname = 'businesses_protect_privileged' and not tgisinternal)
         then '❌ missing — run 0008' else '✅ present' end::text;

  return query select 'trigger · employees_protect_rank (no self-promotion)'::text,
    case when not exists (select 1 from pg_trigger
                           where tgname = 'employees_protect_rank' and not tgisinternal)
         then '❌ missing — run 0008' else '✅ present' end::text;

  return query select 'trigger · orders_sanitize_customer (price/status pinning)'::text,
    case when not exists (select 1 from pg_trigger
                           where tgname = 'orders_sanitize_customer' and not tgisinternal)
         then '❌ missing — run 0009' else '✅ present' end::text;

  -- ── Policies ─────────────────────────────────────────────────────────────
  return query select 'policy · orders_update excludes customers'::text,
    case when exists (select 1 from pg_policies
                       where tablename = 'orders' and policyname = 'orders_update'
                         and qual like '%customer_id%')
         then '❌ customers can still rewrite orders — run 0009'
         when exists (select 1 from pg_policies
                       where tablename = 'orders' and policyname = 'orders_update')
         then '✅ members only'
         else '⚠️ no orders_update policy at all — check 0002' end::text;

  return query select 'policy · employees insert/delete are owner-only'::text,
    case when exists (select 1 from pg_policies
                       where tablename = 'employees' and policyname = 'employees_write')
         then '❌ blanket FOR ALL still present — run 0008'
         when exists (select 1 from pg_policies
                       where tablename = 'employees' and policyname = 'employees_insert')
         then '✅ split'
         else '⚠️ unexpected — inspect pg_policies' end::text;

  return query select 'policy · businesses_update allows super-admin'::text,
    case when exists (select 1 from pg_policies
                       where tablename = 'businesses' and policyname = 'businesses_update'
                         and qual like '%is_super_admin%')
         then '✅ present'
         else '❌ missing — run migrations/0004_super_admin.sql (the admin console needs it)'
         end::text;

  -- Notifications are written as SIDE EFFECTS for OTHER people: a new order
  -- pings the owner, a reply pings the customer. Path A writes them from the
  -- ACTING user's session, so the INSERT policy has to allow any signed-in user
  -- to insert for any recipient. Hardened to recipient-only, every cross-user
  -- alert silently vanishes — no error, the write just affects nothing, and the
  -- business simply never hears about the order. That is why 0003 exists at all
  -- (the policy was once tightened by hand in the dashboard), and it is exactly
  -- the kind of drift the rest of this file was written to catch — yet nothing
  -- here looked at it until now. READ stays recipient-only either way.
  return query select 'policy · notifications_insert is cross-user (0003)'::text,
    case when not exists (select 1 from pg_policies
                           where tablename = 'notifications' and policyname = 'notifications_insert')
         then '❌ no INSERT policy — nobody gets alerts; run 0003'
         when exists (select 1 from pg_policies
                       where tablename = 'notifications' and policyname = 'notifications_insert'
                         and with_check like '%recipient_id%')
         then '❌ recipient-only — cross-user alerts are silently dropped; run migrations/0003_notifications_insert_permissive.sql'
         else '✅ permissive (any signed-in user may notify)' end::text;

  -- ── Row-level security ───────────────────────────────────────────────────
  select string_agg(tablename, ', ') into missing
    from pg_tables where schemaname = 'public' and rowsecurity = false;
  return query select 'RLS · enabled on every public table'::text,
    coalesce('❌ RLS OFF on: ' || missing, '✅ all protected')::text;

  -- ── Leftover data (profiles/businesses always exist — 0001) ───────────────
  return query select 'data · no forgeable isSuperAdmin left on profiles'::text,
    case when exists (select 1 from public.profiles where jsonb_exists(data, 'isSuperAdmin'))
         then '❌ still stored — run 0006' else '✅ clean' end::text;

  return query select 'data · no phone/email left in the public profile card'::text,
    case when to_regclass('public.profiles_private') is null then '⏭ run 0007 first'
         when exists (select 1 from public.profiles
                       where jsonb_exists(data, 'phone') or jsonb_exists(data, 'email'))
         then '❌ still world-readable — run 0007' else '✅ clean' end::text;

  return query select 'data · business documents agree with their owner_id column'::text,
    case when exists (select 1 from public.businesses
                       where data ->> 'ownerId' is distinct from owner_id::text)
         then '❌ drifted — run 0008 (it repairs them)' else '✅ in step' end::text;

  -- ── Leftover data (tables that may not exist yet → dynamic) ───────────────
  if to_regclass('public.platform_admins') is null then
    return query select 'data · someone holds the super-admin grant'::text,
                        '⏭ run 0006 first'::text;
  else
    execute 'select count(*) from public.platform_admins' into n;
    return query select 'data · someone holds the super-admin grant'::text,
      case when n = 0
           then '❌ NOBODY is a super-admin — grant with scripts/grant_super_admin.sql'
           else '✅ ' || n || ' admin(s) — audit them in grant_super_admin.sql' end::text;
  end if;

  -- ── The later migrations (0016 onward), added for the 1.0 release ─────────
  return query select 'fn · resolve_login_email (username sign-in)'::text,
    case when to_regprocedure('public.resolve_login_email(text,text)') is null
         then '❌ missing — run migrations/0016_real_identity.sql'
         else '✅ present' end::text;

  return query select 'fn · anonymize_account (account deletion)'::text,
    case when to_regprocedure('public.anonymize_account(uuid)') is null
         then '❌ missing — run migrations/0019_account_deletion.sql'
         else '✅ present' end::text;

  return query select 'storage · media bucket (listing photos)'::text,
    case when not exists (select 1 from storage.buckets where id = 'media')
         then '❌ missing — run migrations/0015_media_bucket.sql'
         else '✅ present' end::text;

  return query select 'table · ad_campaigns (promoted listings)'::text,
    case when to_regclass('public.ad_campaigns') is null
         then '❌ missing — run migrations/0014_ad_campaigns.sql'
         else '✅ present' end::text;

  -- 0020 replaced the 2-argument counter with a 3-argument one that buckets a
  -- view by the viewer's distance. The app FALLS BACK to the old signature
  -- rather than erroring (src/data/supabase/ads.ts), so a missing 0020 is
  -- silent — every view lands unbanded and the report a business paid for
  -- stays empty. That is why this is checked rather than assumed.
  return query select 'fn · ad_record_event carries a distance band (0020)'::text,
    case when to_regprocedure('public.ad_record_event(uuid,text,double precision)') is not null
         then '✅ 3-arg signature present'
         when to_regprocedure('public.ad_record_event(uuid,text)') is not null
         then '⚠️ still on 0014 — views count but are not banded; run 0020_ad_view_bands.sql'
         else '❌ absent — run migrations/0014 then 0020' end::text;

  -- ── Launch readiness (production-setup.md §2.3–2.4) ───────────────────────
  -- Not security bugs; things that must not still be true on launch day.
  select count(*) into n from auth.users
   where email ~ '^98123400[0-9]+@localo\.app$' or email ~ '^78[0-9]+@localo\.app$';
  return query select 'launch · shared-password test accounts removed'::text,
    case when n > 0
         then '❌ ' || n || ' still live — scripts/rotate_test_accounts.sql'
         else '✅ none' end::text;

  select count(*) into n from public.businesses b
   where not exists (select 1 from auth.users u where u.id = b.owner_id);
  return query select 'launch · no listing owned by a tombstone profile'::text,
    case when n > 0
         then '❌ ' || n || ' orphaned — nobody can edit or take these down'
         else '✅ none' end::text;

  select count(*) into n from public.businesses;
  return query select 'launch · how many listings are in the directory'::text,
    ('ℹ️ ' || n || ' — list them before deleting anything: '
      || 'select id, data->>''name'', type from businesses order by created_at')::text;
end;
$$;

select * from pg_temp.security_report();
