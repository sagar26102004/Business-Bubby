-- Localo — why won't this phone register for calls?
--
-- READ-ONLY. Changes nothing; safe to run any number of times, on any project.
--
-- ⚠️ ONE STATEMENT ON PURPOSE. The Supabase SQL Editor returns only the LAST
-- result set of a multi-statement script, so a file of five tidy queries shows
-- you the answer to the fifth and silently throws away the other four — which
-- is exactly how the important one (the policies) got lost the first time.
-- Everything is therefore folded into a single row of JSON.
--
-- THE SYMPTOM THIS EXPLAINS
-- Registering a device upserts into `push_tokens`. When the handset has been
-- signed into a previous account, that upsert takes the ON CONFLICT arm and
-- fails with:
--
--   new row violates row-level security policy (USING expression)
--   for table "push_tokens"   [42501]
--
-- The app swallows it (registration is best-effort), so the phone silently
-- never registers, `call-ring` reports "no registered devices", and the phone
-- never rings for a closed app — while the phone's own call-alerts check still
-- shows a valid push token, because minting one is a device-side act that never
-- touches the server.
--
-- WHY THE OBVIOUS FIX CAN APPEAR TO DO NOTHING
-- `(USING expression)` is emitted by exactly one thing in PostgreSQL — the
-- ON CONFLICT DO UPDATE check, which evaluates the UPDATE policy's `using`
-- against the EXISTING row. `using (true)` cannot fail it. So if migration 0012
-- has been applied and the error persists, the policy being enforced is not the
-- one that was just written, and the question stops being "what should the
-- policy say" and becomes "which table did the DDL actually reach".
--
-- WHAT TO LOOK FOR IN THE RESULT
--   policies -> the row with "cmd": "UPDATE" should read "using": "true".
--     • still shows (user_id = auth.uid())  -> the DDL never reached this table;
--       check "database" and "tables" in the same output.
--     • TWO rows with "cmd": "UPDATE"       -> an older policy survived under a
--       different name. Permissive policies are OR-ed, so this alone should
--       still pass — unless one of them is restrictive:
--     • any "permissive": "RESTRICTIVE"     -> restrictive policies are AND-ed
--       and silently veto everything however permissive the others are. This is
--       the only case that makes `using (true)` fail, and the only one that
--       looks impossible from outside the database.
--   tables   -> expect exactly ONE, in schema "public". A second copy elsewhere
--               would absorb every policy change while PostgREST kept writing
--               to the first.
--   rows     -> runs privileged, so it bypasses RLS and shows every device,
--               including the ones the app can never see. A token whose user_id
--               is NOT the account you sign in as on the handset is the row the
--               failing upsert is colliding with.

select jsonb_pretty(jsonb_build_object(

  'database', jsonb_build_object(
    'name', current_database(),
    'running_as', current_user,
    'server_ip', host(coalesce(inet_server_addr(), '0.0.0.0'::inet))
  ),

  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'rls_enabled', rowsecurity
    ) order by schemaname)
    from pg_tables where tablename = 'push_tokens'
  ), '[]'::jsonb),

  'rls_forced', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity
    ))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'push_tokens'
  ), '[]'::jsonb),

  -- THE ONE THAT MATTERS.
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'policy', policyname,
      'permissive', permissive,
      'cmd', cmd,
      'roles', roles::text,
      'using', coalesce(qual, '(none)'),
      'with_check', coalesce(with_check, '(none)')
    ) order by cmd, policyname)
    from pg_policies where tablename = 'push_tokens'
  ), '[]'::jsonb),

  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', user_id,
      'platform', platform,
      'updated_at', updated_at,
      'token', left(token, 30) || '…'
    ) order by updated_at desc)
    from push_tokens
  ), '[]'::jsonb)

)) as diagnosis;
