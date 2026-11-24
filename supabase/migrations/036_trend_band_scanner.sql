-- Trend-band pullback scanner (EMA 20/50 cloud)

CREATE TABLE IF NOT EXISTS trend_band_scan_runs (
    asof_date       DATE PRIMARY KEY,
    names           INTEGER,
    headline        TEXT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trend_band_setups (
    symbol              TEXT NOT NULL,
    bar_date            DATE NOT NULL,
    setup_kind          TEXT NOT NULL,
    score               NUMERIC,
    close               NUMERIC,
    band_lo             NUMERIC,
    band_hi             NUMERIC,
    invalidation        NUMERIC,
    dist_to_band_pct    NUMERIC,
    pullback_pct        NUMERIC,
    advance_pct         NUMERIC,
    band_slope_pct      NUMERIC,
    band_color          TEXT,
    band_flip           BOOLEAN DEFAULT false,
    days_since_flip     INTEGER,
    spark               JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (symbol, bar_date)
);

CREATE INDEX IF NOT EXISTS idx_trend_band_setups_bar_score
    ON trend_band_setups (bar_date DESC, score DESC);