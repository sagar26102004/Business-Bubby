-- 0028 · LISTING ACTIVE — is the owner actually on the app?
--
-- `businesses.data.listingActive = false` marks a listing put up FOR a
-- business (bulk publisher, super-admin, demo set) whose owner has never
-- signed in. The business page shows "Listing inactive" so a customer knows a
-- call or chat may reach nobody. A missing flag counts as active
-- (`isListingActive` in src/domain/listingActive.ts).
--
-- The flip to active is a trigger on auth.users, not app code: it fires on
-- every password or Google sign-in from any client (app, website, Path A or
-- Path B), so neither backend has to remember to do it.

-- ---------------------------------------------------------------------------
-- 1. Backfill: everything under a platform admin, and every demo listing,
--    starts inactive; listings real users registered themselves are active.
update businesses
   set data = data || '{"listingActive": false}'::jsonb
 where owner_id in (select user_id from platform_admins)
    or coalesce(data ->> 'demo', 'false') = 'true';

update businesses
   set data = data || '{"listingActive": true}'::jsonb
 where owner_id not in (select user_id from platform_admins)
   and coalesce(data ->> 'demo', 'false') <> 'true'
   and data ->> 'listingActive' is null;

-- ---------------------------------------------------------------------------
-- 2. Signing in to the owning account activates its listings.
--    Never demo listings (Sagar signs in to bot accounts to pitch), never a
--    platform admin's own sign-in. Fails OPEN: a fault here must never block
--    anyone from signing in.
create or replace function public.activate_listings_on_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at
     and not exists (select 1 from public.platform_admins a where a.user_id = new.id) then
    update public.businesses
       set data = data || jsonb_build_object(
             'listingActive', true,
             'activatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     where owner_id = new.id
       and data ->> 'listingActive' = 'false'
       and coalesce(data ->> 'demo', 'false') <> 'true';
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row execute function public.activate_listings_on_sign_in();
