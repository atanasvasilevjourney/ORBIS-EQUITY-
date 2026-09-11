-- ============================================================================
-- KovaView Terminal — Migration 015: beta rotational sector / industry tape
-- Inspired by Caltropia's sector+industry outlook structure. Computed on this
-- universe. Paper diagnostic — not a live book.
-- ============================================================================

CREATE TABLE sector_rotation_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    n_sectors       SMALLINT,
    n_industries    SMALLINT,
    regime          TEXT,
    headline        TEXT,
    config          JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sector_rotation_runs_asof ON sector_rotation_runs (asof_date DESC);

CREATE TABLE sector_rotation_groups (
    group_type          TEXT        NOT NULL,  -- sector | industry
    name                TEXT        NOT NULL,
    run_id              TEXT        REFERENCES sector_rotation_runs(run_id),
    n_names             SMALLINT,
    tickers             TEXT[],
    current_breadth     REAL,
    mom_breadth         REAL,
    value_breadth       REAL,
    lowvol_breadth      REAL,
    avg_trend           REAL,
    impulse             REAL,
    beta_60             REAL,
    rs_4w               REAL,
    stretch_pct         REAL,
    label               TEXT,
    score               REAL,
    bucket              TEXT,
    heatmap             JSONB,
    leaders             TEXT[],
    computed_at         TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (group_type, name)
);

CREATE INDEX idx_sector_rotation_groups_run ON sector_rotation_groups (run_id);
CREATE INDEX idx_sector_rotation_groups_label ON sector_rotation_groups (label);

ALTER TABLE sector_rotation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_rotation_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON sector_rotation_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON sector_rotation_groups FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON sector_rotation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON sector_rotation_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
