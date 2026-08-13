-- Localo — ONE PASTE: apply migration 0018, then give existing accounts a
-- username built from their display name.
--
-- HOW TO RUN
--   Supabase dashboard → SQL Editor → New query → paste ALL of this → Run.
--   Safe to run more than once: every step is idempotent and the backfill skips
--   any account that already has a handle.
--
-- WHAT IT DOES
--   1. Everything in supabase/migrations/0018_usernames.sql (index, sign-up
--      trigger, profile guard).
--   2. Moves each existing phone-first account onto a username derived from its
--      name — BOTH the handle on the profile and the credential address in
--      auth.users, because the handle only works if the address moves with it.
--   3. Prints what it changed, then shows the final state.
--
-- WHAT IT LEAVES ALONE
--   Google / real-email accounts, anonymous guests, accounts that already have
--   a handle, names that cannot form a legal handle, and any handle whose
--   address is already taken. Those keep signing in exactly as they do now.
--
-- SIGNING IN BY PHONE STILL WORKS AFTERWARDS — see the note in
-- backfill_usernames.sql. There is a rollback at the bottom of this file.

-- ===========================================================================
-- PART 1 — migration 0018
-- ===========================================================================

create index if not exists profiles_username_idx
  on public.profiles ((lower(data ->> 'username')));

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  v_email := coalesce(
    nullif(new.raw_user_meta_data ->> 'email', ''),
    case when new.email is not null and new.email not like '%@localo.app'
         then new.email end
  );

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

  insert into public.profiles_private (id, data)
  values (new.id, jsonb_strip_nulls(jsonb_build_object(
    'phone', nullif(new.raw_user_meta_data ->> 'phone', ''),
    'email', v_email
  )))
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin' - 'phone' - 'email' - 'mutedNotifications';

  -- The operator escape used by the backfill below. Transaction-local, and
  -- unreachable from PostgREST — without it this trigger would strip the very
  -- handle the backfill writes and the whole thing would appear to do nothing.
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

create or replace function public.protect_profile_fields_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = new.data - 'isSuperAdmin' - 'phone' - 'email' - 'mutedNotifications';
  return new;
end;
$$;

-- ===========================================================================
-- PART 2 — the backfill
-- ===========================================================================
do $$
declare
  r record;
  v_new_address text;
  v_count int := 0;
  v_skipped int := 0;
begin
  perform set_config('localo.allow_username_write', 'on', true);

  for r in
    with candidate as (
      select p.id, p.data ->> 'name' as display_name,
        -- "Sagar Rathore" → "sagar_rathore"
        left(regexp_replace(regexp_replace(lower(trim(coalesce(p.data ->> 'name', ''))),
             '[^a-z0-9._[:space:]]', '', 'g'), '[[:space:]]+', '_', 'g'), 20) as base
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.email like '%@localo.app'
        and coalesce(u.is_anonymous, false) = false
        and not (p.data ? 'username')
    ),
    legal as (select * from candidate where base ~ '^[a-z][a-z0-9._]{2,19}$'),
    ranked as (select *, row_number() over (partition by base order by id) as rn from legal)
    select id, display_name,
           case when rn = 1 then base
                else left(base, 20 - length(rn::text)) || rn::text end as handle
      from ranked
  loop
    v_new_address := r.handle || '@localo.app';

    if exists (select 1 from auth.users x where x.email = v_new_address) then
      raise notice 'SKIPPED %  — % already exists', r.display_name, v_new_address;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The credential address. THIS is what makes the handle able to sign in.
    update auth.users set email = v_new_address where id = r.id;

    -- GoTrue also keeps the address on the identity row. `auth.identities.email`
    -- is generated from this JSON, so updating the JSON updates both.
    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_address))
     where user_id = r.id and provider = 'email';

    -- The handle on the public directory card.
    update public.profiles
       set data = data || jsonb_build_object('username', r.handle)
     where id = r.id;

    v_count := v_count + 1;
    raise notice 'OK       %  →  %', r.display_name, r.handle;
  end loop;

  raise notice '---- updated %, skipped % ----', v_count, v_skipped;
end $$;

-- PostgREST caches the schema; make the new index/trigger visible immediately.
notify pgrst, 'reload schema';

-- ===========================================================================
-- PART 3 — what you now have
-- ===========================================================================
select
  p.data ->> 'name'      as name,
  p.data ->> 'username'  as username,
  u.email                as signs_in_as,
  pp.data ->> 'phone'    as phone_also_works
from public.profiles p
join auth.users u on u.id = p.id
left join public.profiles_private pp on pp.id = p.id
where coalesce(u.is_anonymous, false) = false
order by 1;

-- ===========================================================================
-- ROLLBACK — only if something looks wrong
-- ===========================================================================
-- Puts every backfilled account back on its phone address and drops the handle.
-- Accounts whose phone is unknown cannot be reverted this way, so check the
-- listing above first: `phone_also_works` must be non-null for each of them.
--
-- do $$
-- declare r record; v_old text;
-- begin
--   perform set_config('localo.allow_username_write', 'on', true);
--   for r in
--     select p.id, regexp_replace(coalesce(pp.data ->> 'phone',''), '\D', '', 'g') as digits
--       from public.profiles p
--       join public.profiles_private pp on pp.id = p.id
--      where p.data ? 'username'
--   loop
--     if length(r.digits) < 8 then continue; end if;
--     v_old := r.digits || '@localo.app';
--     update auth.users set email = v_old where id = r.id;
--     update auth.identities
--        set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_old))
--      where user_id = r.id and provider = 'email';
--     update public.profiles set data = data - 'username' where id = r.id;
--   end loop;
-- end $$;
