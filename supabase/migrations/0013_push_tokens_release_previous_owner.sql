-- Localo — let a handset change hands, without letting anyone read the room.
--
-- WHAT WAS ACTUALLY WRONG (0012 fixed the wrong policy)
-- Registering a device upserts into `push_tokens` keyed by the token. When the
-- handset was last signed into a DIFFERENT account, that upsert takes the
-- ON CONFLICT arm and dies with:
--
--   new row violates row-level security policy (USING expression)
--   for table "push_tokens"   [42501]
--
-- The obvious reading of that message is "the UPDATE policy's USING refused
-- it", so 0012 made that clause permissive. It changed nothing, because the
-- check doing the refusing is a different one. From the CREATE POLICY docs,
-- table 297 — for ON CONFLICT DO UPDATE, THREE checks run:
--
--   SELECT  USING       -> against the existing row AND the new row
--   UPDATE  USING       -> against the existing row
--   UPDATE  WITH CHECK  -> against the new row
--
-- ...and all three raise the same "(USING expression)" wording. The one that
-- fails here is the FIRST: you must be able to SEE the row you are about to
-- conflict with. `push_tokens_select` is `user_id = auth.uid()`, so the new
-- owner cannot see the previous owner's row, and the upsert is refused before
-- the UPDATE policy is ever consulted.
--
-- WHY NOT JUST RELAX THE SELECT POLICY
-- Because that is the one policy on this table genuinely holding a line. A push
-- token is a routable address for a specific handset; anyone able to read other
-- people's could push notifications straight to those devices. Widening SELECT
-- to make an upsert convenient would trade a real protection for a syntax
-- problem.
--
-- THE FIX: REMOVE THE CONFLICT INSTEAD OF PERMITTING IT
-- A BEFORE INSERT trigger releases any OTHER account's claim on the token
-- first, so the insert lands on an empty slot and the ON CONFLICT path — with
-- its SELECT check on a row we are not allowed to see — never runs at all.
-- Re-registering your OWN token still conflicts, still takes the UPDATE path,
-- and still passes every check, because you can see your own row.
--
-- SECURITY DEFINER is what makes it possible: the trigger has to delete a row
-- that the calling user, by design, cannot even see. `search_path` is pinned so
-- the elevated function can't be redirected at some other `push_tokens` by a
-- caller-controlled search path.
--
-- The capability this grants is precisely the intended one: whoever holds a
-- device's token may claim that device. A token is known only to the handset
-- that minted it and the account it last registered under, so in practice this
-- is "the phone in your hand rings for the account signed into it" — and the
-- previous owner losing the ring is the entire point, not a side effect.
--
-- Idempotent: safe to run more than once.

create or replace function public.push_tokens_release_previous_owner()
returns trigger
language plpgsql
security definer
-- pg_temp last is the standard hardening for a definer function: it stops a
-- caller pre-creating a same-named object in their temp schema and having this
-- elevated code resolve to it.
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- Only ever the OTHER owner's claim. Deliberately not `= new.user_id`, so
  -- re-registering your own device keeps its row (and its created_at) instead
  -- of churning through a delete/insert on every app launch.
  delete from public.push_tokens
  where token = new.token
    and user_id <> new.user_id;

  return new;
end
$$;

comment on function public.push_tokens_release_previous_owner() is
  'Releases another account''s claim on a push token before insert, so a handset '
  'can change hands. Needed because ON CONFLICT DO UPDATE checks the SELECT '
  'policy against the existing row, which the new owner cannot see.';

drop trigger if exists push_tokens_release_previous_owner on public.push_tokens;

create trigger push_tokens_release_previous_owner
  before insert on public.push_tokens
  for each row
  execute function public.push_tokens_release_previous_owner();
