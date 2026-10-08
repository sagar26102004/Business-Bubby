-- Which accounts are platform admins? — for "this listing isn't run by its
-- owner yet".
--
-- WHY THIS EXISTS
-- Bulk-listed businesses (scripts/list-business, LISTING-PLAN.md) are owned by
-- the platform super-admin until the real owner takes them over. Nobody answers
-- calls, chats, orders or bookings on those, so the app shows "not active for
-- this business" instead of sending them into the void
-- (src/features/businesses/serviceGate.tsx). To know that it has to compare a
-- listing's OWNER against the platform admins — but `platform_admins` (0006)
-- only lets a session read its OWN row, by design.
--
-- This returns the admin user ids and nothing else: no notes, no grant dates,
-- and it can't write. The app fetches it ONCE per session and checks every
-- listing against it locally, instead of one round trip per card. The grant
-- itself still lives only in `platform_admins`, writable only by the service
-- role.
--
-- Supersedes a short-lived per-id `is_platform_admin(uuid)` from the same
-- change, dropped below.
--
-- Idempotent: safe to run more than once.

drop function if exists public.is_platform_admin(uuid);

create or replace function public.platform_admin_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from platform_admins;
$$;

revoke all on function public.platform_admin_ids() from public;
grant execute on function public.platform_admin_ids() to anon, authenticated;
