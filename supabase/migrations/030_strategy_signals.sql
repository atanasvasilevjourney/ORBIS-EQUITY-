-- Strategy signal bus (Phase 2): append-only, point-in-time rows.

CREATE TABLE IF NOT EXISTS strategy_signals (
    strategy_id     TEXT        NOT NULL,
    symbol          TEXT        NOT NULL,
    as_of           DATE        NOT NULL,
    known_on        DATE        NOT NULL,
    side            TEXT        NOT NULL CHECK (side IN ('BUY', 'SELL', 'FLAT')),
    score           DOUBLE PRECISION NOT NULL DEFAULT 0,
    stop            DOUBLE PRECISION,
    size_hint       DOUBLE PRECISION,
    reason          TEXT        NOT NULL DEFAULT '',
    params_hash     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (strategy_id, symbol, as_of, known_on)
);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_strategy_asof
    ON strategy_signals (strategy_id, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_known
    ON strategy_signals (known_on DESC);

ALTER TABLE strategy_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_signals_read ON strategy_signals;
CREATE POLICY strategy_signals_read ON strategy_signals
    FOR SELECT USING (true);
