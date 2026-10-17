-- ============================================================================
-- Migration 028: Trading journal (closed LOOP paper trades)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trading_journal (
    id              TEXT PRIMARY KEY,
    desk            TEXT        NOT NULL DEFAULT 'loop',
    symbol          TEXT        NOT NULL,
    side            TEXT        NOT NULL DEFAULT 'LONG',
    shares          INTEGER     NOT NULL,
    entry_price     DOUBLE PRECISION NOT NULL,
    exit_price      DOUBLE PRECISION NOT NULL,
    pnl_usd         DOUBLE PRECISION NOT NULL,
    return_pct      DOUBLE PRECISION,
    sector          TEXT,
    entry_reason    TEXT,
    exit_reason     TEXT,
    entered_at      TIMESTAMPTZ,
    exited_at       TIMESTAMPTZ NOT NULL,
    exit_order_id   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_journal_desk_exited
    ON trading_journal (desk, exited_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_journal_symbol
    ON trading_journal (symbol);

ALTER TABLE trading_journal ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "anon_read" ON trading_journal FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "service_all" ON trading_journal FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
