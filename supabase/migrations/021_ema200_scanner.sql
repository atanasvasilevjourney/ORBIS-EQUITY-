-- ============================================================================
-- Migration 021: EMA200 touch scanner (Phase 1 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ema200_universe (
    symbol          TEXT PRIMARY KEY,
    asset_class     TEXT NOT NULL,
    exchange        TEXT,
    is_etf          BOOLEAN DEFAULT false,
    active          BOOLEAN DEFAULT true,
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ema200_features (
    symbol          TEXT NOT NULL,
    bar_date        DATE NOT NULL,
    close           NUMERIC,
    ema200          NUMERIC,
    ema200_slope    NUMERIC,
    atr14           NUMERIC,
    dist_atr        NUMERIC,
    rvol            NUMERIC,
    days_above      INTEGER,
    regime          TEXT,
    PRIMARY KEY (symbol, bar_date)
);

CREATE INDEX IF NOT EXISTS idx_ema200_features_bar_date
    ON ema200_features (bar_date DESC);

CREATE TABLE IF NOT EXISTS ema200_events (
    id              BIGSERIAL PRIMARY KEY,
    symbol          TEXT NOT NULL,
    bar_date        DATE NOT NULL,
    event_type      TEXT NOT NULL,
    score           NUMERIC,
    features        JSONB,
    fwd_ret_1d      NUMERIC,
    fwd_ret_5d      NUMERIC,
    fwd_ret_10d     NUMERIC,
    fwd_ret_20d     NUMERIC,
    mae_20d         NUMERIC,
    mfe_20d         NUMERIC,
    UNIQUE (symbol, event_type, bar_date)
);

CREATE TABLE IF NOT EXISTS ema200_alerts (
    id              BIGSERIAL PRIMARY KEY,
    symbol          TEXT NOT NULL,
    bar_date        DATE NOT NULL,
    score           NUMERIC,
    payload         JSONB,
    sent_discord    BOOLEAN DEFAULT false,
    sent_email      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (symbol, bar_date)
);

CREATE TABLE IF NOT EXISTS ema200_state (
    symbol          TEXT PRIMARY KEY,
    state           TEXT NOT NULL,
    last_alert_date DATE,
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ema200_journal (
    id              BIGSERIAL PRIMARY KEY,
    alert_id        BIGINT REFERENCES ema200_alerts(id),
    action          TEXT,
    reason          TEXT,
    entry_price     NUMERIC,
    stop_price      NUMERIC,
    exit_price      NUMERIC,
    exit_date       DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ema200_heartbeat (
    job             TEXT PRIMARY KEY,
    last_success    TIMESTAMPTZ,
    last_status     TEXT
);

ALTER TABLE ema200_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema200_heartbeat ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_universe FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_features FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_events FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_alerts FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_state FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_journal FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "anon_read" ON ema200_heartbeat FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_universe FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_features FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_state FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_journal FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON ema200_heartbeat FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
