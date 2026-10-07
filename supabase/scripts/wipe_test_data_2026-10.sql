-- =============================================================================
-- Wipe the test data off the live DB — the move to real data (7 Oct 2026).
--
-- WHAT SURVIVES
--   * the platform super-admin `sagar`
--   * the Play reviewer set from docs/play-store/sign-in-details.md, kept until
--     Play approves the app: `jaikiranaown` + its listing Jai Kirana Store (and
--     the store's one linked employee `jaikiranaemp1`), and `custaarav`
-- Everything else goes: every other account (guests included), every other
-- listing and its history, the grown `catalog_entries` library, and every
-- notification.
--
-- WHY NOT JUST `delete from auth.users`
-- Since 0019, profiles no longer cascade off auth.users, so that would leave
-- tombstones owning live listings. And several FKs to profiles are SET NULL
-- (orders, bills, bookings, calls, memberships, product_messages,
-- tracked_items), so deleting customers would leave the kept store with
-- orphaned orders whose customer_id is null — hence step 2.
--
-- ⛔ ONE-OFF. The blanket profile delete in step 6 is only safe because no real
-- user exists yet. Once real people sign up, deleted users are tombstones that
-- 0019 keeps on purpose — see rotate_test_accounts.sql §3d.
--
-- Backup taken first into schema `wipe_backup_20261007` (every public table +
-- auth_users + media_objects). Drop it once the app is confirmed fine:
--   drop schema wipe_backup_20261007 cascade;
--
-- Runs as one transaction; the assertions at the end roll it all back if the
-- result isn't exactly what's expected.
-- =============================================================================

begin;

create temp table keep_users (id uuid primary key) on commit drop;
insert into keep_users values
  ('55601dcb-22df-42e8-948b-f2a5127bfa09'),  -- sagar (platform admin)
  ('b0e350ef-ee25-4cd4-944f-11f6dcb02362'),  -- jaikiranaown (Play reviewer, owner)
  ('d12f881f-0d4a-41ab-8fa5-d27e09cc303f'),  -- custaarav    (Play reviewer, customer)
  ('82826055-91ee-4656-b37a-6737e850c353');  -- jaikiranaemp1 (Jai Kirana's employee)

create temp table keep_biz (id uuid primary key) on commit drop;
insert into keep_biz values
  ('28428fe9-ad3c-4f6c-b7e2-7a403fd98c20');  -- Jai Kirana Store

-- 1. Every other listing. Children cascade off businesses (0001).
delete from businesses where id not in (select id from keep_biz);

-- 2. Inside the kept store: history with anyone who isn't staying.
delete from membership_payments mp
 using memberships m
 where m.id = mp.membership_id
   and (m.customer_id is null or m.customer_id not in (select id from keep_users));
delete from memberships      where customer_id is null or customer_id not in (select id from keep_users);
delete from orders           where customer_id is null or customer_id not in (select id from keep_users);
delete from bills            where customer_id is null or customer_id not in (select id from keep_users);
delete from bookings         where customer_id is null or customer_id not in (select id from keep_users);
delete from calls            where customer_id is null or customer_id not in (select id from keep_users);
delete from reviews          where customer_id not in (select id from keep_users);
delete from product_messages where author_id is null or author_id not in (select id from keep_users);
delete from tracked_items    where customer_id is null or customer_id not in (select id from keep_users);
delete from employees        where user_id is not null and user_id not in (select id from keep_users);
delete from chat_messages    where participant_id not in (select id::text from keep_users);
delete from log_entries
 where data ? 'orderId'
   and (data ->> 'orderId') not in (select id::text from orders);
delete from biz_chat_messages
 where from_business_id not in (select id from keep_biz)
    or to_business_id   not in (select id from keep_biz);

-- 3. The suggestion library grown from test listings.
delete from catalog_entries;

-- 4. Stale test alerts — the kept accounts start with an empty inbox.
delete from notifications;

-- 5. Per-user leftovers (most also cascade with the profile below).
delete from location_shares where user_id not in (select id from keep_users);
delete from push_tokens     where user_id not in (select id from keep_users);
delete from active_devices  where user_id not in (select id from keep_users);
delete from saved_places    where user_id not in (select id from keep_users);

-- 6. Profiles (and tombstones). Cascades profiles_private etc.
delete from profiles where id not in (select id from keep_users);

-- 7. The sign-ins themselves; frees the usernames.
delete from auth.users where id not in (select id from keep_users);

-- 8. Assert, or roll everything back.
do $$
declare
  n_users int; n_profiles int; n_biz int; n_admins int; n_orphans int;
begin
  select count(*) into n_users    from auth.users;
  select count(*) into n_profiles from profiles;
  select count(*) into n_biz      from businesses;
  select count(*) into n_admins   from platform_admins;
  select (select count(*) from orders   where customer_id is null)
       + (select count(*) from bills    where customer_id is null)
       + (select count(*) from bookings where customer_id is null)
       + (select count(*) from calls    where customer_id is null)
    into n_orphans;
  if n_users <> 4 or n_profiles <> 4 or n_biz <> 1 or n_admins <> 1 or n_orphans <> 0 then
    raise exception 'wipe assertion failed: users=% profiles=% businesses=% admins=% orphans=%',
      n_users, n_profiles, n_biz, n_admins, n_orphans;
  end if;
end $$;

commit;
