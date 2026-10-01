-- Which of a list of storage keys is nothing pointing at any more?
--
-- WHY THIS EXISTS
-- `unreferenced_media_paths` (0019) answers the same question, but it finds the
-- candidates itself by reading `storage.objects` — which only sees the Supabase
-- `media` bucket. Uploads now go to Cloudinary, which Postgres cannot see at
-- all, so the account-deletion sweep went blind the moment that switch flipped:
-- the function would return nothing, report "0 files removed", and a deleted
-- account's photos would live in Cloudinary forever.
--
-- That is not a tidiness problem. `delete-account`'s own header opens with
-- "Google Play refuses any app that lets people create an account but not delete
-- one", and a deletion that silently leaves the person's photos behind is not
-- the deletion they were promised.
--
-- So the candidate list is now passed IN — the edge function gets it from
-- Cloudinary's Admin API — and this function answers only the part that needs
-- the database: is anything still referencing it?
--
-- WHY NOT JUST WIPE THE WHOLE `<uid>/` PREFIX
-- Because a business the person TRANSFERRED on the way out still points at
-- photos they uploaded, and the blocker rules in 0019 actively push people to
-- transfer rather than delete. A blanket prefix wipe would break a living
-- business's listing. Each key is checked against every surviving document
-- first. This is the same reasoning as 0019's section 3, kept deliberately
-- identical so the two sweeps can never disagree.
--
-- WHY `profiles` TOO — AND THE ORDERING THIS DEPENDS ON
-- 0019's version only checks `businesses`, but `profiles.data` carries
-- `avatarUrl` (written by src/app/edit-profile.tsx). Checking it here is both
-- more complete and safe, but ONLY because `anonymize_account` rebuilds the
-- profile document from scratch before the sweep runs, so the avatar reference
-- is already gone by then.
--
-- ⚠️ If the sweep is ever moved BEFORE the scrub, every avatar would look
-- referenced and would be kept forever. The order in delete-account — scrub,
-- then sweep — is load-bearing.
--
-- LIKE treats `_` as a wildcard, so a key containing an underscore can match
-- more loosely than intended — which only ever KEEPS a file. Erring toward
-- keeping is the correct direction, exactly as 0019 argues.
--
-- Idempotent: safe to run more than once.

create or replace function public.media_keys_unreferenced(p_keys text[])
returns setof text
language sql stable security definer set search_path = public as $$
  select k
    from unnest(p_keys) as k
   where not exists (
           select 1 from public.businesses b where b.data::text like '%' || k || '%'
         )
     and not exists (
           select 1 from public.profiles p where p.data::text like '%' || k || '%'
         );
$$;

-- ---------------------------------------------------------------------------
-- Only the server may call this
-- ---------------------------------------------------------------------------
-- It takes an arbitrary key list and reports which are unused, which leaks the
-- shape of other people's documents by probing. Reachable only with the service
-- role, i.e. only from the delete-account edge function, which proves identity
-- from the caller's JWT first — the same lock 0019 puts on its three functions.
revoke all on function public.media_keys_unreferenced(text[]) from public, anon, authenticated;
grant execute on function public.media_keys_unreferenced(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   -- 1. A key nothing references comes back; a referenced one does not.
--   select public.media_keys_unreferenced(array['definitely-not-in-any-document']);
--     -- → one row, the key itself
--
--   -- 2. Pick a real stored URL and confirm its key is withheld:
--   select data->>'coverImageUrl' from businesses where data ? 'coverImageUrl' limit 1;
--   select public.media_keys_unreferenced(array['<the <uid>/<ts>-<rand> part of it>']);
--     -- → zero rows
--
--   -- 3. The grant is server-only (must be false for anon/authenticated):
--   select has_function_privilege('anon',
--            'public.media_keys_unreferenced(text[])', 'execute');
