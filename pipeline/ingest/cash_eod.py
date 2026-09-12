"""Cash-market EOD ingest — public REST into ``prices_daily``.

Same *shape* as QMIE's scanner ingest (closed bars, public REST,
provider fallback, ~300-bar lookback). Different *venue*: listed
cash equities via Yahoo → Stooq, not Binance/Bybit/OKX perps.

Replaces ``seed_demo`` synthetic tape for names that land a real series.

Usage:
    python -m pipeline.ingest.cash_eod
    CASH_EOD_BARS=300 CASH_EOD_LIMIT=20 python -m pipeline.ingest.cash_eod
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date, datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.clients.cash_eod import (
    DEFAULT_BARS,
    SLEEP_SEC,
    bars_to_rows,
    fetch_daily_bars,
)
from pipeline.config.settings import SupabaseConfig
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")

logger = logging.getLogger(__name__)

REAL_SOURCES = ("yahoo", "stooq", "yfinance", "lse")
SEED_SOURCE = "seed_demo"


def _sb() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(cfg.url, cfg.service_key)


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _count_real_bars(sb: Client, symbol: str) -> int:
    rows = fetch_all(
        sb,
        "prices_daily",
        "date,source",
        filters=lambda q: q.eq("symbol", symbol).in_("source", list(REAL_SOURCES)),
    )
    return len(rows)


def _delete_seed_rows(sb: Client, symbol: str) -> None:
    try:
        sb.table("prices_daily").delete().eq("symbol", symbol).eq("source", SEED_SOURCE).execute()
    except Exception:
        logger.warning("Could not drop seed_demo rows for %s", symbol, exc_info=True)


def _upsert_prices(sb: Client, rows: list[dict]) -> int:
    upserted = 0
    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        sb.table("prices_daily").upsert(batch, on_conflict="symbol,date").execute()
        upserted += len(batch)
    return upserted


def _write_run(
    sb: Client,
    *,
    run_id: str,
    started: datetime,
    ok: int,
    fail: int,
    rows: int,
    sources: dict[str, int],
    bars: int,
    headline: str,
) -> None:
    payload = {
        "run_id": run_id,
        "module": "cash_eod",
        "started_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "asof_date": date.today().isoformat(),
        "symbols_ok": ok,
        "symbols_fail": fail,
        "rows_upserted": rows,
        "source": ",".join(f"{k}:{v}" for k, v in sorted(sources.items())) or None,
        "headline": headline,
        "config": {"bars": bars, "providers": ["yahoo", "stooq"]},
    }
    try:
        sb.table("ingest_runs").upsert(payload, on_conflict="run_id").execute()
    except Exception:
        logger.warning("ingest_runs write skipped (apply migration 020)", exc_info=True)


def fetch_members(sb: Client, limit: int | None = None) -> list[dict]:
    members = fetch_all(
        sb,
        "universe_members",
        "symbol, country, data_source, is_active",
        filters=lambda q: q.eq("is_active", True),
        order=("symbol", False),
    )
    if limit and limit > 0:
        return members[:limit]
    return members


def ingest_symbol(
    sb: Client,
    symbol: str,
    *,
    country: str | None,
    bars: int,
    min_real: int,
    sleep_s: float,
    replace_seed: bool,
) -> tuple[int, str]:
    """Fetch and upsert one name. Returns (rows, source)."""
    existing = _count_real_bars(sb, symbol)
    want = 10 if existing >= min_real else bars
    series, source = fetch_daily_bars(symbol, country=country, bars=want, sleep_s=0.0)
    rows = bars_to_rows(series)
    if not rows:
        raise RuntimeError("no rows after close filter")
    if replace_seed:
        _delete_seed_rows(sb, symbol)
    n = _upsert_prices(sb, rows)
    if sleep_s:
        time.sleep(sleep_s)
    return n, source


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    bars = _int_env("CASH_EOD_BARS", DEFAULT_BARS)
    min_real = _int_env("CASH_EOD_MIN_BARS", 200)
    limit = _int_env("CASH_EOD_LIMIT", 0)
    sleep_s = _float_env("CASH_EOD_SLEEP", SLEEP_SEC)
    replace_seed = os.getenv("CASH_EOD_KEEP_SEED", "").strip() not in ("1", "true", "yes")

    started = datetime.now(timezone.utc)
    run_id = f"eod-{started.strftime('%Y%m%d-%H%M%S')}"
    logger.info("=== Cash EOD ingest %s · bars=%d ===", run_id, bars)

    sb = _sb()
    members = fetch_members(sb, limit=limit or None)
    if not members:
        logger.error("No active universe members — seed or sync universe first.")
        return

    ok = 0
    fail = 0
    rows_n = 0
    sources: dict[str, int] = {}
    failures: list[str] = []

    for idx, m in enumerate(members, 1):
        symbol = (m.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        try:
            n, source = ingest_symbol(
                sb,
                symbol,
                country=m.get("country"),
                bars=bars,
                min_real=min_real,
                sleep_s=sleep_s,
                replace_seed=replace_seed,
            )
            ok += 1
            rows_n += n
            sources[source] = sources.get(source, 0) + 1
            if m.get("data_source") == SEED_SOURCE:
                try:
                    sb.table("universe_members").update({"data_source": source}).eq(
                        "symbol", symbol
                    ).execute()
                except Exception:
                    logger.debug("data_source update skipped for %s", symbol)
            logger.info(
                "[%d/%d] %s %s %d bars", idx, len(members), symbol, source, n
            )
        except Exception as exc:
            fail += 1
            failures.append(symbol)
            logger.warning("[%d/%d] %s failed: %s", idx, len(members), symbol, exc)

    headline = (
        f"{ok} ok / {fail} fail · {rows_n} rows · "
        + ", ".join(f"{k}={v}" for k, v in sorted(sources.items()))
    )
    logger.info("=== Cash EOD complete: %s ===", headline)
    if failures:
        logger.info("Failed: %s", ", ".join(failures[:40]))
    _write_run(
        sb,
        run_id=run_id,
        started=started,
        ok=ok,
        fail=fail,
        rows=rows_n,
        sources=sources,
        bars=bars,
        headline=headline,
    )


if __name__ == "__main__":
    main()
