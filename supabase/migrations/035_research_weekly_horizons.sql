-- ============================================================================
-- ORBIS — Migration 035: Weekly research ideas — horizon, confidence, shorts
-- ============================================================================

ALTER TABLE research_weekly_setups
    ADD COLUMN IF NOT EXISTS horizon TEXT NOT NULL DEFAULT 'medium_term',
    ADD COLUMN IF NOT EXISTS confidence TEXT;

ALTER TABLE research_weekly_setups
    DROP CONSTRAINT IF EXISTS research_weekly_setups_horizon_check;

ALTER TABLE research_weekly_setups
    ADD CONSTRAINT research_weekly_setups_horizon_check
    CHECK (horizon IN ('short_term', 'medium_term', 'long_term'));

CREATE INDEX IF NOT EXISTS idx_research_weekly_setups_horizon
    ON research_weekly_setups (run_id, horizon, rank);

NOTIFY pgrst, 'reload schema';