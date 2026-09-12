-- ============================================================================
-- Migration 016: macro canaries + TEMA-MACD ensemble triggers on ROTATE
-- Canary votes drive regime. TEMA ensemble is reviewed inside aligned groups.
-- ============================================================================

ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS canary_score SMALLINT;
ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS canary_on SMALLINT;
ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS canary_off SMALLINT;
ALTER TABLE sector_rotation_runs ADD COLUMN IF NOT EXISTS n_triggers SMALLINT;

ALTER TABLE sector_rotation_groups ADD COLUMN IF NOT EXISTS aligned BOOLEAN;

CREATE TABLE IF NOT EXISTS sector_rotation_canaries (
    name            TEXT        PRIMARY KEY,
    run_id          TEXT        REFERENCES sector_rotation_runs(run_id),
    pair            TEXT,
    z               REAL,
    smooth          REAL,
    vote            SMALLINT,
    implication     TEXT,
    proxy           BOOLEAN,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sector_rotation_triggers (
    symbol          TEXT        PRIMARY KEY,
    run_id          TEXT        REFERENCES sector_rotation_runs(run_id),
    sector          TEXT,
    industry        TEXT,
    ensemble        REAL,
    n_long          SMALLINT,
    n_short         SMALLINT,
    n_cfg           SMALLINT,
    triggered       TEXT,
    tema_side       TEXT,
    tema_grade      TEXT,
    macd_action     TEXT,
    aligned         BOOLEAN,
    group_label     TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_src_canaries_run ON sector_rotation_canaries (run_id);
CREATE INDEX IF NOT EXISTS idx_src_triggers_run ON sector_rotation_triggers (run_id);

ALTER TABLE sector_rotation_canaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_rotation_triggers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON sector_rotation_canaries FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON sector_rotation_triggers FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON sector_rotation_canaries FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON sector_rotation_triggers FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
