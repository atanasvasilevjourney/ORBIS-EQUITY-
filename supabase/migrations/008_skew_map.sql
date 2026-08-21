-- ============================================================================
-- KovaView Terminal — Migration 008: Options skew map + weekend vol
-- Live IV surface from listed option chains (yfinance, no API key).
-- ============================================================================

CREATE TABLE skew_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_skew_runs_asof ON skew_runs (asof_date DESC);

CREATE TABLE skew_names (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES skew_runs(run_id),
    company_name        TEXT,
    spot                REAL,
    atm_iv              REAL,
    iv_trading          REAL,
    front_dte           SMALLINT,
    front_expiry        DATE,
    put_skew            REAL,
    call_skew           REAL,
    risk_reversal       REAL,
    butterfly           REAL,
    term_slope          REAL,
    weekend_iv          REAL,
    weekend_ratio       REAL,
    weekend_var_share   REAL,
    n_expiries          SMALLINT,
    slices              JSONB,
    term                JSONB,
    surface             JSONB,
    weekend             JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_skew_names_run ON skew_names (run_id);

ALTER TABLE skew_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skew_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON skew_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON skew_names FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON skew_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON skew_names FOR ALL TO service_role USING (true) WITH CHECK (true);
