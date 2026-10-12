-- ============================================================================
-- KovaView Terminal — Migration 021: Fundamental analysis detail
-- Persists Piotroski component breakdown + automated fundamental verdict.
-- ============================================================================

ALTER TABLE fundamentals_snapshot
    ADD COLUMN IF NOT EXISTS f_score_detail JSONB,
    ADD COLUMN IF NOT EXISTS fundamental_verdict TEXT,
    ADD COLUMN IF NOT EXISTS fundamental_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_fundamentals_verdict
    ON fundamentals_snapshot (fundamental_verdict);
