-- ============================================================================
-- Migration 021: LSE live last prints
-- London Strategic Edge websocket ticks land here. Never write these into
-- prices_daily — that table is the last closed cash session only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quotes_last (
    symbol          TEXT        PRIMARY KEY,
    last            REAL        NOT NULL,
    bid             REAL,
    ask             REAL,
    volume          REAL,
    ts              TIMESTAMPTZ,
    source          TEXT        NOT NULL DEFAULT 'lse_ws',
    replay          BOOLEAN     NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_last_updated
    ON quotes_last (updated_at DESC);

ALTER TABLE quotes_last ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON quotes_last FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE POLICY "service_all" ON quotes_last FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
