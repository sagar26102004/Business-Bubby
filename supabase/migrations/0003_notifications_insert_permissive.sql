-- Restore cross-user notification inserts (Path A).
--
-- Notifications are written as SIDE EFFECTS for OTHER users — a new order pings
-- the business owner, a chat reply pings the customer, a booking decision pings
-- the customer, and so on. The app (Path A, talking straight to Supabase) writes
-- these from the acting user's session, so the INSERT policy must allow any
-- signed-in user to insert a row for any recipient. READ stays recipient-only,
-- so no one can see another user's notifications.
--
-- The live DB had this policy hardened to recipient-only, which silently drops
-- every cross-user notification. This restores the permissive INSERT that
-- 0002_policies.sql documents. (Harden later, properly, via SECURITY DEFINER
-- triggers on the source tables if you want to lock writers down.)

drop policy if exists notifications_insert on notifications;

create policy notifications_insert on notifications
  for insert with check (auth.uid() is not null);
