-- ============================================================================
-- Migration 024: unified pipeline run ledger (Phase 1 reliability)
-- Atomic run rows for ingest + compute modules (observability + /status page).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id          TEXT        PRIMARY KEY,
    source          TEXT        NOT NULL,
    status          TEXT        NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
    row_counts      JSONB,
    asof_date       DATE,
    started_at      TIMESTAMPTZ NOT NULL,
    finished_at     TIMESTAMPTZ,
    headline        TEXT,
    error           TEXT,
    config          JSONB
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_source_started
    ON pipeline_runs (source, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_asof
    ON pipeline_runs (asof_date DESC);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON pipeline_runs FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON pipeline_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
