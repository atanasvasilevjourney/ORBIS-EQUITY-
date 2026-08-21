-- ============================================================================
-- KovaView Terminal — Migration 009: Opening range breakout (paper)
-- Premarket/open gappers + 15-minute OR + 1R bracket, long only.
-- ============================================================================

CREATE TABLE orb_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    session_date    DATE        NOT NULL,
    names           SMALLINT,
    breakouts       SMALLINT,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orb_runs_asof ON orb_runs (asof_date DESC);

CREATE TABLE orb_watch (
    symbol          TEXT        PRIMARY KEY,
    run_id          TEXT        REFERENCES orb_runs(run_id),
    company_name    TEXT,
    gap_pct         REAL,
    prev_close      REAL,
    open_px         REAL,
    or_high         REAL,
    or_low          REAL,
    or_range        REAL,
    status          TEXT        NOT NULL,  -- WATCH / BREAKOUT / NO_BREAK / NO_BARS
    entry           REAL,
    stop            REAL,
    take_profit     REAL,
    shares          INTEGER,
    breakout_at     TIMESTAMPTZ,
    last_px         REAL,
    r_multiple      REAL,
    bars            JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orb_watch_run ON orb_watch (run_id);

CREATE TABLE orb_orders (
    id              TEXT        PRIMARY KEY,
    run_id          TEXT        REFERENCES orb_runs(run_id),
    ticker          TEXT        NOT NULL,
    action          TEXT        NOT NULL,   -- BUY
    type            TEXT        NOT NULL,   -- ENTER
    shares          INTEGER     NOT NULL,
    limit_price     REAL,
    stop_price      REAL,
    take_profit     REAL,
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orb_orders_run ON orb_orders (run_id);

ALTER TABLE orb_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orb_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE orb_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON orb_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON orb_watch FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON orb_orders FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON orb_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON orb_watch FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON orb_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
