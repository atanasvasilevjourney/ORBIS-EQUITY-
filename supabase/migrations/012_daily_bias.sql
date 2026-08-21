-- ============================================================================
-- KovaView Terminal — Migration 012: Daily bias + paper trade ideas
-- Classic pivots, ATR range, ANALYZE vote, annotated chart levels.
-- Paper only. No GEX / order-flow (we do not have that tape).
-- ============================================================================

CREATE TABLE bias_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    longs           SMALLINT,
    shorts          SMALLINT,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bias_runs_asof ON bias_runs (asof_date DESC);

CREATE TABLE bias_names (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES bias_runs(run_id),
    company_name        TEXT,
    last_px             REAL,
    bias                TEXT,
    confidence          TEXT,
    vote                TEXT,
    buy_count           SMALLINT,
    sell_count          SMALLINT,
    atr                 REAL,
    rsi                 REAL,
    sma20               REAL,
    sma50               REAL,
    range_lo            REAL,
    range_hi            REAL,
    levels              JSONB,
    ideas               JSONB,
    scenarios           JSONB,
    rationale           TEXT,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bias_names_run ON bias_names (run_id);
CREATE INDEX idx_bias_names_bias ON bias_names (bias);

ALTER TABLE bias_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bias_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON bias_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON bias_names FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON bias_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON bias_names FOR ALL TO service_role USING (true) WITH CHECK (true);
