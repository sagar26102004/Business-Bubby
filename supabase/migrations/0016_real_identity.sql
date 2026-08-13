-- Localo — real identity: an account is a REAL email and/or a phone number.
--
-- WHAT CHANGES
-- Until now every account's login address was MANUFACTURED from its phone
-- number (`phoneToEmail` → `<digits>@localo.app`). That had three costs:
--   * nothing was ever verified — anyone could register a number they did not
--     own, because the address it produced has no inbox to confirm;
--   * "Confirm email" therefore had to stay OFF for the project;
--   * the synthetic address leaked into `profiles_private.data.email` and was
--     shown back to the user as if it were their email address.
-- From here an account may carry a real email, a phone number, or both — at
-- least one, never neither.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS TO EXISTING ACCOUNTS  (decision: LEAVE THEM ALONGSIDE)
-- ---------------------------------------------------------------------------
-- Nothing in `auth.users` is rewritten. The ten seeded test accounts
-- (9812340001–10) and the super-admin (8827548423) keep the synthetic
-- `<digits>@localo.app` address they were created with, keep their password,
-- and keep signing in by typing their phone number exactly as they do today.
--
-- That works because the app still tries the synthetic alias FIRST for a typed
-- phone number (`src/data/supabase/shared.ts` → `phoneToEmail`), which needs no
-- lookup at all. The alias is now a LEGACY-BUT-LIVE scheme: still minted for a
-- new phone-only sign-up (there is no other way to give such an account a
-- credential address without a paid SMS provider — see P08), never shown to a
-- user, and never treated as their email address.
--
-- Super-admin status is unaffected: migration 0006 moved it to the
-- `platform_admins` table keyed by uuid, and the phone match there was a
-- one-time backfill.
--
-- Requires 0007_profiles_private.sql. Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Find an account by phone, quickly
-- ---------------------------------------------------------------------------
-- Phones are stored as the user typed them ("+91 98765 43210"), so every
-- comparison is on the digits. An expression index makes that exact-match
-- lookup a seek rather than a scan of every profile.
create index if not exists profiles_private_phone_digits_idx
  on public.profiles_private ((regexp_replace(coalesce(data ->> 'phone', ''), '\D', '', 'g')));

-- ---------------------------------------------------------------------------
-- 2. Resolve a phone number to the account's login address
-- ---------------------------------------------------------------------------
-- ⚠️ READ THIS BEFORE CHANGING THE SIGNATURE.
--
-- Sign-in has to turn what the user typed into the address GoTrue knows. For a
-- phone-first account that is pure arithmetic (the synthetic alias) and needs
-- no database at all. This function exists for the OTHER case: an account whose
-- login address is a real email, which also carries a phone number, whose owner
-- types that phone number into the sign-in box.
--
-- WHY IT TAKES THE PASSWORD.
-- The obvious version — `phone -> email` — is two separate disclosures, and
-- both are worse than they look:
--   * an ENUMERATION ORACLE: ask it about a number and learn whether that
--     number has an account here;
--   * a PII LEAK: anyone holding a phone number learns the real email address
--     behind it, which is a phishing and credential-stuffing kit, and is
--     precisely what `profiles_private` was split out in 0007 to prevent.
-- So the address is handed back only to a caller who has ALREADY proved they
-- can sign in — the password is verified here, against the same bcrypt hash
-- GoTrue itself checks. A caller who knows the password learns nothing they
-- were not about to learn anyway by signing in.
--
-- Every failure returns NULL and looks identical from outside: unknown number,
-- known number with the wrong password, malformed input, deleted account. There
-- is nothing to distinguish and therefore nothing to harvest.
--
-- COUPLING, AND WHY IT IS SAFE HERE.
-- Reading `auth.users.encrypted_password` couples this to GoTrue's storage. If
-- that ever changes, this returns NULL — and the app degrades to exactly the
-- behaviour it has today (the synthetic alias is tried first and succeeds for
-- every phone-first account), so a break costs the new email-primary-plus-phone
-- case and nothing else. See the layered fallback in supabase/auth.ts.
create or replace function public.resolve_login_email(p_phone text, p_password text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_digits text;
  v_email  text;
  v_hash   text;
  v_count  integer;
begin
  if p_phone is null or p_password is null or p_password = '' then
    return null;
  end if;

  v_digits := regexp_replace(p_phone, '\D', '', 'g');
  -- A short string would match far too broadly to be a phone number; refusing
  -- it also keeps anyone from sweeping the table with tiny prefixes.
  if length(v_digits) < 8 then
    return null;
  end if;

  -- Two accounts claiming one number is a data fault, not a login: refuse
  -- rather than guess which one the caller meant. Counted separately because
  -- `select … into` quietly keeps the FIRST row and discards the rest, which
  -- would turn that fault into signing somebody in as the wrong person.
  select count(*)
    into v_count
    from public.profiles_private pp
   where regexp_replace(coalesce(pp.data ->> 'phone', ''), '\D', '', 'g') = v_digits;

  if v_count <> 1 then
    return null;
  end if;

  -- The phone lives in profiles_private, which is exactly the table RLS hides
  -- from everyone but its owner — SECURITY DEFINER is how sign-in reaches it
  -- without opening that table up.
  select u.email, u.encrypted_password
    into v_email, v_hash
    from public.profiles_private pp
    join auth.users u on u.id = pp.id
   where regexp_replace(coalesce(pp.data ->> 'phone', ''), '\D', '', 'g') = v_digits;

  if v_email is null or v_hash is null then
    return null;
  end if;

  -- The same check GoTrue performs. `crypt` re-hashes the candidate with the
  -- stored salt, so this is a constant-shape comparison, not a string match.
  if crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;

  return null;
end;
$$;

-- Callable while signed OUT — that is the whole point — but never by a
-- privileged role by accident, and never enumerable in bulk.
revoke all on function public.resolve_login_email(text, text) from public;
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sign-up writes the new metadata shape
-- ---------------------------------------------------------------------------
-- `raw_user_meta_data` now carries `name`, and `phone` and/or `email` — the
-- values the PERSON gave us. The critical difference from 0007: the private
-- profile records the REAL email only. `new.email` is the credential address,
-- which for a phone-only sign-up is the synthetic alias, and storing that was
-- how `9812340001@localo.app` ended up displayed as somebody's email address.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  -- Prefer what they typed; fall back to the credential address only when it is
  -- a real one (i.e. not the synthetic alias).
  v_email := coalesce(
    nullif(new.raw_user_meta_data ->> 'email', ''),
    case when new.email is not null and new.email not like '%@localo.app'
         then new.email end
  );

  -- Public directory card — no contact details, ever (0007).
  insert into public.profiles (id, data)
  values (new.id, jsonb_build_object(
    'id', new.id,
    'name', coalesce(new.raw_user_meta_data ->> 'name', ''),
    'isProfilePublic', true
  ))
  on conflict (id) do nothing;

  -- Private contact details.
  insert into public.profiles_private (id, data)
  values (new.id, jsonb_strip_nulls(jsonb_build_object(
    'phone', nullif(new.raw_user_meta_data ->> 'phone', ''),
    'email', v_email
  )))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retire the synthetic addresses that were recorded as real ones
-- ---------------------------------------------------------------------------
-- 0007 copied `new.email` into the private profile, so every phone-first
-- account carries `<digits>@localo.app` as its "email". It is not an address
-- anyone can write to, and the account screen renders it. Drop the key; the
-- credential address in auth.users is untouched, so sign-in is unaffected.
update public.profiles_private
   set data = data - 'email'
 where data ->> 'email' like '%@localo.app';

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   -- no synthetic address is stored as a contact email any more (0 rows):
--   select id from profiles_private where data ->> 'email' like '%@localo.app';
--
--   -- a seeded account still resolves by phone with the right password:
--   select public.resolve_login_email('9812340001', '<seed password>') is not null;
--
--   -- and gives nothing away with the wrong one, or for a number nobody owns:
--   select public.resolve_login_email('9812340001', 'wrong')     is null;  -- true
--   select public.resolve_login_email('9999999999', 'anything')  is null;  -- true
--
-- AFTER RUNNING: PostgREST caches the schema. If the RPC 404s for a few
-- seconds, force a reload with:  notify pgrst, 'reload schema';
