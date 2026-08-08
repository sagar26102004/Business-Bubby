-- Grant / revoke / audit the Localo platform super-admin role.
--
-- The grant lives in `platform_admins` (migrations/0006_platform_admins.sql).
-- That table has RLS on and NO insert, update or delete policy, so a signed-in
-- session can only ever read its OWN row — handing out the role requires the
-- service role, i.e. this SQL editor. That is the whole point: the previous
-- design kept the flag in `profiles.data`, which every user can rewrite, so
-- anyone could promote themselves with a single PATCH.
--
-- Run whichever block you need. Nothing here touches passwords.

-- ── Who holds it right now? ────────────────────────────────────────────────
select a.granted_at, a.note, u.email, p.data ->> 'name' as name
  from public.platform_admins a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
 order by a.granted_at;

-- ── Grant (by the phone the account signed up with) ────────────────────────
-- The account must already exist — have them sign up in the app first.
--
-- insert into public.platform_admins (user_id, note)
-- select id, 'Sagar — founder'
--   from auth.users
--  where email = '8827548423@localo.app'
-- on conflict (user_id) do nothing;

-- ── Revoke ─────────────────────────────────────────────────────────────────
-- delete from public.platform_admins
--  where user_id = (select id from auth.users where email = '8827548423@localo.app');

-- ── Sanity check: nobody should carry a stored isSuperAdmin flag ───────────
-- 0006 strips it and a trigger keeps it out. This should return zero rows; if
-- it doesn't, 0006 has not been applied to this project.
select id, data ->> 'name' as name
  from public.profiles
 where data ? 'isSuperAdmin';
