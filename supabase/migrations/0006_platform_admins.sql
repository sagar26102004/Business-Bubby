-- Localo — move the platform super-admin grant OUT of user-writable storage.
--
-- THE HOLE THIS CLOSES
-- `is_super_admin()` (0004) decided platform-operator status by reading
-- `profiles.data ->> 'isSuperAdmin'` and a phone allow-list in the same
-- document. `profiles_update` (0002) lets every user rewrite their OWN data
-- document with no field restrictions. So any signed-in user could run
--
--     patch /rest/v1/profiles?id=eq.<their uid>   {"data": {"isSuperAdmin": true}}
--
-- and become a platform super-admin — which 0004 grants the right to insert a
-- business owned by anyone, UPDATE ANY BUSINESS ON THE PLATFORM (including
-- reassigning its owner), and write employees into any business. The
-- authorization check read a field the subject controlled.
--
-- THE FIX
-- The grant moves to `platform_admins`, a table with RLS on and NO insert,
-- update or delete policy at all — RLS denies by default, so the only way to
-- hand out the grant is the service role (the SQL editor, or a server holding
-- the service key). A BEFORE UPDATE trigger additionally strips `isSuperAdmin`
-- from every profile write and pins `phone`, so neither field can be forged
-- again even though the document itself is still user-writable.
--
-- 0004's policies keep working untouched: they call `public.is_super_admin()`,
-- and only that function's body changes.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The grant table
-- ---------------------------------------------------------------------------
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Free-text "who is this and why" — this table should stay small enough to
  -- read at a glance and audit by eye.
  note       text,
  granted_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

-- The ONLY policy: read your own row, so the app can decide whether to show
-- admin UI. There is deliberately no INSERT/UPDATE/DELETE policy — granting is
-- a service-role operation, never something a session can do.
drop policy if exists platform_admins_read_own on platform_admins;
create policy platform_admins_read_own on platform_admins
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Carry the existing super-admins across
--    Runs BEFORE the flag is stripped in step 5, so nobody loses access.
-- ---------------------------------------------------------------------------
insert into platform_admins (user_id, note)
select p.id, 'migrated from profiles.data by 0006'
  from public.profiles p
 where coalesce((p.data ->> 'isSuperAdmin')::boolean, false) = true
    or regexp_replace(coalesce(p.data ->> 'phone', ''), '\D', '', 'g') = '8827548423'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The new source of truth
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read platform_admins past that table's own RLS,
-- and search_path pinned so the lookup can't be hijacked.
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 4. Stop the forged fields at the door
-- ---------------------------------------------------------------------------
-- Why a trigger rather than a stricter WITH CHECK on profiles_update: the app
-- writes the WHOLE profile document on every edit (`{...current, ...patch}`),
-- so a row that already carries a stale `isSuperAdmin` would fail every future
-- update under a WITH CHECK — the user would be permanently unable to change
-- their own name. A trigger normalises the write instead of rejecting it.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Derived from platform_admins on read; never stored.
  new.data = new.data - 'isSuperAdmin';
  -- `phone` identifies the account (it maps to the synthetic login email), so
  -- it is set at signup and is not the client's to change.
  if old.data ? 'phone' then
    new.data = jsonb_set(new.data, '{phone}', old.data -> 'phone');
  else
    new.data = new.data - 'phone';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on profiles;
create trigger profiles_protect_fields
  before update on profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------------
-- 5. Clean the stale flag out of every existing document
-- ---------------------------------------------------------------------------
update public.profiles
   set data = data - 'isSuperAdmin'
 where data ? 'isSuperAdmin';

-- ---------------------------------------------------------------------------
-- HOW TO GRANT / REVOKE (service role only — run in the Supabase SQL editor)
-- ---------------------------------------------------------------------------
--   grant:
--     insert into platform_admins (user_id, note)
--     select id, 'Sagar — founder' from auth.users where email = '<phone>@localo.app'
--     on conflict (user_id) do nothing;
--
--   revoke:
--     delete from platform_admins
--      where user_id = (select id from auth.users where email = '<phone>@localo.app');
--
--   audit (who has it right now):
--     select a.granted_at, a.note, u.email
--       from platform_admins a join auth.users u on u.id = a.user_id
--      order by a.granted_at;
--
-- See also: scripts/grant_super_admin.sql.
--
-- AFTER RUNNING: PostgREST caches the schema, so a brand-new table can 404 from
-- the app for a few seconds. Supabase usually reloads on its own; if the admin
-- UI still doesn't appear, force it with:
--     notify pgrst, 'reload schema';
--
-- The app is safe to deploy either side of this migration: `fetchIsSuperAdmin`
-- treats a missing table as "not an admin" rather than failing sign-in.
