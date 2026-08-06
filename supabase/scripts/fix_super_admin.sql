-- ONE-OFF FIX — run this in the Supabase SQL editor of project mzxslzouzmiswnrolcaq.
--
-- Why: on 2026-08-06 the live DB was found to be missing everything super-admin:
--   * auth user 8827548423@localo.app exists but its password is NOT Sagar@2004
--   * migrations/0004_super_admin.sql was never applied  -> is_super_admin() missing,
--     so RLS rejects registering a business owned by someone else
--   * migrations/0005_catalog_entries.sql was never applied -> catalog_entries missing,
--     so the /admin screen errors when it loads the collection
--
-- This script resets the password and applies both migrations (0004 first — 0005's
-- delete policy calls is_super_admin()). Idempotent: safe to run more than once.

create extension if not exists pgcrypto;

-- 1. Reset the super-admin password to Sagar@2004
update auth.users
   set encrypted_password = crypt('Sagar@2004', gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now())
 where email = '8827548423@localo.app';

-- 2. migrations/0004_super_admin.sql
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (p.data ->> 'isSuperAdmin')::boolean
        or regexp_replace(coalesce(p.data ->> 'phone', ''), '\D', '', 'g') in ('8827548423')
      from public.profiles p where p.id = auth.uid()
  ), false);
$$;

drop policy if exists businesses_insert on businesses;
create policy businesses_insert on businesses for insert
  with check (owner_id = auth.uid() or public.is_super_admin());

drop policy if exists businesses_update on businesses;
create policy businesses_update on businesses for update
  using (is_business_member(id, auth.uid()) or public.is_super_admin())
  with check (is_business_member(id, auth.uid()) or public.is_super_admin());

drop policy if exists employees_write on employees;
create policy employees_write on employees for all
  using (is_business_member(business_id, auth.uid()) or public.is_super_admin())
  with check (is_business_member(business_id, auth.uid()) or public.is_super_admin());

-- 3. migrations/0005_catalog_entries.sql
create table if not exists catalog_entries (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,               -- 'tag' | 'dish' | 'service' | 'product'
  key        text not null,               -- lowercase, whitespace-collapsed name
  data       jsonb not null,
  created_at timestamptz not null default now(),
  unique (kind, key)
);
create index if not exists catalog_entries_kind_idx on catalog_entries (kind);
alter table catalog_entries enable row level security;

drop policy if exists catalog_read on catalog_entries;
create policy catalog_read on catalog_entries for select using (true);
drop policy if exists catalog_insert on catalog_entries;
create policy catalog_insert on catalog_entries for insert with check (auth.uid() is not null);
drop policy if exists catalog_update on catalog_entries;
create policy catalog_update on catalog_entries for update
  using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists catalog_delete on catalog_entries;
create policy catalog_delete on catalog_entries for delete using (public.is_super_admin());

-- 4. Persist the flag on the profile (the phone fallback in is_super_admin() already
--    covers it, but this keeps the profile honest).
update public.profiles p
   set data = p.data || '{"isSuperAdmin":true}'::jsonb
  from auth.users u
 where u.email = '8827548423@localo.app' and p.id = u.id;
