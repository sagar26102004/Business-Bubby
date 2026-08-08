-- Localo — split private contact details out of the public directory card.
--
-- THE HOLE THIS CLOSES
-- `profiles_read` is `using (true)` — Localo is a public directory, so a
-- profile row has to be world-readable for owner names, employee cards, review
-- authors and chat names to render for guests. But the whole domain `User`
-- lives in that one `data` document, INCLUDING the phone and email. RLS is
-- row-level: it cannot hide a field. So a single request with the public anon
-- key dumped every user's phone number and email:
--
--     get /rest/v1/profiles?select=data
--
-- That is a bulk PII leak on its own, and it also hands an attacker the exact
-- input for the synthetic-email login (`<digits>@localo.app`), turning any
-- weak or shared password into account takeover. `User.isProfilePublic` was
-- never enforced here either.
--
-- THE FIX
-- Split the document in two, along the line that actually matters:
--   * `profiles`         — the PUBLIC directory card: name, isProfilePublic,
--                          avatarUrl, bio. Stays world-readable; there is now
--                          nothing sensitive in it to leak.
--   * `profiles_private` — contact details and preferences: phone, email,
--                          mutedNotifications. Readable by the account itself
--                          and by a platform super-admin (who onboards
--                          businesses and needs to reach owners), nobody else.
--
-- Because the split is by TABLE, RLS can finally express the rule. Everything
-- that reads a profile for a NAME keeps working untouched — that was six
-- repositories (chat, customers, calls, notifications, users, shared).
--
-- Requires 0006_platform_admins.sql (for is_super_admin()).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The private half
-- ---------------------------------------------------------------------------
create table if not exists profiles_private (
  id         uuid primary key references public.profiles (id) on delete cascade,
  -- Document model, like every other table: the private slice of domain User.
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table profiles_private enable row level security;

-- Yours, or a platform operator's. Deliberately NOT world-readable.
drop policy if exists profiles_private_read on profiles_private;
create policy profiles_private_read on profiles_private
  for select using (id = auth.uid() or public.is_super_admin());

-- Only ever your own row — a super-admin can read contact details but has no
-- business rewriting them.
drop policy if exists profiles_private_insert on profiles_private;
create policy profiles_private_insert on profiles_private
  for insert with check (id = auth.uid());

drop policy if exists profiles_private_update on profiles_private;
create policy profiles_private_update on profiles_private
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Move the existing values across, then strip them from the public card
-- ---------------------------------------------------------------------------
insert into profiles_private (id, data)
select p.id,
       jsonb_strip_nulls(jsonb_build_object(
         'phone', p.data -> 'phone',
         'email', p.data -> 'email',
         'mutedNotifications', p.data -> 'mutedNotifications'
       ))
  from public.profiles p
on conflict (id) do update
  set data = profiles_private.data || excluded.data;

update public.profiles
   set data = data - 'phone' - 'email' - 'mutedNotifications'
 where data ?| array['phone', 'email', 'mutedNotifications'];

-- ---------------------------------------------------------------------------
-- 3. Signup writes to both halves
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Public directory card.
  insert into public.profiles (id, data)
  values (new.id, jsonb_build_object(
    'id', new.id,
    'name', coalesce(new.raw_user_meta_data ->> 'name', ''),
    'isProfilePublic', true
  ))
  on conflict (id) do nothing;

  -- Private contact details.
  insert into public.profiles_private (id, data)
  values (new.id, jsonb_strip_nulls(jsonb_build_object(
    'phone', new.raw_user_meta_data ->> 'phone',
    'email', new.email
  )))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keep the private fields out of the public card for good
-- ---------------------------------------------------------------------------
-- Replaces the 0006 version: `phone` no longer lives in profiles.data at all,
-- so instead of pinning it we simply strip every private key on write. A client
-- that round-trips a merged User object therefore can't leak its own contact
-- details back into the world-readable row.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin'   -- derived from platform_admins (0006)
                      - 'phone'          -- lives in profiles_private
                      - 'email'
                      - 'mutedNotifications';
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on profiles;
create trigger profiles_protect_fields
  before update on profiles
  for each row execute function public.protect_profile_fields();

-- Same guard on INSERT: `profiles_insert` lets a user create their own row, and
-- without this they could seed it with a phone/email that everyone can read.
create or replace function public.protect_profile_fields_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin' - 'phone' - 'email' - 'mutedNotifications';
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields_insert on profiles;
create trigger profiles_protect_fields_insert
  before insert on profiles
  for each row execute function public.protect_profile_fields_insert();

-- ---------------------------------------------------------------------------
-- VERIFY (should all return zero rows)
-- ---------------------------------------------------------------------------
--   -- no contact details left in the public card:
--   select id from profiles where data ?| array['phone','email','mutedNotifications'];
--
--   -- and as an ORDINARY signed-in user, this must return only your own row:
--   select id from profiles_private;
--
-- AFTER RUNNING: PostgREST caches the schema. If `profiles_private` 404s from
-- the app for a few seconds, force a reload with:
--     notify pgrst, 'reload schema';
