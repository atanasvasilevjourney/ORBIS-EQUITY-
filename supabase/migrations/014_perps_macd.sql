-- ============================================================================
-- KovaView Terminal — Migration 014: MACD close on the TEMA perp sleeve
-- TEMA 9/99/199 still enters. MACD(12,26,9) is the systematic close.
-- 2.5 ATR remains the hard stop. Carver sleeve is unchanged.
-- ============================================================================

ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS macd REAL;
ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS macd_signal REAL;
ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS macd_hist REAL;
ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS macd_action TEXT;

NOTIFY pgrst, 'reload schema';
