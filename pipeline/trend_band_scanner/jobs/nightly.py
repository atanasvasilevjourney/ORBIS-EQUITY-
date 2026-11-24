"""Nightly trend-band pullback scan.

Usage:
    PYTHONPATH=/workspace python -m pipeline.trend_band_scanner.jobs.nightly
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from dotenv import load_dotenv

from pipeline.ema200_scanner.data.vendors.supabase_prices import load_prices_dataframe
from pipeline.trend_band_scanner.config.loader import load_config
from pipeline.trend_band_scanner.signals.pullback import scan_frame
from pipeline.utils.run_recorded import run_recorded

load_dotenv()
logger = logging.getLogger(__name__)


def _universe_symbols(sb, cfg: dict) -> list[str]:
    symbols: list[str] = []
    if cfg.get("universe", {}).get("use_loop_universe", True):
        from pipeline.utils.supabase import fetch_active_symbols

        symbols = list(fetch_active_symbols(sb))
    if not symbols:
        from pipeline.ingest.us_index_universe import build_merged_universe

        stocks, _ = build_merged_universe()
        symbols = sorted({s["symbol"] for s in stocks if s.get("symbol")})
    supplements = [str(s).upper() for s in (cfg.get("universe", {}).get("supplements") or []) if s]
    return sorted(set(symbols) | set(supplements))


def _load_prices(sb, symbol: str, min_bars: int) -> "pd.DataFrame":
    import pandas as pd

    df = load_prices_dataframe(sb, symbol)
    if df.empty:
        return pd.DataFrame()
    df = df.reset_index().rename(columns={"date": "date"})
    return df.tail(min_bars + 120)


def _run(sb, _run_id: str) -> None:
    cfg = load_config()
    min_bars = int((cfg.get("filters") or {}).get("min_history_bars", 80))
    min_price = float((cfg.get("filters") or {}).get("min_price", 5.0))
    max_setups = int((cfg.get("scan") or {}).get("max_setups", 60))

    symbols = _universe_symbols(sb, cfg)
    if not symbols:
        logger.warning("Trend-band scan: empty universe")
        return
    logger.info("Trend-band scan: %d symbols", len(symbols))

    as_of = date.today()
    hits: list[dict] = []
    for i, sym in enumerate(symbols, start=1):
        if i == 1 or i % 50 == 0 or i == len(symbols):
            logger.info("Trend-band progress %d/%d · hits %d", i, len(symbols), len(hits))
        df = _load_prices(sb, sym, min_bars)
        if len(df) < min_bars:
            continue
        if float(df["close"].iloc[-1]) < min_price:
            continue
        hit = scan_frame(df, cfg)
        if not hit:
            continue
        hits.append(
            {
                "symbol": sym,
                "bar_date": str(df["date"].iloc[-1].date() if hasattr(df["date"].iloc[-1], "date") else df["date"].iloc[-1])[:10],
                "setup_kind": hit["setup_kind"],
                "score": hit["score"],
                "close": hit["close"],
                "band_lo": hit["band_lo"],
                "band_hi": hit["band_hi"],
                "invalidation": hit["invalidation"],
                "dist_to_band_pct": hit["dist_to_band_pct"],
                "pullback_pct": hit["pullback_pct"],
                "advance_pct": hit["advance_pct"],
                "band_slope_pct": hit["band_slope_pct"],
                "band_color": hit["band_color"],
                "band_flip": hit["band_flip"],
                "days_since_flip": hit.get("days_since_flip"),
                "spark": hit.get("spark"),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    hits.sort(key=lambda r: float(r.get("score") or 0), reverse=True)
    kept = hits[:max_setups]
    headline = f"{len(kept)} trend-band pullbacks · {as_of.isoformat()}"

    sb.table("trend_band_scan_runs").upsert(
        {
            "asof_date": as_of.isoformat(),
            "names": len(kept),
            "headline": headline,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()

    if kept:
        sb.table("trend_band_setups").upsert(kept).execute()

    logger.info("Trend-band scan done: %d setups", len(kept))


def main() -> None:
    from pipeline.utils.supabase import service_client

    sb = service_client()
    run_recorded(sb, "trend_band_scanner", _run)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()