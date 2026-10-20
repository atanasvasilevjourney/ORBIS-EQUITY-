"""Nightly triangle pattern scan — LOOP universe, Supabase upsert.

Usage:
    PYTHONPATH=/workspace python -m pipeline.triangle_scanner.jobs.nightly
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

import pandas as pd
from dotenv import load_dotenv

from pipeline.ema200_scanner.data.vendors.supabase_prices import load_prices_dataframe
from pipeline.triangle_scanner.config.loader import load_config
from pipeline.triangle_scanner.patterns.triangles import scan_frame
from pipeline.utils.run_recorded import run_recorded

load_dotenv()
logger = logging.getLogger(__name__)


def _universe_symbols(sb, cfg: dict) -> list[str]:
    if not cfg.get("universe", {}).get("use_loop_universe", True):
        return []
    from pipeline.utils.supabase import fetch_active_symbols

    symbols = fetch_active_symbols(sb)
    if symbols:
        return symbols
    from pipeline.ingest.us_index_universe import build_merged_universe

    stocks, _ = build_merged_universe()
    return sorted({s["symbol"] for s in stocks if s.get("symbol")})


def _load_prices(sb, symbol: str, min_bars: int) -> pd.DataFrame:
    df = load_prices_dataframe(sb, symbol)
    if df.empty:
        return pd.DataFrame()
    df = df.reset_index().rename(columns={"date": "date"})
    return df.tail(min_bars + 20)


def _run(sb, _run_id: str) -> None:
    cfg = load_config()
    min_bars = int(cfg.get("min_history_bars", 60))
    min_price = float(cfg.get("min_price", 5.0))
    max_per = int(cfg.get("max_setups_per_type", 40))
    symbols = _universe_symbols(sb, cfg)
    if not symbols:
        logger.warning("Triangle scan: empty universe")
        return
    logger.info("Triangle scan: %d symbols", len(symbols))

    as_of = date.today()
    all_rows: list[dict] = []
    for i, sym in enumerate(symbols, start=1):
        if i == 1 or i % 50 == 0 or i == len(symbols):
            logger.info("Triangle scan progress %d/%d · hits %d", i, len(symbols), len(all_rows))
        df = _load_prices(sb, sym, min_bars)
        if len(df) < min_bars:
            continue
        last_close = float(df["close"].iloc[-1])
        if last_close < min_price:
            continue
        for hit in scan_frame(df, cfg):
            geom = hit.get("geometry") or {}
            all_rows.append(
                {
                    "symbol": sym,
                    "bar_date": str(df["date"].iloc[-1].date()),
                    "pattern_type": hit["pattern_type"],
                    "status": hit["status"],
                    "score": hit["score"],
                    "close": hit["close"],
                    "support_price": hit["support_price"],
                    "resistance_price": hit["resistance_price"],
                    "resistance_slope_pct": hit.get("resistance_slope_pct_per_bar"),
                    "support_slope_pct": hit.get("support_slope_pct_per_bar"),
                    "geometry": geom,
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    # Keep top scores per pattern type (breakouts first)
    def rank_key(r: dict) -> tuple:
        status = r.get("status") or ""
        breakout = 1 if status.startswith("breakout") else 0
        return (breakout, float(r.get("score") or 0))

    kept: list[dict] = []
    for ptype in ("ascending", "descending"):
        subset = [r for r in all_rows if r["pattern_type"] == ptype]
        subset.sort(key=rank_key, reverse=True)
        kept.extend(subset[:max_per])

    headline = f"{len(kept)} triangle setups · {as_of.isoformat()}"
    sb.table("triangle_scan_runs").upsert(
        {
            "asof_date": as_of.isoformat(),
            "names": len(kept),
            "headline": headline,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="asof_date",
    ).execute()

    if kept:
        sb.table("triangle_setups").upsert(kept, on_conflict="symbol,bar_date,pattern_type").execute()

    logger.info("Triangle scan wrote %d rows · %s", len(kept), headline)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run_recorded("triangle_scanner.nightly", _run)


if __name__ == "__main__":
    main()
