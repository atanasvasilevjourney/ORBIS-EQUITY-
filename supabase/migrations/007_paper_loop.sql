-- ============================================================================
-- KovaView Terminal — Migration 007: Equity breakout paper loop
-- Paper book + orders + run log for the daily portfolio harness.
-- ============================================================================

CREATE TABLE paper_loop_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    equity          DOUBLE PRECISION NOT NULL,
    deployed_pct    REAL,
    open_risk_pct   REAL,
    names           SMALLINT,
    posture         SMALLINT,
    status          TEXT,
    headline        TEXT,
    harness         JSONB,
    log             JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_paper_loop_runs_asof ON paper_loop_runs (asof_date DESC);

CREATE TABLE paper_book (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES paper_loop_runs(run_id),
    company_name        TEXT,
    side                TEXT        NOT NULL DEFAULT 'LONG',
    shares              INTEGER     NOT NULL,
    entry               REAL        NOT NULL,
    last                REAL,
    stop                REAL,
    n                   REAL,
    risk_usd            REAL,
    sector              TEXT,
    reason              TEXT,
    rank                SMALLINT,
    breakout            BOOLEAN,
    green               BOOLEAN,
    unrealized_pnl_usd  REAL,
    days_held           SMALLINT,
    opened_at           DATE,
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE paper_orders (
    id          TEXT        PRIMARY KEY,
    run_id      TEXT        REFERENCES paper_loop_runs(run_id),
    ticker      TEXT        NOT NULL,
    action      TEXT        NOT NULL,   -- BUY / SELL
    type        TEXT        NOT NULL,   -- ENTER / EXIT / RESIZE
    shares      INTEGER     NOT NULL,
    limit_price REAL,
    reason      TEXT,
    sector      TEXT,
    risk_usd    REAL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_paper_orders_run ON paper_orders (run_id);

ALTER TABLE paper_loop_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON paper_loop_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON paper_book FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON paper_orders FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON paper_loop_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON paper_book FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON paper_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
