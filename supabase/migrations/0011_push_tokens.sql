-- Localo — device push tokens, so a CLOSED app can still be told a call is
-- ringing.
--
-- THE PROBLEM
-- Incoming calls are discovered by polling (`getIncomingForUser` every 2s from
-- IncomingCallGate). A poll only runs while the app is open, so a business
-- owner who swiped Localo away never learns anyone is calling — the call just
-- rings out and lands in the missed log. No amount of client work fixes that:
-- the app is not running.
--
-- THE MODEL
-- Every signed-in device registers its Expo push token here. When a call
-- starts, the `call-ring` edge function looks up the ring targets' tokens and
-- pushes to them, which wakes the phone (Android delivers a high-priority
-- message even to a stopped app). The push is only the DOORBELL — the call
-- audio still runs over LiveKit exactly as it does today.
--
-- One row PER DEVICE: `token` is the primary key, so a user signed in on a
-- phone and a tablet rings on both, and re-registering an existing token
-- reassigns it rather than duplicating. That reassignment matters — when one
-- person signs out and another signs in on the same handset, the token must
-- follow the new user or the phone would ring for calls that aren't theirs.
--
-- RLS: you may only see and touch YOUR OWN tokens. A push token is a routable
-- address for a specific device; letting one user enumerate another's would let
-- them spam that device directly. The sender is the edge function, which reads
-- with the service role and so is not bound by these policies.
--
-- Idempotent: safe to run more than once.

create table if not exists push_tokens (
  -- The Expo push token ("ExponentPushToken[...]"). Identity of a device+install.
  token      text primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  -- 'android' | 'ios' | 'web' — kept for diagnostics and per-platform payloads.
  platform   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

-- Recreate policies so re-running the migration is safe.
drop policy if exists push_tokens_select on push_tokens;
drop policy if exists push_tokens_insert on push_tokens;
drop policy if exists push_tokens_update on push_tokens;
drop policy if exists push_tokens_delete on push_tokens;

create policy push_tokens_select on push_tokens for select
  using (user_id = auth.uid());
-- INSERT and UPDATE are both needed: registering is an upsert, and the UPDATE
-- arm is what lets a handset change hands between accounts. `using` here is
-- deliberately permissive on the OLD row (the token may currently belong to the
-- previous user) while `with check` pins the NEW row to the caller.
create policy push_tokens_insert on push_tokens for insert
  with check (user_id = auth.uid());
create policy push_tokens_update on push_tokens for update
  using (true) with check (user_id = auth.uid());
create policy push_tokens_delete on push_tokens for delete
  using (user_id = auth.uid());
