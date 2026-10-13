-- Re-apply fundamental analysis columns if migration 021 was skipped in production.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE fundamentals_snapshot
    ADD COLUMN IF NOT EXISTS f_score_detail JSONB,
    ADD COLUMN IF NOT EXISTS fundamental_verdict TEXT,
    ADD COLUMN IF NOT EXISTS fundamental_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_fundamentals_verdict
    ON fundamentals_snapshot (fundamental_verdict);

NOTIFY pgrst, 'reload schema';
