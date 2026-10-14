-- Double-stacked EMA200 ribbon (close + high/low lines) and ribbon proximity for watchlist

ALTER TABLE ema200_features
    ADD COLUMN IF NOT EXISTS ema200_high NUMERIC,
    ADD COLUMN IF NOT EXISTS ema200_low NUMERIC,
    ADD COLUMN IF NOT EXISTS ribbon_dist_atr NUMERIC;

NOTIFY pgrst, 'reload schema';
