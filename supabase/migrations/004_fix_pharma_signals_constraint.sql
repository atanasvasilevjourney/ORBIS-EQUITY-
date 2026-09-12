-- ============================================================================
-- Orbis Equity Terminal — Migration 004: Fix pharma_signals unique constraint
-- Changes UNIQUE(nct_id) to UNIQUE(nct_id, event_type) to allow multiple
-- signal types per clinical trial without data loss.
-- ============================================================================

ALTER TABLE pharma_signals DROP CONSTRAINT IF EXISTS uq_pharma_signals_nct_id;
ALTER TABLE pharma_signals ADD CONSTRAINT uq_pharma_signals_nct_event UNIQUE (nct_id, event_type);
