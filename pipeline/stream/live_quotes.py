"""Live quote stream worker — London Strategic Edge WebSocket → Supabase.

Always-on process (Render background worker / local). Not suitable for
GitHub Actions cron (jobs die when the step ends).

Usage:
    python -m pipeline.stream.live_quotes
    bash pipeline/scripts/run_live_stream.sh

Env:
    LSE_API_KEY              required (lse_live_…)
    SUPABASE_URL / SERVICE_KEY required
    LSE_STREAM_SYMBOLS       optional comma list (default: top N from universe)
    LSE_STREAM_LIMIT         optional max symbols when auto-selecting (default 50)
    LSE_STREAM_FLUSH_SEC     optional upsert batch interval (default 2.0)
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_STOP = False


def _handle_signal(signum, _frame) -> None:
    global _STOP
    logger.info("signal %s received — shutting down", signum)
    _STOP = True


def _symbols_from_env_or_universe() -> list[str]:
    raw = os.getenv("LSE_STREAM_SYMBOLS", "").strip()
    if raw:
        return [s.strip().upper() for s in raw.split(",") if s.strip()]

    limit = int(os.getenv("LSE_STREAM_LIMIT", "50"))
    from pipeline.utils.client import get_supabase
    from pipeline.utils.supabase import fetch_all

    sb = get_supabase()
    members = fetch_all(
        sb,
        "universe_members",
        "symbol, tier, is_active, country",
        filters=lambda q: q.eq("is_active", True),
        order=("symbol", False),
    )
    preferred = [
        m["symbol"]
        for m in members
        if m.get("symbol") and str(m.get("tier") or "").startswith("us_")
    ]
    pool = preferred or [m["symbol"] for m in members if m.get("symbol")]
    return [str(s).upper() for s in pool[:limit]]


def tick_to_row(tick: Any) -> dict[str, Any] | None:
    symbol = getattr(tick, "symbol", None) or (tick.get("symbol") if isinstance(tick, dict) else None)
    price = getattr(tick, "price", None) if not isinstance(tick, dict) else tick.get("price")
    if not symbol or price is None:
        return None
    try:
        price_f = float(price)
    except (TypeError, ValueError):
        return None

    def _opt(name: str):
        val = getattr(tick, name, None) if not isinstance(tick, dict) else tick.get(name)
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    ts = getattr(tick, "timestamp", None) if not isinstance(tick, dict) else tick.get("timestamp")
    return {
        "symbol": str(symbol).upper(),
        "price": price_f,
        "bid": _opt("bid"),
        "ask": _opt("ask"),
        "volume": _opt("volume"),
        "tick_at": ts,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "lse_live",
    }


def _flush(sb, buffer: dict[str, dict]) -> int:
    if not buffer:
        return 0
    rows = list(buffer.values())
    sb.table("live_quotes").upsert(rows, on_conflict="symbol").execute()
    return len(rows)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    from pipeline.clients.lse_data import has_lse_data_key, stream_ticks
    from pipeline.utils.client import get_supabase, require_supabase_env

    if not has_lse_data_key():
        logger.error("LSE_API_KEY missing — cannot start live stream")
        return 1
    require_supabase_env()

    symbols = _symbols_from_env_or_universe()
    if not symbols:
        logger.error("No symbols to stream")
        return 1

    flush_sec = float(os.getenv("LSE_STREAM_FLUSH_SEC", "2.0"))
    sb = get_supabase()
    buffer: dict[str, dict] = {}
    last_flush = time.monotonic()
    ticks = 0
    flushes = 0

    logger.info(
        "=== LSE live stream start: %d symbols, flush every %.1fs ===",
        len(symbols),
        flush_sec,
    )
    logger.info("symbols: %s", ",".join(symbols[:20]) + ("…" if len(symbols) > 20 else ""))

    try:
        for tick in stream_ticks(symbols, reconnect=True):
            if _STOP:
                break
            row = tick_to_row(tick)
            if not row:
                continue
            buffer[row["symbol"]] = row
            ticks += 1
            now = time.monotonic()
            if now - last_flush >= flush_sec:
                try:
                    n = _flush(sb, buffer)
                    flushes += 1
                    logger.info(
                        "flushed %d quotes (ticks=%d flushes=%d)",
                        n,
                        ticks,
                        flushes,
                    )
                    buffer.clear()
                    last_flush = now
                except Exception:
                    logger.exception("live_quotes upsert failed")
    except Exception:
        logger.exception("stream terminated with error")
        return 1
    finally:
        if buffer:
            try:
                _flush(sb, buffer)
            except Exception:
                logger.exception("final flush failed")

    logger.info("=== LSE live stream stopped (ticks=%d) ===", ticks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
