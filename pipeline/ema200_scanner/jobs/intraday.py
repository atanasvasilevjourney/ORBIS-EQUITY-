"""Phase 3 intraday scan — daily watchlist + 5m reclaim / at-ribbon triggers.

Usage:
    PYTHONPATH=/workspace python -m pipeline.ema200_scanner.jobs.intraday
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.config.settings import SupabaseConfig
from pipeline.ema200_scanner.config.loader import config_hash, load_config
from pipeline.ema200_scanner.data.session import drop_incomplete_cash_bar
from pipeline.ema200_scanner.data.vendors.supabase_prices import load_prices_dataframe
from pipeline.ema200_scanner.data.vendors.yahoo_intraday import fetch_yahoo_intraday
from pipeline.ema200_scanner.signals.daily_on_intraday import attach_daily_ema200_step
from pipeline.ema200_scanner.signals.intraday_trigger import (
    detect_intraday_triggers,
    phase3_config,
    triggers_to_event_rows,
)
from pipeline.ema200_scanner.watchlist import classify_setup
from pipeline.utils.supabase import fetch_all

load_dotenv()
logger = logging.getLogger(__name__)


def _sb() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(cfg.url, cfg.service_key)


def _latest_features_by_symbol(sb: Client) -> dict[str, dict]:
    rows = fetch_all(
        sb,
        "ema200_features",
        "symbol, bar_date, close, ema200, ema200_high, dist_atr, ribbon_dist_atr, days_above, ema200_slope, rvol, regime",
    )
    out: dict[str, dict] = {}
    for r in rows:
        sym = r.get("symbol")
        if not sym:
            continue
        prev = out.get(sym)
        if prev is None or str(r.get("bar_date", "")) > str(prev.get("bar_date", "")):
            out[sym] = r
    return out


def run_intraday(*, sb: Client | None = None) -> dict:
    cfg = load_config()
    p3 = phase3_config(cfg)
    if not p3.get("enabled", True):
        logger.info("Phase 3 disabled in config")
        return {"skipped": True}

    sb = sb or _sb()
    t0 = time.monotonic()
    max_syms = int((cfg.get("phase3") or {}).get("max_symbols_per_run", 80))
    latest = _latest_features_by_symbol(sb)
    shortlist: list[tuple[str, dict]] = []
    for sym, row in latest.items():
        setup = classify_setup(row, cfg=cfg)
        if setup in ("RETRACE_HELD", "AT_EMA_HELD", "NEAR_EMA"):
            shortlist.append((sym, row))
    shortlist.sort(key=lambda x: abs(float(x[1].get("ribbon_dist_atr") or x[1].get("dist_atr") or 99)))
    shortlist = shortlist[:max_syms]

    event_rows: list[dict] = []
    state_rows: list[dict] = []
    errors = 0

    for sym, feat in shortlist:
        try:
            daily = load_prices_dataframe(sb, sym)
            if daily.empty or len(daily) < int(cfg["history_min_bars"]):
                continue
            bars, _meta = fetch_yahoo_intraday(
                sym,
                interval=str(p3["interval"]),
                range_param=str(p3["range"]),
            )
            bars = drop_incomplete_cash_bar(bars)
            if len(bars) < 20:
                continue
            merged = attach_daily_ema200_step(bars, daily)
            setup = classify_setup(feat, cfg=cfg)
            if p3.get("require_daily_watchlist") and setup is None:
                continue
            triggers = detect_intraday_triggers(
                sym,
                merged,
                daily_setup=setup,
                cfg=cfg,
                live_last_bar_only=True,
            )
            event_rows.extend(triggers_to_event_rows(triggers))
            if triggers:
                best = max(triggers, key=lambda t: t.score)
                state_rows.append(
                    {
                        "symbol": sym,
                        "state": best.trigger_type,
                        "last_alert_date": best.session_date,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
        except Exception:
            logger.warning("Phase3 intraday failed for %s", sym, exc_info=True)
            errors += 1

    upserted = 0
    for i in range(0, len(event_rows), 200):
        batch = event_rows[i : i + 200]
        sb.table("ema200_events").upsert(batch, on_conflict="symbol,event_type,bar_date").execute()
        upserted += len(batch)

    for i in range(0, len(state_rows), 200):
        sb.table("ema200_state").upsert(state_rows[i : i + 200], on_conflict="symbol").execute()

    finished = datetime.now(timezone.utc)
    headline = f"ema200 phase3 triggers={upserted} shortlist={len(shortlist)} errors={errors}"
    try:
        sb.table("ingest_runs").upsert(
            {
                "run_id": str(uuid.uuid4()),
                "module": "ema200_scanner.intraday",
                "started_at": finished.isoformat(),
                "finished_at": finished.isoformat(),
                "symbols_ok": len(shortlist) - errors,
                "symbols_fail": errors,
                "rows_upserted": upserted,
                "source": "yahoo_5m+prices_daily",
                "headline": headline,
                "config": {"hash": config_hash(cfg), "phase": 3},
            },
            on_conflict="run_id",
        ).execute()
    except Exception:
        logger.debug("ingest_runs log skipped", exc_info=True)

    elapsed = time.monotonic() - t0
    logger.info("=== EMA200 Phase 3 complete in %.1fs: %s ===", elapsed, headline)
    return {
        "shortlist": len(shortlist),
        "triggers_upserted": upserted,
        "errors": errors,
        "elapsed_sec": elapsed,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    if os.getenv("EMA200_DRY_RUN") == "1":
        logger.info("EMA200_DRY_RUN=1 — skipping Supabase writes")
        return
    run_intraday()


if __name__ == "__main__":
    main()
