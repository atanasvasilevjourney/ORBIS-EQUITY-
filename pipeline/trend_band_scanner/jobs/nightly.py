"""Nightly pb_ema EMA200 band pullback — daily + weekly.

Usage:
    PYTHONPATH=/workspace python -m pipeline.trend_band_scanner.jobs.nightly
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from dotenv import load_dotenv

from pipeline.ema200_scanner.data.vendors.supabase_prices import load_prices_dataframe
from pipeline.trend_band_scanner.config.loader import load_config
from pipeline.trend_band_scanner.data.universe import load_scan_universe
from pipeline.trend_band_scanner.indicators.band import resample_to_weekly
from pipeline.trend_band_scanner.signals.pullback import scan_frame
from pipeline.utils.run_recorded import run_recorded

load_dotenv()
logger = logging.getLogger(__name__)


def _load_daily(sb, symbol: str, warmup: int) -> "pd.DataFrame":
    import pandas as pd

    df = load_prices_dataframe(sb, symbol)
    if df.empty:
        return pd.DataFrame()
    df = df.reset_index().rename(columns={"date": "date"})
    return df.tail(warmup + 40)


def _run(sb, _run_id: str) -> None:
    cfg = load_config()
    warmup = int(cfg.get("ema_warmup_daily_bars", 1260))
    min_price = float((cfg.get("filters") or {}).get("min_price", 5.0))
    max_per = int((cfg.get("scan") or {}).get("max_setups_per_tf", 50))
    timeframes = [str(t) for t in (cfg.get("timeframes") or ["1d", "1wk"])]

    universe = load_scan_universe(sb)
    if not universe:
        logger.warning("Trend-band scan: empty universe")
        return
    logger.info("Trend-band scan: %d symbols · timeframes %s", len(universe), timeframes)

    as_of = date.today()
    hits: list[dict] = []
    skipped_weekly = 0

    for i, entry in enumerate(universe, start=1):
        sym = entry["symbol"]
        asset_class = entry.get("asset_class") or "equity"
        if i == 1 or i % 50 == 0 or i == len(universe):
            logger.info("Trend-band %d/%d · hits %d", i, len(universe), len(hits))

        daily = _load_daily(sb, sym, warmup)
        if daily.empty or float(daily["close"].iloc[-1]) < min_price:
            continue

        for tf in timeframes:
            if tf == "1d":
                frame = daily
            elif tf == "1wk":
                frame = resample_to_weekly(daily)
                if len(frame) < int(cfg.get("weekly_history_min_bars", 220)):
                    skipped_weekly += 1
                    continue
            else:
                continue

            hit = scan_frame(frame, cfg, timeframe=tf)  # type: ignore[arg-type]
            if not hit:
                continue
            bar_date = str(frame["date"].iloc[-1])[:10]
            hits.append(
                {
                    "symbol": sym,
                    "bar_date": bar_date,
                    "timeframe": tf,
                    "asset_class": asset_class,
                    "setup_kind": hit["setup_kind"],
                    "score": hit["score"],
                    "close": hit["close"],
                    "band_lo": hit["band_lo"],
                    "band_hi": hit["band_hi"],
                    "ema200_high": hit["ema200_high"],
                    "ema200_low": hit["ema200_low"],
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

    by_sym: dict[str, set[str]] = {}
    for h in hits:
        by_sym.setdefault(h["symbol"], set()).add(h["timeframe"])
    dual_bonus = float((cfg.get("scan") or {}).get("dual_timeframe_bonus", 12))
    for h in hits:
        if len(by_sym.get(h["symbol"], set())) >= 2:
            h["score"] = float(h["score"] or 0) + dual_bonus
            h["dual_timeframe"] = True
        else:
            h["dual_timeframe"] = False

    hits.sort(key=lambda r: float(r.get("score") or 0), reverse=True)
    kept = hits[: max_per * len(timeframes)]
    headline = f"{len(kept)} pb_ema pullbacks (D+W) · weekly_skip={skipped_weekly} · {as_of.isoformat()}"

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
    run_recorded("trend_band_scanner", lambda sb, _rec: _run(sb, ""))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()