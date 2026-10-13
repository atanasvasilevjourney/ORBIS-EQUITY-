-- After running migrations/023_rls_lockdown.sql (or scripts/fix_rls_disabled_in_public.sql),
-- this should return zero rows. Any row is a table still exposed via PostgREST without RLS.
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT IN ('spatial_ref_sys')
  AND NOT c.relrowsecurity
ORDER BY 1;
