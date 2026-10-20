-- LOOP v2 cross-sectional paper harness (parallel to Donchian LOOP book).

CREATE TABLE IF NOT EXISTS paper_loop_xs_runs (
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

CREATE INDEX IF NOT EXISTS idx_paper_loop_xs_runs_asof ON paper_loop_xs_runs (asof_date DESC);

CREATE TABLE IF NOT EXISTS paper_book_xs (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES paper_loop_xs_runs(run_id),
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

CREATE TABLE IF NOT EXISTS paper_orders_xs (
    id          TEXT        PRIMARY KEY,
    run_id      TEXT        REFERENCES paper_loop_xs_runs(run_id),
    ticker      TEXT        NOT NULL,
    action      TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    shares      INTEGER     NOT NULL,
    limit_price REAL,
    reason      TEXT,
    sector      TEXT,
    risk_usd    REAL,
    fill_price REAL,
    fill_mode TEXT,
    commission_usd REAL,
    slippage_usd REAL,
    cost_usd REAL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_orders_xs_run ON paper_orders_xs (run_id);

ALTER TABLE paper_loop_xs_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_book_xs ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_orders_xs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paper_loop_xs_runs_read ON paper_loop_xs_runs;
CREATE POLICY paper_loop_xs_runs_read ON paper_loop_xs_runs FOR SELECT USING (true);

DROP POLICY IF EXISTS paper_book_xs_read ON paper_book_xs;
CREATE POLICY paper_book_xs_read ON paper_book_xs FOR SELECT USING (true);

DROP POLICY IF EXISTS paper_orders_xs_read ON paper_orders_xs;
CREATE POLICY paper_orders_xs_read ON paper_orders_xs FOR SELECT USING (true);

DROP POLICY IF EXISTS paper_loop_xs_runs_service ON paper_loop_xs_runs;
CREATE POLICY paper_loop_xs_runs_service ON paper_loop_xs_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paper_book_xs_service ON paper_book_xs;
CREATE POLICY paper_book_xs_service ON paper_book_xs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paper_orders_xs_service ON paper_orders_xs;
CREATE POLICY paper_orders_xs_service ON paper_orders_xs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
