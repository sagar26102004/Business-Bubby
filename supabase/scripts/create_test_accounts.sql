-- Localo — create the 44 TEST ACCOUNTS from docs/testing/TEST-DATA.md in one go.
--
-- WHY THIS EXISTS
-- Filling the sign-up form 44 times tests the sign-up form, which is not what
-- anyone wants to spend an evening on. This creates the same accounts directly:
-- an `auth.users` row + its `auth.identities` row, exactly the shape
-- `sb.auth.signUp` produces (src/data/supabase/auth.ts), with `name` and
-- `username` in `raw_user_meta_data`. The `on_auth_user_created` trigger
-- (migration 0018) then writes the public `profiles` card and the empty
-- `profiles_private` row by itself — so these accounts are indistinguishable
-- from ones made through the app, and sign in the same way.
--
-- WHERE TO RUN IT
-- The Supabase SQL editor of the project the app connects to
-- (EXPO_PUBLIC_SUPABASE_URL in .env). Paste the whole file, press Run.
--
-- REQUIREMENTS
--   * migrations 0001, 0007 and 0018 applied (they are, on the live project)
--   * Auth → Providers → Email → "Confirm email" OFF. These addresses are
--     synthetic (<username>@localo.app) and have no inbox; the script marks
--     them confirmed anyway, but a project that demands confirmation will still
--     refuse the sign-in.
--
-- ⚠️ THE PASSWORD IS IN THIS FILE ON PURPOSE, and that is only acceptable
-- because these are throwaway accounts on a test project. It is the same value
-- printed in docs/testing/TEST-DATA.md. Never point this script at a database
-- with real users, and if this project ever takes real traffic, rotate every
-- account it made (supabase/scripts/rotate_test_accounts.sql).
--
-- IDEMPOTENT. Run it as often as you like:
--   * an account that doesn't exist is created
--   * one that does has its password reset to `test_pw` below (handy when you
--     forget which password a half-made account got)
-- Nothing else about an existing account is touched — its profile, its
-- listings and its history all survive.

create extension if not exists pgcrypto;

do $$
declare
  -- ── the shared password for every account below ──
  test_pw text := 'test1234';
  -- ─────────────────────────────────────────────────
  r        record;
  uid      uuid;
  addr     text;
  n_new    int := 0;
  n_reset  int := 0;
begin
  for r in
    select * from (values
      -- ── Business owners (14) ──────────────────────────────────────────────
      ('cornercafeown',  'Ramesh Patel'),
      ('sparksown',      'Anil Sharma'),
      ('glowsalonown',   'Kavita Nair'),
      ('ironpeakown',    'Mahendra Yadav'),
      ('sunbusown',      'Deepak Chouhan'),
      ('shreerentown',   'Sanjay Rathore'),
      ('aashiyanaown',   'Imran Qureshi'),
      ('rangoliown',     'Pooja Malviya'),
      ('gurukulown',     'Shrikant Dubey'),
      ('coolairown',     'Faizan Khan'),
      ('jaikiranaown',   'Jai Prakash'),
      ('lifecareown',    'Sunita Jain'),
      ('mahakalown',     'Bhagwan Das'),
      ('ujjaintentown',  'Om Prakash'),

      -- ── Employees (23) ────────────────────────────────────────────────────
      ('cornercafeemp1', 'Suresh Rawat'),
      ('cornercafeemp2', 'Vikram Solanki'),
      ('cornercafeemp3', 'Rekha Bai'),
      ('sparksemp1',     'Nitin Verma'),
      ('sparksemp2',     'Golu Yadav'),
      ('glowsalonemp1',  'Anjali Rao'),
      ('glowsalonemp2',  'Shalu Mehta'),
      ('ironpeakemp1',   'Ravi Thakur'),
      ('ironpeakemp2',   'Neelam Sisodiya'),
      ('sunbusemp1',     'Arun Pawar'),
      ('sunbusdrv1',     'Ramlal Bhilala'),
      ('sunbusdrv2',     'Shyam Tomar'),
      ('shreerentemp1',  'Akash Jadhav'),
      ('shreerentemp2',  'Babu Lal'),
      ('aashiyanaemp1',  'Salman Sheikh'),
      ('rangoliemp1',    'Tarun Gupta'),
      ('rangoliemp2',    'Sheetal Chouhan'),
      ('gurukulemp1',    'Alok Mishra'),
      ('gurukulemp2',    'Priyanka Sen'),
      ('coolairemp1',    'Javed Ali'),
      ('coolairemp2',    'Manoj Kumawat'),
      ('jaikiranaemp1',  'Chotu Yadav'),
      ('mahakalemp1',    'Kishore Baghel'),

      -- ── Stall sellers (3) ─────────────────────────────────────────────────
      ('rohitseller',    'Rohit Verma'),
      ('meenaseller',    'Meena Joshi'),
      ('karanseller',    'Karan Singh'),

      -- ── Customers (4) ─────────────────────────────────────────────────────
      ('custaarav',      'Aarav Mehta'),
      ('custpriya',      'Priya Sethi'),
      ('custvikas',      'Vikas Chauhan'),
      ('custneha',       'Neha Bansal')
    ) as t(username, display_name)
  loop
    -- The credential address, derived exactly like `usernameToEmail` does.
    addr := r.username || '@localo.app';

    select u.id into uid from auth.users u where u.email = addr;

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
        addr, crypt(test_pw, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        -- What sign-up puts here. `handle_new_user` reads exactly these two
        -- keys: `name` lands on the public card (and is what employee search
        -- and customer lookup match on), `username` is the handle.
        jsonb_build_object('name', r.display_name, 'username', r.username),
        now(), now(), '', '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', addr, 'email_verified', true),
        'email', now(), now(), now()
      );

      n_new := n_new + 1;
    else
      -- Already there: just make sure the password is the one above, so a
      -- half-finished earlier run can't leave you locked out.
      update auth.users
         set encrypted_password = crypt(test_pw, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now())
       where id = uid;

      n_reset := n_reset + 1;
    end if;

    -- Belt and braces for the profile card: the trigger above normally writes
    -- it, but a project where the trigger was dropped would otherwise produce
    -- accounts that can sign in and are invisible everywhere else — no display
    -- name means employee search can never find them.
    insert into public.profiles (id, data)
    values (uid, jsonb_build_object(
      'id', uid,
      'name', r.display_name,
      'username', r.username,
      'isProfilePublic', true
    ))
    on conflict (id) do nothing;
  end loop;

  raise notice 'Localo test accounts: % created, % existing (password reset).', n_new, n_reset;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY — 44 rows, each with a username AND a display name.
-- ---------------------------------------------------------------------------
-- A blank display_name here is the one failure worth catching: such an account
-- signs in fine but can never be found when you try to add it to a team.
select p.data ->> 'username'  as username,
       p.data ->> 'name'      as display_name,
       u.email,
       u.created_at
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email ~ ('^(' ||
       'cornercafeown|sparksown|glowsalonown|ironpeakown|sunbusown|shreerentown|' ||
       'aashiyanaown|rangoliown|gurukulown|coolairown|jaikiranaown|lifecareown|' ||
       'mahakalown|ujjaintentown|cornercafeemp[123]|sparksemp[12]|glowsalonemp[12]|' ||
       'ironpeakemp[12]|sunbusemp1|sunbusdrv[12]|shreerentemp[12]|aashiyanaemp1|' ||
       'rangoliemp[12]|gurukulemp[12]|coolairemp[12]|jaikiranaemp1|mahakalemp1|' ||
       'rohitseller|meenaseller|karanseller|cust(aarav|priya|vikas|neha)' ||
       ')@localo\.app$')
 order by u.created_at, username;

-- ---------------------------------------------------------------------------
-- TEARDOWN — delete every account this script made, and everything they own.
-- ---------------------------------------------------------------------------
-- ⚠️ ORDER MATTERS, and not for the reason you'd guess. Migration 0019 removed
-- the `profiles.id references auth.users on delete cascade`, so deleting the
-- auth user FIRST leaves the profile behind as a tombstone — and their shops
-- stay live in the directory, owned by an account nobody can sign into, with no
-- in-app way to take them down. Delete the PROFILE first: everything else
-- (businesses, orders, bills, chats, reviews, vehicles, notifications) hangs off
-- it and cascades away. Then delete the auth users.
--
-- Uncomment both statements and run them together.
--
-- delete from public.profiles
--  where id in (select id from auth.users
--                where email ~ '^(cornercafe|sparks|glowsalon|ironpeak|sunbus|shreerent|aashiyana|rangoli|gurukul|coolair|jaikirana|lifecare|mahakal|ujjaintent|rohitseller|meenaseller|karanseller|cust)[a-z0-9]*@localo\.app$');
--
-- delete from auth.users
--  where email ~ '^(cornercafe|sparks|glowsalon|ironpeak|sunbus|shreerent|aashiyana|rangoli|gurukul|coolair|jaikirana|lifecare|mahakal|ujjaintent|rohitseller|meenaseller|karanseller|cust)[a-z0-9]*@localo\.app$';
