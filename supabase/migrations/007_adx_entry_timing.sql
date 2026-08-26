-- ADX + entry timing columns on Trend Radar
-- (swing-screener timing vetoes + Wilder ADX gate)

ALTER TABLE trend_radar
    ADD COLUMN IF NOT EXISTS adx REAL;

ALTER TABLE trend_radar
    ADD COLUMN IF NOT EXISTS entry_timing TEXT;
