-- ============================================================================
-- Migration 017: nest industry / sub-sector tapes under a parent GICS sector
-- Energy → Solar / Nuclear / Oil & Gas / Oilfield Services, and so on.
-- ============================================================================

ALTER TABLE sector_rotation_groups ADD COLUMN IF NOT EXISTS parent_sector TEXT;

CREATE INDEX IF NOT EXISTS idx_src_groups_parent ON sector_rotation_groups (parent_sector);

NOTIFY pgrst, 'reload schema';
