-- ============================================================================
-- KovaView Terminal — Migration 006: Equity factor scores + insider dedup fix
-- Adds systematic quant factor columns to fundamentals_snapshot.
-- ============================================================================

-- Quant factor scores (0-100, cross-sectional ranks computed nightly)
ALTER TABLE fundamentals_snapshot
    ADD COLUMN IF NOT EXISTS value_score              SMALLINT,
    ADD COLUMN IF NOT EXISTS quality_score            SMALLINT,
    ADD COLUMN IF NOT EXISTS growth_score             SMALLINT,
    ADD COLUMN IF NOT EXISTS earnings_quality_score   SMALLINT,
    ADD COLUMN IF NOT EXISTS leverage_score           SMALLINT,
    ADD COLUMN IF NOT EXISTS composite_factor_score   SMALLINT,
    ADD COLUMN IF NOT EXISTS sector_value_pctile      REAL,
    ADD COLUMN IF NOT EXISTS sector_quality_pctile    REAL,
    ADD COLUMN IF NOT EXISTS accruals_ratio           REAL,
    ADD COLUMN IF NOT EXISTS interest_coverage        REAL,
    ADD COLUMN IF NOT EXISTS factor_computed_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fundamentals_composite_factor
    ON fundamentals_snapshot (composite_factor_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_fundamentals_value_score
    ON fundamentals_snapshot (value_score DESC NULLS LAST);

-- Fix insider dedup: allow multiple transactions per insider per filing date
ALTER TABLE insider_trades_snapshot
    DROP CONSTRAINT IF EXISTS uq_insider_symbol_filing_name;

ALTER TABLE insider_trades_snapshot
    DROP CONSTRAINT IF EXISTS uq_insider_tx;

ALTER TABLE insider_trades_snapshot
    ADD CONSTRAINT uq_insider_tx
    UNIQUE (symbol, filing_date, reporting_name, transaction_type);
