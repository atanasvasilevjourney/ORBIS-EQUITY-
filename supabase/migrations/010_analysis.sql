-- ============================================================================
-- KovaView Terminal — Migration 010: Technical + fundamental analysis
-- Long/mid-term MA, MACD, RSI, regression, and volume-trend signals.
-- ============================================================================

CREATE TABLE analysis_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    buys            SMALLINT,
    sells           SMALLINT,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analysis_runs_asof ON analysis_runs (asof_date DESC);

CREATE TABLE analysis_names (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES analysis_runs(run_id),
    company_name        TEXT,
    last_px             REAL,
    sma50               REAL,
    sma100              REAL,
    sma200              REAL,
    ema20               REAL,
    ema50               REAL,
    ema100              REAL,
    macd                REAL,
    rsi                 REAL,
    lr_m                REAL,
    lr_code             SMALLINT,
    lr_desc             TEXT,
    mavg_long_code      SMALLINT,
    mavg_long_desc      TEXT,
    mavg_mid_code       SMALLINT,
    mavg_mid_desc       TEXT,
    dt_code             SMALLINT,
    dt_desc             TEXT,
    macd_code           SMALLINT,
    macd_desc           TEXT,
    rsi_code            SMALLINT,
    rsi_desc            TEXT,
    vote                TEXT,
    buy_count           SMALLINT,
    sell_count          SMALLINT,
    hold_count          SMALLINT,
    composite_score     REAL,
    f_score             SMALLINT,
    pe_ratio            REAL,
    spark               JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analysis_names_run ON analysis_names (run_id);
CREATE INDEX idx_analysis_names_vote ON analysis_names (vote);

ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON analysis_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON analysis_names FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON analysis_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON analysis_names FOR ALL TO service_role USING (true) WITH CHECK (true);
