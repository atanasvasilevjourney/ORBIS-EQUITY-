-- ============================================================================
-- Migration 018: Carver DCA rungs on ROTATE (isolated from the PERPS book)
-- Bigger-trend EWMAC unlocks D1–D4 partials; they rotate into the leading
-- sub-sector / names. Paper diagnostic — not a live book.
-- ============================================================================

ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS n_carver SMALLINT;
ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS carver_rungs SMALLINT;

CREATE TABLE IF NOT EXISTS sector_rotation_carver (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES sector_rotation_runs(run_id),
    sector              TEXT,
    industry            TEXT,
    forecast            REAL,
    parent_forecast     REAL,
    sleeve_forecast     REAL,
    xs_score            REAL,
    xs_rank             SMALLINT,
    sleeve_rank         SMALLINT,
    unlocked            SMALLINT,
    rungs               SMALLINT,
    weight              REAL,
    notional            REAL,
    side                TEXT,
    action              TEXT,
    aligned             BOOLEAN,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_src_carver_run ON sector_rotation_carver (run_id);
CREATE INDEX IF NOT EXISTS idx_src_carver_action ON sector_rotation_carver (action);

ALTER TABLE sector_rotation_carver ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON sector_rotation_carver FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON sector_rotation_carver FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
