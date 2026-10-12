-- EMA200 scanner: index bucket for S&P 500 vs Nasdaq-100 display

ALTER TABLE ema200_universe
    ADD COLUMN IF NOT EXISTS index_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_ema200_universe_active
    ON ema200_universe (active) WHERE active = true;

NOTIFY pgrst, 'reload schema';
