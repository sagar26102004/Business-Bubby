-- Localo super-admin — platform operators who can list a business for anyone
-- and hand ownership to another user.
--
-- Identity lives on the profile: `data.isSuperAdmin = true`, mirrored from the
-- fixed phone allow-list in src/domain/superAdmin.ts when the account is
-- provisioned. RLS keys on it through is_super_admin(); the phone fallback keeps
-- the known super-admin numbers privileged even if the flag was never written.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        (p.data ->> 'isSuperAdmin')::boolean
        or regexp_replace(coalesce(p.data ->> 'phone', ''), '\D', '', 'g') in ('8827548423')
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- Businesses: a super-admin may insert a row owned by someone else, and update
-- (including reassigning the owner) any business even without being a member.
drop policy if exists businesses_insert on businesses;
create policy businesses_insert on businesses for insert
  with check (owner_id = auth.uid() or public.is_super_admin());

drop policy if exists businesses_update on businesses;
create policy businesses_update on businesses for update
  using (is_business_member(id, auth.uid()) or public.is_super_admin())
  with check (is_business_member(id, auth.uid()) or public.is_super_admin());

-- Employees written alongside a business a super-admin created (they aren't a
-- member of it) must also be allowed.
drop policy if exists employees_write on employees;
create policy employees_write on employees for all
  using (is_business_member(business_id, auth.uid()) or public.is_super_admin())
  with check (is_business_member(business_id, auth.uid()) or public.is_super_admin());
