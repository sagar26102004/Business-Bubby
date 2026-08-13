-- =============================================================================
-- Clear the listings sitting under the platform super-admin account.
--
-- WHY THIS EXISTS
-- The platform account is not a shop. Anything owned by it is a test listing or
-- one registered before its real owner had an account, and it makes the admin
-- look like a normal business on Explore. The app has an in-app path for this
-- (Platform console › "Listings under your account" → Hand over / Remove), and
-- for a REAL business that is the right tool — handing it to its owner keeps the
-- page, its orders and its history. This script is the blunt version, for test
-- listings you just want gone.
--
-- IRREVERSIBLE. Deleting a row from `businesses` cascades (0001_schema.sql):
-- employees, bookings, orders, bills, chat_messages, biz_chat_messages, calls,
-- reviews, product_messages, vehicles, tracked_items, location_shares,
-- memberships, log_entries and ad campaigns all go with it.
--
-- HOW TO RUN: Supabase dashboard → SQL editor. Run STEP 1, read the output,
-- then run STEP 2 only if you are happy with what STEP 1 listed.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — LOOK FIRST. What is actually under the admin account?
-- -----------------------------------------------------------------------------
select
  b.id,
  b.data ->> 'name'          as name,
  b.data ->> 'type'          as listing_type,
  b.data ->> 'tagline'       as tagline,
  b.created_at,
  (select count(*) from orders     o where o.business_id = b.id) as orders,
  (select count(*) from bills      x where x.business_id = b.id) as bills,
  (select count(*) from employees  e where e.business_id = b.id) as team,
  (select count(*) from reviews    r where r.business_id = b.id) as reviews
from businesses b
join platform_admins a on a.user_id = b.owner_id
order by b.created_at;

-- A non-zero orders/bills/team/reviews count means a REAL business with someone
-- else's records attached. Do NOT delete that one — hand it to its owner from
-- the Platform console instead, or with:
--
--   update businesses set owner_id = '<real-owner-uuid>' where id = '<business-uuid>';
--
-- (0008 locks owner changes; run it as the service role in the SQL editor.)


-- -----------------------------------------------------------------------------
-- STEP 2 — DELETE. Uncomment ONE of the two forms below and run it.
-- -----------------------------------------------------------------------------

-- (a) Preferred: delete ONE named listing, by the id STEP 1 printed.
--
-- delete from businesses
-- where id = '00000000-0000-0000-0000-000000000000';   -- ← paste the id


-- (b) Sweep: delete EVERY listing owned by any platform admin. Only use this
--     when STEP 1 showed nothing but test listings with zero counts.
--
-- delete from businesses b
-- using platform_admins a
-- where a.user_id = b.owner_id;


-- -----------------------------------------------------------------------------
-- STEP 3 — CONFIRM. Should return no rows.
-- -----------------------------------------------------------------------------
-- select b.id, b.data ->> 'name' as name
-- from businesses b
-- join platform_admins a on a.user_id = b.owner_id;
