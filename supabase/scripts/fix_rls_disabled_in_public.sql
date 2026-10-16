-- ============================================================================
-- Supabase security alert: rls_disabled_in_public
--
-- Run this entire file in Dashboard → SQL → New query (project izekfemxwqirsjvmrtyc).
-- Git deploy and Vercel do NOT apply this — only the SQL editor or Supabase CLI does.
--
-- After success, run scripts/verify_rls.sql (expect zero rows).
-- Canonical copy: supabase/migrations/023_rls_lockdown.sql
-- ============================================================================

-- 1. Enable RLS on every ordinary / partitioned table in public
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('spatial_ref_sys')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- 2. Paper terminal is a public read surface. Writes stay off for anon.
--    service_role bypasses RLS; no write policy for anon/authenticated.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('spatial_ref_sys')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_read ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE POLICY anon_read ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      r.tablename
    );
    EXECUTE format('DROP POLICY IF EXISTS service_all ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE POLICY service_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      r.tablename
    );
  END LOOP;
END $$;

-- 3. Defense in depth: even if RLS is later disabled, anon cannot mutate.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 4. Future CREATE TABLE in public stays read-only for PostgREST roles.
DO $$
DECLARE
  creator text;
BEGIN
  FOREACH creator IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = creator) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated',
        creator
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated',
        creator
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
