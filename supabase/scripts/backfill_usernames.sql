-- Localo — give the accounts that predate usernames a handle built from their name.
--
-- WHAT THIS DOES, AND WHY IT IS TWO WRITES AND NOT ONE
-- Setting `profiles.data.username` on its own would be DECORATION. Sign-in
-- never reads that column: it turns what was typed into a credential address
-- arithmetically (`sagar_rathore` → `sagar_rathore@localo.app`) and hands that
-- to GoTrue. So the handle only becomes real when `auth.users.email` moves with
-- it. This script does both, in one transaction, or neither.
--
-- SIGNING IN BY PHONE KEEPS WORKING AFTERWARDS. That is not luck — it is the
-- second layer added in 0016. Typing the phone number first tries
-- `<digits>@localo.app`, which no longer matches; it then falls to
-- `resolve_login_email(phone, password)`, which finds the account through
-- `profiles_private.phone` and returns whatever its address is NOW. So after
-- this runs, both the old phone number and the new username sign in.
--
-- WHAT IT DELIBERATELY SKIPS
--   * accounts on a REAL address (`me@gmail.com`) — Google users and anyone
--     created during the email-first period. Moving those would break the link
--     Google matches on, to fix something that is not broken.
--   * anonymous guest sessions — they are throwaway identities with no name.
--   * anyone who already has a username — this is safe to run twice.
--   * names that cannot make a legal handle: shorter than 3 characters after
--     cleaning, or not starting with a letter. A leading digit is refused on
--     purpose — that is the rule keeping username addresses from colliding with
--     phone addresses on the shared domain (see 0018's header).
--   * a handle whose address is ALREADY TAKEN by another account.
-- Anything skipped is simply left as it was, still signing in by phone.
--
-- ⚠️ RUN STEP 1 FIRST AND READ IT. It changes nothing and shows you exactly
-- which account gets which handle. Only run step 2 once that list looks right.

-- ===========================================================================
-- STEP 1 — PREVIEW. Changes nothing. Read the output.
-- ===========================================================================
with candidate as (
  select
    p.id,
    u.email                       as current_address,
    p.data ->> 'name'             as display_name,
    -- "Sagar Rathore" → "sagar_rathore": lower-case, drop anything that is not
    -- legal in a handle, collapse whitespace to underscores, cap at 20.
    left(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(p.data ->> 'name', ''))), '[^a-z0-9._[:space:]]', '', 'g'),
        '[[:space:]]+', '_', 'g'
      ),
      20
    ) as base
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email like '%@localo.app'          -- synthetic address only
    and coalesce(u.is_anonymous, false) = false
    and not (p.data ? 'username')            -- idempotent
),
legal as (
  select * from candidate where base ~ '^[a-z][a-z0-9._]{2,19}$'
),
-- Two people with the same name would otherwise both claim one handle; the
-- second and later get a numeric suffix rather than being dropped.
ranked as (
  select *, row_number() over (partition by base order by id) as rn from legal
),
resolved as (
  select
    id, current_address, display_name,
    case when rn = 1 then base
         else left(base, 20 - length(rn::text)) || rn::text end as handle
  from ranked
)
select
  r.display_name,
  r.current_address                   as signs_in_with_today,
  r.handle                            as new_username,
  r.handle || '@localo.app'           as new_address,
  case
    when exists (select 1 from auth.users x where x.email = r.handle || '@localo.app')
      then 'SKIPPED — that address already exists'
    else 'will be updated'
  end                                 as outcome
from resolved r
order by outcome, r.display_name;

-- Anything NOT in the list above keeps signing in exactly as it does now.
-- To see what was left out and why:
--
--   select p.data ->> 'name' as name, u.email
--     from public.profiles p join auth.users u on u.id = p.id
--    where u.email like '%@localo.app'
--      and coalesce(u.is_anonymous,false) = false
--      and not (p.data ? 'username')
--      and left(regexp_replace(regexp_replace(lower(trim(coalesce(p.data->>'name',''))),
--            '[^a-z0-9._[:space:]]','','g'), '[[:space:]]+','_','g'), 20)
--          !~ '^[a-z][a-z0-9._]{2,19}$';

-- ===========================================================================
-- STEP 2 — APPLY. Uncomment the whole block and run it.
-- ===========================================================================
-- do $$
-- declare
--   r record;
--   v_new_address text;
--   v_count int := 0;
-- begin
--   -- Lets the write past the guard trigger 0018 installs on `profiles`.
--   -- Transaction-local, and unreachable from any client.
--   perform set_config('localo.allow_username_write', 'on', true);
--
--   for r in
--     with candidate as (
--       select p.id, p.data ->> 'name' as display_name,
--         left(regexp_replace(regexp_replace(lower(trim(coalesce(p.data ->> 'name', ''))),
--              '[^a-z0-9._[:space:]]', '', 'g'), '[[:space:]]+', '_', 'g'), 20) as base
--       from public.profiles p
--       join auth.users u on u.id = p.id
--       where u.email like '%@localo.app'
--         and coalesce(u.is_anonymous, false) = false
--         and not (p.data ? 'username')
--     ),
--     legal as (select * from candidate where base ~ '^[a-z][a-z0-9._]{2,19}$'),
--     ranked as (select *, row_number() over (partition by base order by id) as rn from legal)
--     select id, display_name,
--            case when rn = 1 then base
--                 else left(base, 20 - length(rn::text)) || rn::text end as handle
--       from ranked
--   loop
--     v_new_address := r.handle || '@localo.app';
--
--     -- Never trample an address that exists. Leave that account alone.
--     if exists (select 1 from auth.users x where x.email = v_new_address) then
--       raise notice 'skipped % — % already exists', r.display_name, v_new_address;
--       continue;
--     end if;
--
--     -- 1. The credential address. THIS is what makes the handle work.
--     update auth.users set email = v_new_address where id = r.id;
--
--     -- 2. GoTrue also keeps the address on the identity row for the email
--     --    provider. `auth.identities.email` is generated from this JSON, so
--     --    updating the JSON updates both.
--     update auth.identities
--        set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_address))
--      where user_id = r.id and provider = 'email';
--
--     -- 3. The handle on the public directory card.
--     update public.profiles
--        set data = data || jsonb_build_object('username', r.handle)
--      where id = r.id;
--
--     v_count := v_count + 1;
--     raise notice '% → % (%)', r.display_name, r.handle, v_new_address;
--   end loop;
--
--   raise notice 'updated % account(s)', v_count;
-- end $$;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
--   select p.data ->> 'name' as name, p.data ->> 'username' as username, u.email
--     from public.profiles p join auth.users u on u.id = p.id
--    order by 1;
--
-- Then, in the app: sign in with the new username AND with the old phone
-- number. Both must work. If the phone stops working, `resolve_login_email`
-- from 0016 is missing — re-run that migration.
