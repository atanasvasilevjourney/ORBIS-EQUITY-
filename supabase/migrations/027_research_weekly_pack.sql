-- Weekly Money Machine × ORBIS research pack (paper / research terminal only).

CREATE TABLE IF NOT EXISTS research_weekly_pack (
    pack_id         TEXT        PRIMARY KEY,
    week_start      DATE        NOT NULL,
    asof_date       DATE        NOT NULL,
    headline        TEXT,
    macro           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    internals       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sector_rotation JSONB       NOT NULL DEFAULT '{}'::jsonb,
    risk_notes      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    config_version  SMALLINT,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_weekly_pack_week ON research_weekly_pack (week_start DESC);
CREATE INDEX IF NOT EXISTS idx_research_weekly_pack_asof ON research_weekly_pack (asof_date DESC);

CREATE TABLE IF NOT EXISTS research_setups (
    id              BIGSERIAL   PRIMARY KEY,
    pack_id         TEXT        NOT NULL REFERENCES research_weekly_pack(pack_id) ON DELETE CASCADE,
    rank            SMALLINT    NOT NULL,
    symbol          TEXT        NOT NULL,
    company_name    TEXT,
    theme_bucket    TEXT,
    desk_source     TEXT,
    side            TEXT,
    entry           REAL,
    stop            REAL,
    target          REAL,
    rr              REAL,
    orbis_score     SMALLINT,
    status          TEXT        NOT NULL DEFAULT 'pending',
    rationale       TEXT,
    rules           JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (pack_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_research_setups_pack ON research_setups (pack_id);
CREATE INDEX IF NOT EXISTS idx_research_setups_symbol ON research_setups (symbol);

ALTER TABLE research_weekly_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_setups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON research_weekly_pack FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON research_setups FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "service_all" ON research_weekly_pack FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "service_all" ON research_setups FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
