-- ============================================================================
-- ORBIS — Migration 027: Weekly research pack (Money Machine-style + ORBIS data)
-- Paper research only — entry / stop / target are transparent guidelines.
-- ============================================================================

CREATE TABLE research_weekly_runs (
    run_id          TEXT        PRIMARY KEY,
    week_ending     DATE        NOT NULL,
    headline        TEXT,
    macro           JSONB       NOT NULL DEFAULT '{}',
    sectors         JSONB       NOT NULL DEFAULT '[]',
    risk_notes      JSONB       NOT NULL DEFAULT '[]',
    config          JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_research_weekly_runs_week ON research_weekly_runs (week_ending DESC);

CREATE TABLE research_weekly_setups (
    id              BIGSERIAL   PRIMARY KEY,
    run_id          TEXT        NOT NULL REFERENCES research_weekly_runs(run_id) ON DELETE CASCADE,
    rank            SMALLINT    NOT NULL,
    symbol          TEXT        NOT NULL,
    company_name    TEXT,
    source          TEXT,
    theme           TEXT,
    side            TEXT        DEFAULT 'LONG',
    entry_px        REAL,
    stop_px         REAL,
    target_px       REAL,
    rr              REAL,
    last_px         REAL,
    quality_rank    SMALLINT,
    factor_score    SMALLINT,
    rationale       TEXT,
    meta            JSONB       DEFAULT '{}'
);

CREATE INDEX idx_research_weekly_setups_run ON research_weekly_setups (run_id, rank);

ALTER TABLE research_weekly_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_weekly_setups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_research_weekly_runs" ON research_weekly_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_research_weekly_setups" ON research_weekly_setups FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_research_weekly_runs" ON research_weekly_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_research_weekly_setups" ON research_weekly_setups FOR ALL TO service_role USING (true) WITH CHECK (true);
