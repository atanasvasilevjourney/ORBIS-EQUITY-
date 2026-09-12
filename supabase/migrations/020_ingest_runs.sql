-- ============================================================================
-- Migration 020: ingest run log (cash EOD / nightly observability)
-- QMIE writes a SQLite signal journal. We keep a thin Postgres run row
-- so the cash Yahoo/Stooq ingest is inspectable without vendoring QMIE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_runs (
    run_id          TEXT        PRIMARY KEY,
    module          TEXT        NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    finished_at     TIMESTAMPTZ,
    asof_date       DATE,
    symbols_ok      INTEGER,
    symbols_fail    INTEGER,
    rows_upserted   INTEGER,
    source          TEXT,
    headline        TEXT,
    config          JSONB
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_module_started
    ON ingest_runs (module, started_at DESC);

ALTER TABLE ingest_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON ingest_runs FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ingest_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
