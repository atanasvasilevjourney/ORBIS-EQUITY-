"""Subscribe to LSE websocket ticks and upsert ``quotes_last``.

Does not touch ``prices_daily``. Paper last-print bus only.

Usage:
    LSE_API_KEY=... python -m pipeline.ingest.lse_live
    LSE_STREAM_SYMBOLS=AAPL,MSFT,MET python -m pipeline.ingest.lse_live
"""
from __future__ import annotations

import logging
import os
import time

from dotenv import load_dotenv
from supabase import create_client

from pipeline.clients.lse_live import (
    iter_ticks,
    lse_stream_configured,
    tick_to_quote,
)
from pipeline.config.settings import SupabaseConfig
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")

logger = logging.getLogger(__name__)

DEFAULT_WATCH = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "JPM", "V", "MA", "MET",
    "XOM", "CVX", "JNJ", "UNH", "SPY", "QQQ",
]
FLUSH_EVERY = 8
FLUSH_SEC = 2.0


def _watchlist() -> list[str]:
    raw = (os.getenv("LSE_STREAM_SYMBOLS") or "").strip()
    if raw:
        return [s.strip().upper() for s in raw.split(",") if s.strip()]
    try:
        cfg = SupabaseConfig()
        sb = create_client(cfg.url, cfg.service_key)
        members = fetch_all(
            sb,
            "universe_members",
            "symbol, country",
            filters=lambda q: q.eq("is_active", True),
        )
        us = [m["symbol"] for m in members if (m.get("country") or "US") == "US"]
        if us:
            cap = int(os.getenv("LSE_STREAM_LIMIT", "24"))
            return us[:cap]
    except Exception:
        logger.warning("universe watchlist unavailable — using default names")
    return list(DEFAULT_WATCH)


def _flush(sb, pending: dict[str, dict]) -> int:
    if not pending:
        return 0
    rows = list(pending.values())
    sb.table("quotes_last").upsert(rows, on_conflict="symbol").execute()
    n = len(rows)
    pending.clear()
    return n


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    if not lse_stream_configured():
        logger.error(
            "LSE_API_KEY is not set. Get a key at https://londonstrategicedge.com/data "
            "and export it. The PostgREST catalog is not a stream."
        )
        return

    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    symbols = _watchlist()
    logger.info("LSE websocket subscribe %d names: %s", len(symbols), ",".join(symbols[:12]))
    sb = create_client(cfg.url, cfg.service_key)
    pending: dict[str, dict] = {}
    last_flush = time.time()
    seen = 0

    try:
        for tick in iter_ticks(symbols):
            row = tick_to_quote(tick)
            if not row:
                continue
            pending[row["symbol"]] = row
            seen += 1
            if len(pending) >= FLUSH_EVERY or (time.time() - last_flush) >= FLUSH_SEC:
                n = _flush(sb, pending)
                last_flush = time.time()
                if n:
                    logger.info("quotes_last upsert %d (ticks=%d last=%s %.2f)", n, seen, row["symbol"], row["last"])
    except KeyboardInterrupt:
        logger.info("LSE live ingest stopped")
    finally:
        try:
            _flush(sb, pending)
        except Exception:
            logger.exception("final quotes_last flush failed")


if __name__ == "__main__":
    main()
