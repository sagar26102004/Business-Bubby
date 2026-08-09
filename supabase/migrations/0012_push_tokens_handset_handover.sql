-- Localo — let a handset change hands without going deaf.
--
-- THE BUG THIS FIXES
-- Registering a device is an UPSERT on `push_tokens`, keyed by the token. When
-- the same phone is signed into a SECOND account, that upsert hits ON CONFLICT
-- and takes the UPDATE arm — against a row still owned by the PREVIOUS user. A
-- restrictive `using` clause on the UPDATE policy refuses that, with:
--
--   new row violates row-level security policy (USING expression)
--   for table "push_tokens"  [42501]
--
-- The app swallowed the error (registration is best-effort, so a push problem
-- can never break the app), so the phone simply never registered and was never
-- rung — while its own diagnostics happily reported a valid push token, because
-- minting one is a device-side act that has nothing to do with the server.
--
-- It is invisible in every other way: the FIRST account to sign in on a handset
-- works perfectly, and only the second one onwards is silently deaf. On a
-- developer's test phone, where accounts are swapped constantly, that means
-- almost always broken.
--
-- WHY `using (true)` IS THE RIGHT ANSWER AND IS NOT A HOLE
-- `using` is checked against the row as it EXISTS; `with check` against the row
-- as it WILL BE. Being permissive on the former is the whole point — the old
-- row belongs to whoever had the phone before, and we are taking it from them
-- deliberately. `with check (user_id = auth.uid())` still pins the result to
-- the caller, so a token can only ever be reassigned TO YOURSELF: there is no
-- way to point someone else's device at a third party, or to read what it was.
--
-- The capability granted is "if you know a device's push token, you may take
-- over ringing it" — and the only party that knows a token is the device that
-- minted it and the account it last registered under. Losing your own calls
-- when you hand your phone to someone else is the intended behaviour, not a
-- leak; the alternative is the previous owner keeping the ring forever.
--
-- ⚠️ WHY THIS DROPS POLICIES BY LOOKUP RATHER THAN BY NAME
-- The first attempt at this migration said `drop policy if exists
-- push_tokens_update`, which did NOTHING on the live database and failed
-- silently — because the policy there was created under a different name (a
-- dashboard-authored policy, or an earlier draft of 0011). `if exists` turns a
-- name mismatch into a no-op, so the old restrictive policy survived, the new
-- one was added alongside it, and the upsert kept failing exactly as before.
--
-- A leftover RESTRICTIVE policy would be worse still: permissive policies are
-- OR-ed together, so adding a permissive one is normally enough, but a single
-- restrictive policy is AND-ed and silently vetoes everything.
--
-- So: enumerate whatever is actually on the table and drop all of it, then
-- state the four policies outright. That is independent of what anyone named
-- them, and it is the only version that converges no matter which draft the
-- database was built from.
--
-- Idempotent: safe to run more than once.

do $$
declare
  existing record;
begin
  for existing in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'push_tokens'
  loop
    execute format('drop policy %I on public.push_tokens', existing.policyname);
  end loop;
end
$$;

alter table public.push_tokens enable row level security;

-- You may only SEE your own device addresses: a push token is a routable
-- address for a specific handset, and enumerating other people's would let you
-- push to them directly.
create policy push_tokens_select on public.push_tokens for select
  using (user_id = auth.uid());

-- Claiming a device for yourself.
create policy push_tokens_insert on public.push_tokens for insert
  with check (user_id = auth.uid());

-- Taking a device over from whoever used it last. See the long note above for
-- why `using` must be permissive here and why that is safe.
create policy push_tokens_update on public.push_tokens for update
  using (true) with check (user_id = auth.uid());

-- Releasing your own device, on sign-out.
create policy push_tokens_delete on public.push_tokens for delete
  using (user_id = auth.uid());
