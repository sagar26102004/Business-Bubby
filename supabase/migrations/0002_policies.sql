-- Localo Row-Level Security — document model.
--
-- The layer that enforces "which user can access which data". Every table has
-- RLS enabled; without a matching policy a row is invisible. Access is scoped
-- through the real columns declared in 0001 (owner_id / customer_id /
-- business_id / recipient_id / participant_id), never through `data`.
--
-- Directory data (profiles, businesses, employees, reviews, product threads) is
-- world-readable — Localo is a public directory. Private data (orders, bills,
-- chats, notifications, memberships, tracking) is visible only to the customer
-- it belongs to and to members of the business.
--
-- NOTE: notification rows are written as side effects for OTHER users, so their
-- INSERT is permissive (any signed-in user) for now. Harden later via
-- SECURITY DEFINER triggers on the source tables.
--
-- Idempotent: safe to run more than once. Each policy is dropped BY NAME
-- immediately before it is recreated.
--
-- ⚠️ WHY BY NAME, AND NOT THE "DROP EVERYTHING ON THE TABLE" LOOP 0012 USES
-- A blanket "drop every policy on these tables" would also delete policies that
-- later migrations ADD to the same tables (0004's super-admin grants, 0008's
-- employees_insert/update/delete, 0014's ad_campaigns_*), none of which 0002
-- knows how to recreate. Dropping only the 49 names this file owns keeps the
-- blast radius inside 0002. (0012 can use the loop safely because nothing after
-- it touches push_tokens.)
--
-- ⚠️⚠️ RUN THE FOLDER IN ORDER — NEVER 0002 ON ITS OWN
-- Five of the names below are RESTATED by a later migration, so re-running 0002
-- alone silently reverts them to the weaker version written here:
--
--   businesses_insert    0004  (super-admin may register for someone else)
--   businesses_update    0004  (super-admin may reassign an owner)
--   employees_write      0004  (super-admin may manage any team)
--   orders_update        0009  (order-integrity guard)
--   notifications_insert 0003  (cross-user notifications; same intent, harmless)
--
-- There is no error when this happens — the drops succeed and the weaker policy
-- is installed in silence. Replaying 0002 → 0020 in sequence is always correct,
-- because 0003/0004/0009 restate their versions afterwards. Before this file was
-- made idempotent a stray re-run failed loudly with "policy already exists";
-- that accidental guardrail is gone, so the ordering rule is now load-bearing.

alter table profiles            enable row level security;
alter table businesses          enable row level security;
alter table employees           enable row level security;
alter table saved_places        enable row level security;
alter table bookings            enable row level security;
alter table orders              enable row level security;
alter table bills               enable row level security;
alter table chat_messages       enable row level security;
alter table biz_chat_messages   enable row level security;
alter table notifications       enable row level security;
alter table calls               enable row level security;
alter table reviews             enable row level security;
alter table product_messages    enable row level security;
alter table vehicles            enable row level security;
alter table tracked_items       enable row level security;
alter table location_shares     enable row level security;
alter table memberships         enable row level security;
alter table membership_payments enable row level security;
alter table log_entries         enable row level security;

-- ---- profiles ----
drop policy if exists profiles_read on profiles;
create policy profiles_read   on profiles for select using (true);
drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- businesses ----
drop policy if exists businesses_read on businesses;
create policy businesses_read   on businesses for select using (true);
drop policy if exists businesses_insert on businesses;
create policy businesses_insert on businesses for insert with check (owner_id = auth.uid());
drop policy if exists businesses_update on businesses;
create policy businesses_update on businesses for update
  using (is_business_member(id, auth.uid())) with check (is_business_member(id, auth.uid()));
drop policy if exists businesses_delete on businesses;
create policy businesses_delete on businesses for delete using (owner_id = auth.uid());

-- ---- employees ----
drop policy if exists employees_read on employees;
create policy employees_read  on employees for select using (true);
drop policy if exists employees_write on employees;
create policy employees_write on employees for all
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

-- ---- saved_places (private to the owner) ----
drop policy if exists saved_places_all on saved_places;
create policy saved_places_all on saved_places for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- bookings ----
drop policy if exists bookings_read on bookings;
create policy bookings_read on bookings for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists bookings_insert on bookings;
create policy bookings_insert on bookings for insert with check (customer_id = auth.uid());
drop policy if exists bookings_update on bookings;
create policy bookings_update on bookings for update
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()))
  with check (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));

-- ---- orders ----
drop policy if exists orders_read on orders;
create policy orders_read on orders for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists orders_insert on orders;
create policy orders_insert on orders for insert
  with check (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists orders_update on orders;
create policy orders_update on orders for update
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()))
  with check (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));

-- ---- bills (business issues; customer reads) ----
drop policy if exists bills_read on bills;
create policy bills_read on bills for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists bills_write on bills;
create policy bills_write on bills for all
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

-- ---- chat_messages (B2C) ----
drop policy if exists chat_read on chat_messages;
create policy chat_read on chat_messages for select
  using (participant_id = auth.uid()::text or is_business_member(business_id, auth.uid()));
drop policy if exists chat_insert on chat_messages;
create policy chat_insert on chat_messages for insert
  with check (participant_id = auth.uid()::text or is_business_member(business_id, auth.uid()));

-- ---- biz_chat_messages (B2B) ----
drop policy if exists biz_chat_read on biz_chat_messages;
create policy biz_chat_read on biz_chat_messages for select
  using (is_business_member(from_business_id, auth.uid())
      or is_business_member(to_business_id, auth.uid()));
drop policy if exists biz_chat_insert on biz_chat_messages;
create policy biz_chat_insert on biz_chat_messages for insert
  with check (is_business_member(from_business_id, auth.uid()));

-- ---- notifications ----
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select using (recipient_id = auth.uid());
drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications for insert with check (auth.uid() is not null);

-- ---- calls ----
drop policy if exists calls_read on calls;
create policy calls_read on calls for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists calls_insert on calls;
create policy calls_insert on calls for insert with check (customer_id = auth.uid());
drop policy if exists calls_update on calls;
create policy calls_update on calls for update
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()))
  with check (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));

-- ---- reviews (public read; author writes own) ----
drop policy if exists reviews_read on reviews;
create policy reviews_read   on reviews for select using (true);
drop policy if exists reviews_insert on reviews;
create policy reviews_insert on reviews for insert with check (customer_id = auth.uid());
drop policy if exists reviews_update on reviews;
create policy reviews_update on reviews for update
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
drop policy if exists reviews_delete on reviews;
create policy reviews_delete on reviews for delete using (customer_id = auth.uid());

-- ---- product_messages (public thread) ----
drop policy if exists product_messages_read on product_messages;
create policy product_messages_read on product_messages for select using (true);
drop policy if exists product_messages_insert on product_messages;
create policy product_messages_insert on product_messages for insert with check (author_id = auth.uid());
drop policy if exists product_messages_update on product_messages;
create policy product_messages_update on product_messages for update
  using (author_id = auth.uid() or is_business_member(business_id, auth.uid()))
  with check (author_id = auth.uid() or is_business_member(business_id, auth.uid()));

-- ---- vehicles (members manage; a tracking customer sees the one carrying
--      their item) ----
drop policy if exists vehicles_read on vehicles;
create policy vehicles_read on vehicles for select
  using (is_business_member(business_id, auth.uid())
      or exists (select 1 from tracked_items ti
                 where ti.vehicle_id = vehicles.id and ti.customer_id = auth.uid()));
drop policy if exists vehicles_write on vehicles;
create policy vehicles_write on vehicles for all
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

-- ---- tracked_items ----
drop policy if exists tracked_items_read on tracked_items;
create policy tracked_items_read on tracked_items for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists tracked_items_write on tracked_items;
create policy tracked_items_write on tracked_items for all
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

-- ---- location_shares (driver toggles own; members + tracking customers read) ----
drop policy if exists location_shares_read on location_shares;
create policy location_shares_read on location_shares for select
  using (is_business_member(business_id, auth.uid())
      or exists (select 1 from tracked_items ti
                 where ti.business_id = location_shares.business_id
                   and ti.customer_id = auth.uid()));
drop policy if exists location_shares_write on location_shares;
create policy location_shares_write on location_shares for all
  using (user_id = auth.uid() or is_business_member(business_id, auth.uid()))
  with check (user_id = auth.uid() or is_business_member(business_id, auth.uid()));

-- ---- memberships ----
drop policy if exists memberships_read on memberships;
create policy memberships_read on memberships for select
  using (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists memberships_insert on memberships;
create policy memberships_insert on memberships for insert
  with check (customer_id = auth.uid() or is_business_member(business_id, auth.uid()));
drop policy if exists memberships_update on memberships;
create policy memberships_update on memberships for update
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()));

drop policy if exists membership_payments_read on membership_payments;
create policy membership_payments_read on membership_payments for select
  using (exists (select 1 from memberships m where m.id = membership_id
           and (m.customer_id = auth.uid() or is_business_member(m.business_id, auth.uid()))));
drop policy if exists membership_payments_insert on membership_payments;
create policy membership_payments_insert on membership_payments for insert
  with check (exists (select 1 from memberships m where m.id = membership_id
           and (m.customer_id = auth.uid() or is_business_member(m.business_id, auth.uid()))));
drop policy if exists membership_payments_update on membership_payments;
create policy membership_payments_update on membership_payments for update
  using (exists (select 1 from memberships m where m.id = membership_id
           and is_business_member(m.business_id, auth.uid())))
  with check (exists (select 1 from memberships m where m.id = membership_id
           and is_business_member(m.business_id, auth.uid())));

-- ---- log_entries (members only; append-only) ----
drop policy if exists log_entries_read on log_entries;
create policy log_entries_read on log_entries for select
  using (is_business_member(business_id, auth.uid()));
drop policy if exists log_entries_insert on log_entries;
create policy log_entries_insert on log_entries for insert
  with check (is_business_member(business_id, auth.uid()));
