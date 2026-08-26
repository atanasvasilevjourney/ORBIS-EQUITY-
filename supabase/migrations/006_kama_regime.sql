-- Dual-KAMA regime filter on Trend Radar (stability-promoted global params).
-- 1 = bullish (short KAMA > long KAMA), -1 = bearish, 0 = unknown/warmup.

ALTER TABLE trend_radar
    ADD COLUMN IF NOT EXISTS kama_regime SMALLINT;
