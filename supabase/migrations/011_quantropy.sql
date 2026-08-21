-- ============================================================================
-- KovaView Terminal — Migration 011: Quantropy desk
-- Risk metrics, CAPM, Altman Z, and Markowitz allocation (paper).
-- ============================================================================

CREATE TABLE quantropy_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    headline        TEXT,
    allocations     JSONB,
    frontier        JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quantropy_runs_asof ON quantropy_runs (asof_date DESC);

CREATE TABLE quantropy_names (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES quantropy_runs(run_id),
    company_name        TEXT,
    last_px             REAL,
    ann_return          REAL,
    ann_vol             REAL,
    downside_vol        REAL,
    sharpe              REAL,
    sortino             REAL,
    max_drawdown        REAL,
    var_95              REAL,
    cvar_95             REAL,
    beta                REAL,
    alpha               REAL,
    info_ratio          REAL,
    altman_z            REAL,
    altman_zone         TEXT,
    w_equal             REAL,
    w_inv_vol           REAL,
    w_min_var           REAL,
    w_max_sharpe        REAL,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quantropy_names_run ON quantropy_names (run_id);

ALTER TABLE quantropy_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quantropy_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON quantropy_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON quantropy_names FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON quantropy_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON quantropy_names FOR ALL TO service_role USING (true) WITH CHECK (true);
