-- Triangle pattern scanner (ascending + descending break-up)

CREATE TABLE IF NOT EXISTS triangle_scan_runs (
    asof_date       DATE PRIMARY KEY,
    names           INTEGER,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS triangle_setups (
    symbol                  TEXT NOT NULL,
    bar_date                DATE NOT NULL,
    pattern_type            TEXT NOT NULL,
    status                  TEXT NOT NULL,
    score                   NUMERIC,
    close                   NUMERIC,
    support_price           NUMERIC,
    resistance_price        NUMERIC,
    resistance_slope_pct    NUMERIC,
    support_slope_pct       NUMERIC,
    geometry                JSONB,
    computed_at             TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (symbol, bar_date, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_triangle_setups_bar_status
    ON triangle_setups (bar_date DESC, status);
