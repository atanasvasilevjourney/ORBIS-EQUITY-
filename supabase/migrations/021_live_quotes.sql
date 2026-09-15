-- Live quotes from London Strategic Edge WebSocket stream.
-- Populated by pipeline.stream.live_quotes (always-on worker), not the nightly cron.

CREATE TABLE IF NOT EXISTS live_quotes (
    symbol          TEXT        PRIMARY KEY,
    price           DOUBLE PRECISION NOT NULL,
    bid             DOUBLE PRECISION,
    ask             DOUBLE PRECISION,
    volume          DOUBLE PRECISION,
    tick_at         TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT        NOT NULL DEFAULT 'lse_live'
);

CREATE INDEX IF NOT EXISTS idx_live_quotes_updated_at
    ON live_quotes (updated_at DESC);

COMMENT ON TABLE live_quotes IS
  'Latest LSE live tick per symbol. Written by the live stream worker.';
