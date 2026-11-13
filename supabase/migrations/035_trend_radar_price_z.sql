-- Price z-score on the watchlist row.
-- Prior close versus the long KAMA, divided by the 20-session stdev of
-- daily price changes. Positive means the close sits above that fair line.

ALTER TABLE trend_radar
    ADD COLUMN IF NOT EXISTS price_z REAL;
