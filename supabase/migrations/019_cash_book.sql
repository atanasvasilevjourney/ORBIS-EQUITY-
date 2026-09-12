-- ============================================================================
-- Migration 019: TEMA + Carver size as cash-market shares
-- Listed close from prices_daily. Fully funded — no USDT-M overlay.
-- ============================================================================

ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS tema_shares REAL;
ALTER TABLE perp_names ADD COLUMN IF NOT EXISTS carver_shares REAL;

NOTIFY pgrst, 'reload schema';
