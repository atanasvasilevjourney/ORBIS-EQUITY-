"""Module 1 — momentum watchlist screener. Does not place orders.

Scans the active universe (S&P 500 ∪ Nasdaq-100) for names already moving
with heavy volume, then ranks them by how close the close is to the session
high. Execution lives in other modules (LOOP Donchian, and so on).

This is the large-cap daily form of a high-of-day momentum scan:

  On list   day change >= +4%  AND  volume >= 2× the prior 50-day average
  Hot       day change >= +10% AND  volume >= 5× that average
  Sort      closer to the session high ranks first

The $2–$20 and <10M-share filters from small-cap day scans are not applied:
those names are not in this universe, and `prices_daily` has no share count.

Column mapping on `trend_radar` (existing schema):
  z_mom              day percent change (4.2 means +4.2%)
  f_ewmac            relative volume (today / 50-day average, shifted 1 bar)
  z_52               (close / session high) - 1   (0 = closed at the high)
  breakout_active    close within 1% of the session high
  volume_confirmed   relative volume >= 5
  quality_rank       sort score; on-list names are 70–100
  state              1 on list, 0 up but not qualified, -1 down day
  entry_timing       hot | watch | off
  convergence_count  how many of the three gates fired (day, volume, near high)

Usage:
    python -m pipeline.compute.trend_radar
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

logger = logging.getLogger(__name__)

REL_VOL_BARS = 50
MIN_HISTORY_DAYS = REL_VOL_BARS + 1  # average excludes today

WATCH_MIN_DAY_PCT = 4.0
WATCH_MIN_REL_VOLUME = 2.0
HOT_MIN_DAY_PCT = 10.0
HOT_MIN_REL_VOLUME = 5.0
NEAR_HIGH_PCT = -1.0  # within 1 percentage point of the session high


def day_percent_change(close: pd.Series) -> float:
    """Percent change from the prior close. 4.0 means +4%."""
    if len(close) < 2:
        return 0.0
    prev = float(close.iloc[-2])
    last = float(close.iloc[-1])
    if prev <= 0:
        return 0.0
    return (last / prev - 1.0) * 100.0


def relative_volume(volume: pd.Series, length: int = REL_VOL_BARS) -> float:
    """Today's volume divided by the average of the previous `length` bars.

    The current bar is excluded from the average (same as a 1-bar offset).
    """
    if len(volume) < length + 1:
        return 0.0
    prior = volume.iloc[-(length + 1):-1].astype(float)
    avg = float(prior.mean())
    today = float(volume.iloc[-1])
    if avg <= 0 or not np.isfinite(avg) or not np.isfinite(today):
        return 0.0
    return today / avg


def percent_from_high(close: pd.Series, high: pd.Series) -> float:
    """How far the close finished below the session high. 0 = at the high."""
    if len(close) < 1 or len(high) < 1:
        return 0.0
    hi = float(high.iloc[-1])
    last = float(close.iloc[-1])
    if hi <= 0:
        return 0.0
    return (last / hi - 1.0) * 100.0


def on_watchlist(day_pct: float, rel_vol: float) -> bool:
    return day_pct >= WATCH_MIN_DAY_PCT and rel_vol >= WATCH_MIN_REL_VOLUME


def is_hot(day_pct: float, rel_vol: float) -> bool:
    return day_pct >= HOT_MIN_DAY_PCT and rel_vol >= HOT_MIN_REL_VOLUME


def watch_rank(on_list: bool, pct_from_high: float, day_pct: float) -> int:
    """Higher score sorts first. On-list names occupy 70–100 by proximity to the high."""
    closeness = float(np.clip(100.0 + pct_from_high * 10.0, 0.0, 100.0))
    if on_list:
        return int(np.clip(round(70 + closeness * 0.30), 70, 100))
    if day_pct > 0:
        return int(np.clip(round(min(closeness, 69)), 1, 69))
    return int(np.clip(round(min(30.0 + day_pct, 30.0)), 0, 30))


def process_ticker(df: pd.DataFrame) -> dict | None:
    """Score one symbol. `df` columns: date, open, high, low, close, volume."""
    if len(df) < MIN_HISTORY_DAYS:
        return None

    df = df.sort_values("date").reset_index(drop=True)
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    volume = df["volume"].astype(float)

    day_pct = day_percent_change(close)
    rel_vol = relative_volume(volume)
    off_high = percent_from_high(close, high)
    listed = on_watchlist(day_pct, rel_vol)
    hot = is_hot(day_pct, rel_vol)
    near_high = off_high >= NEAR_HIGH_PCT

    if listed:
        state = 1
    elif day_pct < 0:
        state = -1
    else:
        state = 0

    if hot:
        timing = "hot"
    elif listed:
        timing = "watch"
    else:
        timing = "off"

    gates = [
        day_pct >= WATCH_MIN_DAY_PCT,
        rel_vol >= WATCH_MIN_REL_VOLUME,
        near_high,
    ]

    return {
        "state": state,
        "quality_rank": watch_rank(listed, off_high, day_pct),
        "z_mom": round(day_pct, 4),
        "f_ewmac": round(rel_vol, 4),
        "z_52": round(off_high / 100.0, 4),
        "breakout_active": bool(near_high),
        "volume_confirmed": bool(rel_vol >= HOT_MIN_REL_VOLUME),
        "kama_regime": 0,
        "adx": round(rel_vol, 2),
        "entry_timing": timing,
        "convergence_count": int(sum(gates)),
        "daily_state": state,
        "weekly_state": None,
    }


def main() -> None:
    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    from pipeline.utils.supabase import fetch_all

    universe_rows = fetch_all(
        sb,
        "universe_members",
        "symbol",
        filters=lambda q: q.eq("is_active", True),
    )
    symbols = [r["symbol"] for r in universe_rows]
    active_symbols = set(symbols)
    logger.info("Computing watchlist for %d tickers", len(symbols))

    existing_rows = fetch_all(sb, "trend_radar", "symbol,state,state_changed_at")
    prev_state_map = {r["symbol"]: r for r in existing_rows}

    cutoff = (date.today() - timedelta(days=120)).isoformat()
    all_prices: list[dict] = []
    page_size = 5000
    offset = 0
    logger.info("Fetching prices since %s...", cutoff)

    while True:
        resp = (
            sb.table("prices_daily")
            .select("symbol,date,open,high,low,close,volume")
            .gte("date", cutoff)
            .order("symbol")
            .order("date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        all_prices.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    logger.info("Fetched %d price rows, processing...", len(all_prices))

    if not all_prices:
        logger.warning("No price data found")
        return

    prices_df = pd.DataFrame(all_prices)
    prices_df = prices_df[prices_df["symbol"].isin(active_symbols)]

    results = []
    errors = 0
    grouped = prices_df.groupby("symbol")
    total_groups = len(grouped)

    for i, (symbol, df) in enumerate(grouped):
        try:
            signals = process_ticker(df)
            if signals is None:
                continue

            signals["symbol"] = symbol
            signals["computed_at"] = datetime.now(timezone.utc).isoformat()
            prev = prev_state_map.get(symbol)
            if prev and prev.get("state") == signals["state"]:
                signals["state_changed_at"] = prev.get("state_changed_at", date.today().isoformat())
            else:
                signals["state_changed_at"] = date.today().isoformat()
            results.append(signals)

            if (i + 1) % 100 == 0:
                logger.info("  Processed %d/%d symbols", i + 1, total_groups)

        except Exception as e:
            logger.warning("Error computing %s: %s", symbol, e)
            errors += 1

    if results:
        batch_size = 200
        for j in range(0, len(results), batch_size):
            batch = results[j:j + batch_size]
            try:
                sb.table("trend_radar").upsert(batch, on_conflict="symbol").execute()
            except Exception:
                logger.exception("Failed to upsert trend_radar batch %d-%d", j, j + len(batch))

        logger.info(
            "Watchlist complete: %d computed, %d errors, %d skipped (insufficient data)",
            len(results), errors, len(symbols) - len(results) - errors,
        )

    on_list = sum(1 for r in results if r["state"] == 1)
    hot = sum(1 for r in results if r["entry_timing"] == "hot")
    logger.info("Watchlist: %d on list, %d hot, %d total", on_list, hot, len(results))


if __name__ == "__main__":
    main()
