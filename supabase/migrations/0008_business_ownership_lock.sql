-- Localo — stop a team member from taking over the business they work for.
--
-- THE HOLE THIS CLOSES (two vulnerabilities that chain)
--
-- 1. OWNERSHIP SEIZURE. `businesses_update` authorises with
--    `is_business_member(id, auth.uid())` in both USING and WITH CHECK. That
--    predicate never looks at `owner_id`, so it is still satisfied by a row
--    whose ownership you just rewrote to yourself:
--
--      patch /rest/v1/businesses?id=eq.<biz>   {"owner_id": "<my uid>"}
--
--    A part-time helper became the owner of the shop. Worse, the app reads
--    `business.ownerId` from the `data` DOCUMENT while RLS keys on the COLUMN,
--    so writing only `data.ownerId` — which every member may do — makes the
--    whole app treat you as the owner even with the column untouched.
--
-- 2. THE RANK LADDER. `employees_write` is `FOR ALL` to any member, and
--    `Employee.level` ('manager' | 'staff') lives inside `data`, where RLS
--    cannot see it. So a staff member could promote themselves to manager, or
--    link their own account onto someone else's row. Manager/staff was only
--    ever a client-side distinction.
--
-- THE FIX
--   * Ownership moves only when the CURRENT owner or a platform super-admin
--     asks for it, and `data.ownerId` is force-synced to the column on every
--     write so the document can never disagree with the authorisation source.
--   * Employee rows are created and deleted by the owner only; anyone on the
--     team may still update one (that's how managers grant per-service access),
--     but `level`, the linked account, and the business it belongs to are
--     owner-only fields.
--   * The team & routing lists inside the business document (who rings on
--     calls, who answers chats, which modules run) need manager or owner.
--
-- Left deliberately unchanged: any member may still edit the ordinary listing
-- content (name, menu, services, offers). That matches how the app behaves
-- today; the "Menu & pricing" permission is still advisory, not enforced here.
--
-- Requires 0006 (is_super_admin). Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Rank helpers (SECURITY DEFINER so they see past the callers' own RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_business_owner(bid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null
     and exists (select 1 from businesses b where b.id = bid and b.owner_id = uid);
$$;

create or replace function public.is_business_manager(bid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
       exists (select 1 from businesses b where b.id = bid and b.owner_id = uid)
    or exists (select 1 from employees e
                where e.business_id = bid
                  and e.user_id = uid
                  and coalesce(e.data ->> 'level', 'staff') = 'manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Businesses: pin ownership, and the privileged lists, on every update
-- ---------------------------------------------------------------------------
create or replace function public.protect_business_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor      uuid   := auth.uid();
  privileged text[] := array[
    'employeeIds', 'callHandlerIds', 'chatRecipientIds', 'scanHandlerIds', 'modules'
  ];
  field      text;
begin
  -- A null actor means there is no JWT on this connection: the privileged
  -- server path (Prisma / service role), for which RLS is bypassed by design
  -- and which does its own authorisation. Skip the checks, keep the sync.
  if actor is not null then
    if new.owner_id is distinct from old.owner_id then
      if not (old.owner_id = actor or public.is_super_admin()) then
        raise exception 'Only the owner or a platform super-admin can transfer this business.'
          using errcode = '42501';
      end if;
    end if;

    if not (public.is_business_manager(new.id, actor) or public.is_super_admin()) then
      foreach field in array privileged loop
        if (new.data -> field) is distinct from (old.data -> field) then
          raise exception 'Only the owner or a manager can change %.', field
            using errcode = '42501';
        end if;
      end loop;
    end if;
  end if;

  -- The app reads `business.ownerId` from the document for its owner checks,
  -- while RLS keys on the column. Force the document to follow the column so
  -- the two can never disagree — a client that writes a forged `data.ownerId`
  -- simply has it overwritten with the truth.
  new.data = jsonb_set(new.data, '{ownerId}', to_jsonb(new.owner_id::text), true);

  return new;
end;
$$;

drop trigger if exists businesses_protect_privileged on businesses;
create trigger businesses_protect_privileged
  before update on businesses
  for each row execute function public.protect_business_privileged_fields();

-- Keep the document honest from the moment a listing is created, too.
create or replace function public.sync_business_owner_on_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  new.data = jsonb_set(new.data, '{ownerId}', to_jsonb(new.owner_id::text), true);
  return new;
end;
$$;

drop trigger if exists businesses_sync_owner_insert on businesses;
create trigger businesses_sync_owner_insert
  before insert on businesses
  for each row execute function public.sync_business_owner_on_insert();

-- ---------------------------------------------------------------------------
-- 3. Employees: who may create, delete and re-rank a team member
-- ---------------------------------------------------------------------------
-- Replaces the blanket FOR ALL from 0002/0004.
drop policy if exists employees_write on employees;

-- Adding and removing people is the owner's call (and a super-admin's, who
-- registers businesses with their team on the owner's behalf).
drop policy if exists employees_insert on employees;
create policy employees_insert on employees for insert
  with check (public.is_business_owner(business_id, auth.uid()) or public.is_super_admin());

drop policy if exists employees_delete on employees;
create policy employees_delete on employees for delete
  using (public.is_business_owner(business_id, auth.uid()) or public.is_super_admin());

-- Any member may update a row — that is how a manager grants per-service
-- access on the Access screen. The trigger below is what stops that turning
-- into a promotion.
drop policy if exists employees_update on employees;
create policy employees_update on employees for update
  using (is_business_member(business_id, auth.uid()) or public.is_super_admin())
  with check (is_business_member(business_id, auth.uid()) or public.is_super_admin());

create or replace function public.protect_employee_rank()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  -- Service-role connection (see the businesses trigger) — no JWT, no checks.
  if actor is null then return new; end if;
  if public.is_super_admin() then return new; end if;
  if public.is_business_owner(new.business_id, actor) then return new; end if;

  if coalesce(new.data ->> 'level', 'staff') is distinct from coalesce(old.data ->> 'level', 'staff') then
    raise exception 'Only the owner can change a team member''s level.' using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id
     or (new.data ->> 'userId') is distinct from (old.data ->> 'userId') then
    raise exception 'Only the owner can link a team member to an account.' using errcode = '42501';
  end if;

  if new.business_id is distinct from old.business_id then
    raise exception 'A team member cannot be moved to another business.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_protect_rank on employees;
create trigger employees_protect_rank
  before update on employees
  for each row execute function public.protect_employee_rank();

-- ---------------------------------------------------------------------------
-- 4. Repair any document that already disagrees with its column
-- ---------------------------------------------------------------------------
update public.businesses
   set data = jsonb_set(data, '{ownerId}', to_jsonb(owner_id::text), true)
 where data ->> 'ownerId' is distinct from owner_id::text;

-- ---------------------------------------------------------------------------
-- VERIFY — as a STAFF member of a business you don't own, all of these must fail
-- ---------------------------------------------------------------------------
--   update businesses set owner_id = auth.uid() where id = '<biz>';
--     -> 0 rows, or: Only the owner or a platform super-admin can transfer…
--   update businesses set data = jsonb_set(data,'{ownerId}',to_jsonb(auth.uid()::text))
--    where id = '<biz>';                       -> silently overwritten with the real owner
--   update employees set data = jsonb_set(data,'{level}','"manager"')
--    where id = '<your row>';                  -> Only the owner can change a team member's level.
--   delete from employees where id = '<any>';  -> 0 rows
--
-- And this must still WORK for a manager: updating `permissions` on a teammate's
-- row from Workspace › Access & permissions.
--
-- AFTER RUNNING: no PostgREST reload needed (no new tables or columns).
