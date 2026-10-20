-- Daily universe membership snapshots for point-in-time research.

CREATE TABLE IF NOT EXISTS universe_member_snapshots (
    asof_date       DATE        NOT NULL,
    symbol          TEXT        NOT NULL,
    tier            TEXT,
    sector          TEXT,
    industry        TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (asof_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_universe_snapshots_date
    ON universe_member_snapshots (asof_date DESC);

ALTER TABLE universe_member_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS universe_snapshots_read ON universe_member_snapshots;
CREATE POLICY universe_snapshots_read ON universe_member_snapshots
    FOR SELECT USING (true);
