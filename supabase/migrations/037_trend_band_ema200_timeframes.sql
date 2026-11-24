-- pb_ema EMA200 high/low band + daily/weekly timeframes

ALTER TABLE trend_band_setups
    ADD COLUMN IF NOT EXISTS timeframe TEXT NOT NULL DEFAULT '1d',
    ADD COLUMN IF NOT EXISTS asset_class TEXT,
    ADD COLUMN IF NOT EXISTS ema200_high NUMERIC,
    ADD COLUMN IF NOT EXISTS ema200_low NUMERIC,
    ADD COLUMN IF NOT EXISTS dual_timeframe BOOLEAN DEFAULT false;

ALTER TABLE trend_band_setups DROP CONSTRAINT IF EXISTS trend_band_setups_pkey;
ALTER TABLE trend_band_setups ADD PRIMARY KEY (symbol, bar_date, timeframe);

CREATE INDEX IF NOT EXISTS idx_trend_band_setups_tf_score
    ON trend_band_setups (bar_date DESC, timeframe, score DESC);

CREATE INDEX IF NOT EXISTS idx_trend_band_setups_asset
    ON trend_band_setups (bar_date DESC, asset_class);