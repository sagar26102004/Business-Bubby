-- Localo — expose the database's clock so elapsed time never depends on a
-- device's clock.
--
-- THE BUG THIS FIXES
-- The voice-call ring timeout was judged client-side: the caller stamped
-- `startedAt` with ITS clock, and every business member's poll compared that
-- against ITS OWN `Date.now()`. Those are different machines. A phone running
-- ~39 seconds fast therefore computed "this call has been ringing for 39s"
-- the instant it saw a brand-new call, marked it `missed`, and wrote that back
-- for everyone — so the caller got "No answer" within two seconds and the phone
-- never rang at all (the sweep beat the ringing check). Phone clocks drift and
-- we do not control them, so the decision cannot rest on one.
--
-- THE FIX
-- Clients read the server's time once every few minutes, keep the offset, and
-- measure elapsed time against the SERVER's clock (see src/data/supabase/
-- shared.ts → syncServerClock/serverNow). Call age is taken from the row's
-- server-assigned `created_at`, not from anything a device wrote.
--
-- Why a function: the app can also read the HTTP `Date` header, but browsers
-- only expose CORS-safelisted response headers and `Date` is not one — so that
-- path works on native only. This RPC works on both, and is the preferred
-- source. Without it the app still runs; it just falls back to the header (and
-- then to the local clock), which is exactly the old behaviour.
--
-- Safe by construction: no arguments, no table access, returns a single
-- timestamp. It reveals nothing that the `Date` header on every response
-- doesn't already.
--
-- Idempotent: safe to run more than once.

create or replace function public.server_now()
returns timestamptz
language sql
stable
-- Not SECURITY DEFINER: it touches nothing that RLS protects.
set search_path = pg_catalog
as $$
  select now();
$$;

comment on function public.server_now() is
  'Server clock, for clients that must measure elapsed time without trusting the device clock (voice-call ring timeout).';

grant execute on function public.server_now() to anon, authenticated;
