-- Localo — account deletion (Google Play hard requirement).
--
-- Play refuses any app with account creation that has no in-app deletion path.
-- This migration is the database half: the rules for WHAT deletion means when
-- one person's data is threaded through other people's records.
--
-- ---------------------------------------------------------------------------
-- THE CASCADE THIS EXISTS TO STOP
-- ---------------------------------------------------------------------------
-- `profiles.id references auth.users (id) on delete cascade` (0001_schema.sql),
-- and `businesses.owner_id references profiles (id) on delete cascade`. So the
-- obvious implementation — call `auth.admin.deleteUser` and let the database
-- sort it out — detonates:
--
--   auth.users → profiles → businesses → employees, orders, bills, bookings,
--   chats, calls, reviews, vehicles, tracked items, memberships, ad campaigns
--
-- One person closing their account would silently delete the shop they own,
-- every bill that shop ever issued (its customers' financial records), and the
-- team's employment history. Reviews they left elsewhere would vanish too
-- (`reviews.customer_id … on delete cascade`), retroactively rewriting other
-- businesses' ratings.
--
-- ---------------------------------------------------------------------------
-- THE MODEL: THE PROFILE BECOMES A TOMBSTONE
-- ---------------------------------------------------------------------------
-- We DROP the `profiles → auth.users` foreign key, so a profile row outlives
-- its auth user. Nothing else changes shape. Because the row survives:
--
--   * no `on delete cascade` fires, anywhere;
--   * no `on delete set null` fires either, so every foreign key still
--     resolves and no client code meets an unexpected NULL;
--   * "deletion" becomes an explicit, readable SCRUB of the tombstone and the
--     `data` documents — reviewable line by line, which a cascade is not.
--
-- The surviving `id` is an opaque uuid. Once `auth.users` and
-- `profiles_private` are gone and the public card is a tombstone, there is
-- nothing behind it: it identifies no one. That is why ids are deliberately
-- LEFT IN PLACE on orders/bills/reviews and only NAMES and free text are
-- scrubbed — it keeps every invariant in the app intact while erasing the
-- person.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS TO WHAT (the full decision table)
-- ---------------------------------------------------------------------------
--   DELETED   auth.users .................. the account itself; frees the
--                                           username for reuse
--             profiles_private ............ phone, email, muted preferences
--             saved_places ................ Home/Work coordinates
--             push_tokens ................. device identifiers
--             location_shares ............. precise location history
--             notifications (theirs) ...... their own inbox
--             tracked_items (theirs) ...... carry a CHILD'S NAME; a minor's
--                                           PII with no owner has no basis to
--                                           be retained
--             chat_messages (their threads) private correspondence with no
--                                           counterparty left; the commercial
--                                           fact survives on the order/bill
--             businesses they own ......... ONLY empty ones (see below)
--
--   TOMBSTONE profiles .................... name → 'Deleted user', no
--                                           username / avatar / bio, not
--                                           public. Holds no personal data.
--
--   ANONYMISED,
--   RETAINED  orders, bills, bookings ..... the other party's commercial and
--             memberships, payments ....... financial records (tax). Lines and
--                                           totals are the BUSINESS's fact;
--                                           the customer's free-text `note` is
--                                           the person's prose, so it goes.
--             calls ....................... the business's 7-day call log
--             reviews ..................... ratings are computed live from
--                                           this table; letting deletion
--                                           rewrite a business's score is both
--                                           unfair to it and a laundering
--                                           lever. Rating and comment stay,
--                                           the author becomes 'Deleted user'.
--             product_messages ............ the stall thread is PUBLIC by
--                                           design — the point is that the
--                                           next shopper finds the question
--                                           answered. Deleting one side would
--                                           orphan the `replyToId` answers.
--             log_entries ................. the business's own record book.
--
--   UNTOUCHED biz_chat_messages ........... written AS A BUSINESS to another
--                                           business, and carrying only an
--                                           `authorName` byline with no author
--                                           id — there is nothing to match a
--                                           person against, and matching a name
--                                           by string would scrub strangers who
--                                           share it.
--
--   UNLINKED  employees ................... `user_id` cleared, the row and its
--                                           `displayName` kept: the business
--                                           typed that roster entry for its
--                                           own use and may still owe wages or
--                                           records against it. This is the one
--                                           place a name deliberately survives.
--
-- ---------------------------------------------------------------------------
-- BUSINESSES: BLOCK, DON'T CASCADE
-- ---------------------------------------------------------------------------
-- A listing with counterparties — staff, orders, bills, bookings, memberships,
-- reviews, customer chats, calls or an ad campaign — BLOCKS the deletion until
-- the owner transfers it or takes it down themselves. Cascading instead would
-- destroy the one person able to hand it over (0008 makes transfer owner-only),
-- take the team's workplace with it, and delete bills that are somebody else's
-- financial record.
--
-- An EMPTY listing — no staff, no transactions, no reviews, e.g. a stall
-- registered once and never used — is deleted with the account. Without that
-- escape hatch, anyone who tried the stall flow once could never delete their
-- account, which is itself a Play problem.
--
-- ---------------------------------------------------------------------------
-- PLATFORM ADMINS CANNOT BE DELETED FROM THE APP
-- ---------------------------------------------------------------------------
-- `platform_admins` cascades off `auth.users`, so deleting the last super-admin
-- would lock the platform out of its own console with no way back in. Refused
-- outright, with a message that says so.
--
-- Requires 0001 (schema), 0006 (platform_admins), 0015 (media bucket).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Let a profile outlive its auth user
-- ---------------------------------------------------------------------------
-- Found by shape rather than by name: the constraint is `profiles_id_fkey` on a
-- stock project, but a database restored or renamed at some point may carry a
-- different label, and dropping the wrong thing here is expensive.
do $$
declare
  constraint_name text;
begin
  select c.conname into constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
   where c.contype = 'f'
     and n.nspname = 'public' and t.relname = 'profiles'
     and rn.nspname = 'auth'   and rt.relname = 'users'
   limit 1;

  if constraint_name is not null then
    execute format('alter table public.profiles drop constraint %I', constraint_name);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. What is standing in the way?
-- ---------------------------------------------------------------------------
-- Returns one row per business that CANNOT go with the account, and why. An
-- empty result means deletion can proceed. Called by the delete-account edge
-- function before anything is touched, and surfaced to the user verbatim so
-- they know exactly what to transfer or take down.
create or replace function public.account_deletion_blockers(p_user uuid)
returns table (business_id uuid, business_name text, reasons text[])
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select b.id,
         coalesce(b.data ->> 'name', 'Untitled listing'),
         r.reasons
    from businesses b
    cross join lateral (
      select array_remove(array[
        case when exists (select 1 from employees e where e.business_id = b.id)
             then 'has team members' end,
        case when exists (select 1 from orders o where o.business_id = b.id)
             then 'has customer orders' end,
        case when exists (select 1 from bills bl where bl.business_id = b.id)
             then 'has issued bills' end,
        case when exists (select 1 from bookings bk where bk.business_id = b.id)
             then 'has bookings' end,
        case when exists (select 1 from memberships m where m.business_id = b.id)
             then 'has members' end,
        case when exists (select 1 from reviews rv where rv.business_id = b.id)
             then 'has reviews' end,
        case when exists (select 1 from chat_messages cm where cm.business_id = b.id)
             then 'has customer chats' end,
        case when exists (select 1 from calls cl where cl.business_id = b.id)
             then 'has call history' end,
        case when exists (select 1 from ad_campaigns ac where ac.business_id = b.id)
             then 'has an ad campaign' end,
        case when exists (select 1 from tracked_items ti where ti.business_id = b.id)
             then 'is tracking items for customers' end
      ]::text[], null::text) as reasons
    ) r
   where b.owner_id = p_user
     and array_length(r.reasons, 1) > 0
   order by 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Which of this user's uploads is nothing pointing at any more?
-- ---------------------------------------------------------------------------
-- Photos live at `media/<uid>/…` (0015) and their public URLs are embedded in
-- the business documents that use them. A blanket wipe of the folder would
-- therefore break the photos of a business the person TRANSFERRED on the way
-- out — and the blocker rule above actively pushes people to transfer. So each
-- object is checked against every surviving listing first.
--
-- The URL stored in `data` contains the object path, hence the substring test.
-- LIKE treats `_` as a wildcard, so a filename with an underscore can match
-- more loosely than intended — which only ever KEEPS a file. Erring toward
-- keeping is the correct direction here.
create or replace function public.unreferenced_media_paths(p_user uuid)
returns setof text
language sql stable security definer set search_path = public as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'media'
     and (storage.foldername(o.name))[1] = p_user::text
     and not exists (
       select 1 from public.businesses b where b.data::text like '%' || o.name || '%'
     );
$$;

-- ---------------------------------------------------------------------------
-- 4. The scrub itself
-- ---------------------------------------------------------------------------
-- ONE transaction: either the whole account is anonymised or nothing is. The
-- caller (the edge function) has already checked the blockers; it is re-checked
-- here anyway, because this function is the last line of defence and the only
-- one that runs with the data actually locked.
--
-- Deleting the `auth.users` row is NOT done here — that needs the Auth admin
-- API, and it is deliberately the LAST step the edge function takes, so a
-- failure part-way leaves an account that can still sign in rather than a
-- ghost that cannot.
create or replace function public.anonymize_account(p_user uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  deleted_name constant text := 'Deleted user';
  blocked      integer;
  listings     integer;
begin
  if p_user is null then
    raise exception 'anonymize_account needs a user id' using errcode = '22004';
  end if;

  if exists (select 1 from platform_admins where user_id = p_user) then
    raise exception 'A platform admin account cannot be deleted from the app.'
      using errcode = '42501';
  end if;

  select count(*) into blocked from public.account_deletion_blockers(p_user);
  if blocked > 0 then
    raise exception 'This account still owns % listing(s) with customers or staff.', blocked
      using errcode = '42501';
  end if;

  -- Their own listings, all provably empty by the check above. Postgres
  -- cascades the (empty) children.
  select count(*) into listings from businesses where owner_id = p_user;
  delete from businesses where owner_id = p_user;

  -- ---- Deleted outright: personal, and nobody else's record -----------------
  delete from profiles_private where id = p_user;
  delete from saved_places     where user_id = p_user;
  delete from push_tokens      where user_id = p_user;
  delete from location_shares  where user_id = p_user;
  delete from notifications    where recipient_id = p_user;
  -- Carries a child's name.
  delete from tracked_items    where customer_id = p_user;
  -- The WHOLE customer thread, both sides: a one-to-one conversation with no
  -- counterparty left is dead weight, and the commercial fact it produced
  -- survives on the order and the bill.
  delete from chat_messages    where participant_id = p_user::text;

  -- ---- Unlinked, but kept for the business ---------------------------------
  update employees
     set user_id = null,
         data = data - 'userId'
   where user_id = p_user;

  -- ---- Anonymised in place -------------------------------------------------
  -- Ids are left pointing at the tombstone on purpose (see the header): they
  -- identify nobody once the account is gone, and keeping them means no
  -- surprise NULLs reach the app.
  update orders
     set data = (data - 'note' - 'enrollees')
              || jsonb_build_object('customerName', deleted_name)
   where customer_id = p_user;

  update bills
     set data = data || jsonb_build_object('customerName', deleted_name)
   where customer_id = p_user;

  update bookings
     set data = (data - 'note') || jsonb_build_object('customerName', deleted_name)
   where customer_id = p_user;

  update calls
     set data = data
              || jsonb_build_object('customerName', deleted_name)
              -- Participants are an array inside the document; rewrite only the
              -- entry that is this person, leaving the business side alone.
              -- The element column is named explicitly (`p(item)`) rather than
              -- leaning on the alias doubling as the column name.
              || jsonb_build_object('participants', coalesce((
                   select jsonb_agg(
                            case when p.item ->> 'id' = p_user::text
                                 then p.item || jsonb_build_object('name', deleted_name)
                                 else p.item end)
                     from jsonb_array_elements(
                            coalesce(data -> 'participants', '[]'::jsonb)) as p(item)
                 ), '[]'::jsonb))
   where customer_id = p_user;

  -- An active plan with nobody left to attend it is over; past months stay as
  -- the business's revenue record.
  -- ⚠️ The `- 'enrolleeName'` is parenthesised on the LEFT deliberately. In
  -- PostgreSQL `-` binds TIGHTER than `||`, so trailing it after the chain
  -- would subtract the key from the CASE result instead of from `data` — and
  -- the enrollee's name (often a child's) would quietly survive.
  update memberships
     set data = (data - 'enrolleeName')
              || jsonb_build_object('customerName', deleted_name)
              || case when coalesce(data ->> 'status', '') in ('pending', 'active')
                      then jsonb_build_object(
                             'status', 'cancelled',
                             'endedAt', to_char(now() at time zone 'utc',
                                                'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                      else '{}'::jsonb end
   where customer_id = p_user;

  update membership_payments
     set data = (data - 'note')
              || jsonb_build_object('reportedByName', deleted_name)
   where data ->> 'customerId' = p_user::text;

  update reviews
     set data = data || jsonb_build_object('customerName', deleted_name)
   where customer_id = p_user;

  update product_messages
     set data = data || jsonb_build_object('authorName', deleted_name)
   where author_id = p_user;

  -- The business's record book: the entry stays, the customer's name doesn't.
  -- Reached through the order it records, because a LogEntry carries only a
  -- `customerName` — there is no customer id on it to match against.
  update log_entries
     set data = data || jsonb_build_object('customerName', deleted_name)
   where (data ->> 'orderId') in (
           select o.id::text from orders o where o.customer_id = p_user
         );

  -- NOT TOUCHED, deliberately: `biz_chat_messages`. A B2B message carries an
  -- `authorName` byline and NO author id (see BizChatMessage in
  -- src/domain/types.ts), so there is nothing to match a person against — and
  -- matching PII by string would scrub other people who share a first name.
  -- The message is written as a BUSINESS to another business and belongs to it,
  -- which is why the byline is allowed to stand.

  -- ---- The tombstone -------------------------------------------------------
  -- Rebuilt from scratch rather than patched, so nothing personal can survive
  -- in a key this function forgot to name. `profiles_protect_fields` still
  -- runs and strips the private keys, as on any other write.
  update profiles
     set data = jsonb_build_object(
                  'id', p_user::text,
                  'name', deleted_name,
                  'isProfilePublic', false,
                  'deletedAt', to_char(now() at time zone 'utc',
                                       'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   where id = p_user;

  return jsonb_build_object('listingsRemoved', listings);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Only the server may call these
-- ---------------------------------------------------------------------------
-- `anonymize_account` takes a user id as an ARGUMENT, so a session able to call
-- it could erase anyone. It is reachable only with the service role, i.e. only
-- from the delete-account edge function, which proves identity from the JWT
-- first. The other two are read-only but leak the shape of a stranger's
-- account, so they are locked down the same way.
revoke all on function public.anonymize_account(uuid)           from public, anon, authenticated;
revoke all on function public.account_deletion_blockers(uuid)   from public, anon, authenticated;
revoke all on function public.unreferenced_media_paths(uuid)    from public, anon, authenticated;

grant execute on function public.anonymize_account(uuid)         to service_role;
grant execute on function public.account_deletion_blockers(uuid) to service_role;
grant execute on function public.unreferenced_media_paths(uuid)  to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   -- 1. The cascade is gone (must return zero rows):
--   select conname from pg_constraint c
--     join pg_class t on t.oid = c.conrelid
--     join pg_class rt on rt.oid = c.confrelid
--    where c.contype = 'f' and t.relname = 'profiles' and rt.relname = 'users';
--
--   -- 2. As an ORDINARY signed-in user, every one of these must be refused:
--   select public.anonymize_account(auth.uid());          -- permission denied
--   select * from public.account_deletion_blockers(auth.uid());
--
--   -- 3. On a throwaway test account, after deleting through the app:
--   select data from profiles where id = '<uid>';  -- {"name":"Deleted user",…}
--   select count(*) from profiles_private where id = '<uid>';   -- 0
--   select data ->> 'customerName' from bills where customer_id = '<uid>';
--                                                  -- 'Deleted user'
--
-- AFTER RUNNING: PostgREST caches the schema. New functions can 404 for a few
-- seconds; force a reload with:  notify pgrst, 'reload schema';
