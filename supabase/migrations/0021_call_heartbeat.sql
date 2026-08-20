-- Localo — server-stamped liveness for voice-call participants.
--
-- THE BUG THIS FIXES
-- Leaving a call was only ever a MESSAGE the leaving device sent. A device that
-- died mid-call — the OS reclaiming memory, a force-stop from Recents, a flat
-- battery, a tunnel — sent nothing at all. Its participant row stayed `joined`
-- for ever, so the other side kept looking at "On call" with no audio, and the
-- row itself never reached `ended`: it sat `active` in the database until the
-- end of time, polluting the workspace call log with calls that were over.
--
-- THE FIX
-- Being on a call is a LEASE, not a fact. While a participant is joined their
-- client renews it every few seconds through this function; the lazy sweep on
-- read (src/data/supabase/calls.ts → sweepOne) marks anyone whose lease has
-- expired as `left` and then applies the ordinary end-of-call rules — the
-- customer dropping ends the call, the last business member dropping ends it.
-- Nobody has to be watching for that to happen: whoever is still polling does
-- the work, and if nobody is, the next person to open the call log does it.
--
-- WHY A FUNCTION RATHER THAN AN UPDATE FROM THE CLIENT
-- Two reasons, both of which have already burned this feature once:
--
--  1. THE CLOCK. `aliveAt` is compared against the server's clock, so it must be
--     WRITTEN by the server's clock. Migration 0010 exists because a phone
--     running 39 seconds fast expired every incoming call the instant it saw
--     one; a lease timestamped by that same phone would fail the same way, and
--     this time it would hang up live calls. now() here is the only clock in
--     play.
--  2. LOST UPDATES. Participants write the whole `data` document. Two people on
--     a call heartbeating a few hundred milliseconds apart would each write back
--     a copy read before the other's write, silently reverting it. This touches
--     ONE key at ONE array index and nothing else, so concurrent heartbeats
--     compose instead of clobbering.
--
-- SECURITY INVOKER on purpose: the caller's own RLS still decides whether they
-- may read and update this call (calls_update in 0002_policies.sql — the
-- customer or a business member). This grants nobody anything new; it only
-- makes the write precise. A caller who is not on the call updates no rows.
--
-- Idempotent: safe to run more than once.

create or replace function public.call_heartbeat(
  p_call_id uuid,
  p_participant_id text
)
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := now();
  v_index int;
  v_updated int;
begin
  -- Which slot in the participants array is this person? Ordinality is 1-based
  -- and jsonb paths are 0-based, hence the -1.
  select ord - 1
    into v_index
    from calls c
    cross join lateral jsonb_array_elements(c.data -> 'participants')
      with ordinality as t(participant, ord)
   where c.id = p_call_id
     and t.participant ->> 'id' = p_participant_id
   limit 1;

  if v_index is null then
    -- Not a participant, or the call is not visible to this caller. Same answer
    -- either way, deliberately: the client treats null as "nothing to renew".
    return null;
  end if;

  update calls
     set data = jsonb_set(
           data,
           array['participants', v_index::text, 'aliveAt'],
           -- ISO-8601 in UTC, which is what every date in `data` already is and
           -- what `new Date(...)` on the client parses without ambiguity.
           to_jsonb(to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         )
   where id = p_call_id
     -- Only a LIVE call has a lease worth renewing. Without this, a client that
     -- keeps beating after the call ended would go on writing to a finished row
     -- — and, worse, could revive a participant the sweep had just marked left.
     and data ->> 'status' in ('ringing', 'active')
     -- Only a JOINED participant. Someone still ringing has not claimed a seat,
     -- and someone who left or declined must not be able to un-leave by
     -- heartbeating.
     and data -> 'participants' -> v_index ->> 'state' = 'joined';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return null;
  end if;

  return v_now;
end;
$$;

comment on function public.call_heartbeat(uuid, text) is
  'Renew a joined voice-call participant''s liveness lease, stamped with the server clock. Returns null when there was nothing to renew. See src/data/supabase/calls.ts.';

grant execute on function public.call_heartbeat(uuid, text) to anon, authenticated;
