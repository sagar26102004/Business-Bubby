-- Localo — one account, one signed-in device.
--
-- THE RULE
-- An account may be signed in on exactly ONE device at a time. Signing in
-- somewhere else takes the account with you: the previous handset is signed
-- out and told why. Last sign-in wins, deliberately — refusing the NEW device
-- instead would lock a person out of their own account the moment they lose a
-- phone, and there is no support desk to unstick them.
--
-- WHY THIS TABLE EXISTS AT ALL
-- Supabase can enforce this itself ("Single session per user", Auth settings),
-- but only on Pro plans and up, and only "at intervals of the JWT expiration
-- time" — up to an hour of two devices being live. So the app enforces it, in
-- two layers that cover each other:
--
--   1. SERVER, on sign-in: `signOut({ scope: 'others' })` destroys every other
--      session's refresh token. That is the real revocation — the old device
--      can never mint another token. But its CURRENT access token stays valid
--      until it expires (Supabase says so plainly), so on its own this leaves
--      the old phone working for up to an hour.
--
--   2. THIS TABLE, polled by the app: the row says which device holds the
--      account right now. A device that reads a `device_id` that is not its
--      own signs itself out within a minute, with a sentence explaining what
--      happened instead of a silent expiry an hour later.
--
-- Neither layer is decoration. Without (1) a modified client could keep
-- refreshing forever; without (2) the honest client keeps working for an hour.
--
-- WHY THE PRIMARY KEY IS `user_id`
-- One row per account IS the rule, expressed where it cannot be forgotten. The
-- claim is an upsert on that key, so "this device now holds the account" is a
-- single statement with no read-then-write to lose a race on: two phones
-- signing in at the same instant serialise, and the loser is simply the one
-- that got there first.
--
-- `device_id` is a random uuid minted once per install (see src/lib/device.ts),
-- not a hardware id — we never ask for one, and Android/iOS would not give an
-- app a stable one anyway. Clearing app storage therefore reads as a new
-- device, which is the honest answer: that install can no longer prove it was
-- the one holding the account.
--
-- RLS: an account can only see and move its OWN claim. Unlike `push_tokens`
-- (see 0013), the conflicting row here always belongs to the SAME user, so the
-- upsert's SELECT check passes and no SECURITY DEFINER trigger is needed.
--
-- Idempotent: safe to run more than once.

create table if not exists active_devices (
  -- One row per account. The primary key IS the "only one device" rule.
  user_id    uuid primary key references profiles (id) on delete cascade,
  -- The install-scoped uuid from src/lib/device.ts.
  device_id  text not null,
  -- "Android phone", "Web browser" — for the message shown to the device that
  -- gets signed out, and for diagnostics. Never a hardware identifier.
  label      text,
  claimed_at timestamptz not null default now()
);

alter table active_devices enable row level security;

drop policy if exists active_devices_select on active_devices;
drop policy if exists active_devices_insert on active_devices;
drop policy if exists active_devices_update on active_devices;
drop policy if exists active_devices_delete on active_devices;

-- Reading your own claim is how a device learns it has been displaced. Reading
-- anyone else's would say which of their devices they are holding right now.
create policy active_devices_select on active_devices for select
  using (user_id = auth.uid());

-- Claiming the account for this device.
create policy active_devices_insert on active_devices for insert
  with check (user_id = auth.uid());

-- Taking it over from your OWN previous device (the upsert's conflict arm).
create policy active_devices_update on active_devices for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Releasing it on sign-out. The client additionally matches on `device_id`, so
-- a device that has already been displaced cannot delete its successor's claim
-- on the way out.
create policy active_devices_delete on active_devices for delete
  using (user_id = auth.uid());
