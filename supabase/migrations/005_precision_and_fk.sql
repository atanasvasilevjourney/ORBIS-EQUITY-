-- ============================================================================
-- Orbis Equity Terminal — Migration 005: Financial precision + foreign keys
-- 1. Upgrade REAL → DOUBLE PRECISION for large financial values
-- 2. Add updated_at auto-update trigger
-- ============================================================================

-- ==========================================================================
-- 1. Upgrade financial columns from REAL (float4) to DOUBLE PRECISION (float8)
--    Prevents precision loss on large-cap revenue/market_cap values
-- ==========================================================================
ALTER TABLE fundamentals_snapshot
    ALTER COLUMN revenue TYPE DOUBLE PRECISION,
    ALTER COLUMN market_cap TYPE DOUBLE PRECISION,
    ALTER COLUMN gross_profit TYPE DOUBLE PRECISION,
    ALTER COLUMN operating_income TYPE DOUBLE PRECISION,
    ALTER COLUMN net_income TYPE DOUBLE PRECISION,
    ALTER COLUMN ebitda TYPE DOUBLE PRECISION;

-- ==========================================================================
-- 2. Auto-update trigger for updated_at columns
-- ==========================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_universe_updated BEFORE UPDATE ON universe_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fundamentals_updated BEFORE UPDATE ON fundamentals_snapshot
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pharma_trials_updated BEFORE UPDATE ON pharma_trials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pdufa_updated BEFORE UPDATE ON pdufa_calendar
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================================================
-- 3. Composite index for common price query pattern (symbol + date DESC)
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_prices_daily_symbol_date
    ON prices_daily (symbol, date DESC);
