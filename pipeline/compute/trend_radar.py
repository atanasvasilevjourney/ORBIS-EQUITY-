"""Trend Radar compute engine — core signal layer for KovaView.

Reads prices_daily, computes five component signals per ticker, produces
a composite quality_rank (0-100) and state (GREEN/GREY/RED). Writes to
trend_radar table.

Components:
  1. z_mom   — multi-lookback momentum z-score (20/60/120d returns, z-scored)
  2. f_ewmac — EWMAC forecast (fast EMA - slow EMA, normalized by volatility)
  3. z_52    — 52-week-high proximity (0 = at high, negative = far below)
  4. breakout — compression detection (ATR contraction) + expansion trigger
  5. volume  — volume confirmation (above 20d average on up-days)

Usage:
    python -m pipeline.compute.trend_radar
"""
import logging
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logger = logging.getLogger(__name__)

# ── Signal parameters ────────────────────────────────────────────

MOM_LOOKBACKS = [20, 60, 120]       # days for momentum returns
EWMAC_FAST = 32                      # fast EMA span (equity-calibrated)
EWMAC_SLOW = 128                     # slow EMA span (equity-calibrated)
VOL_WINDOW = 20                      # rolling volatility window
ATR_WINDOW = 14                      # ATR for breakout detection
ATR_COMPRESSION_RATIO = 0.6          # current ATR / 60d ATR < this = compressed
VOLUME_CONFIRM_RATIO = 1.2           # volume / 20d avg > this = confirmed
HIGH_252_PROXIMITY_THRESHOLD = 0.95  # within 5% of 52w high = strong
MIN_HISTORY_DAYS = 145               # need enough data for momentum (120d + 20d vol + buffer)

# State thresholds
BULL_THRESHOLD = 55       # rank >= this AND net positive → GREEN
BEAR_THRESHOLD = 45       # rank <= this AND net negative → RED


def compute_momentum_z(prices: pd.Series) -> float:
    """Multi-lookback momentum z-score. Average of z-scored returns."""
    if len(prices) < max(MOM_LOOKBACKS) + VOL_WINDOW:
        return 0.0

    zscores = []
    returns_series = prices.pct_change().dropna()

    for lb in MOM_LOOKBACKS:
        if len(prices) < lb + 1:
            continue
        ret = (prices.iloc[-1] / prices.iloc[-lb - 1]) - 1
        # Use std of returns over the lookback window directly
        lb_vol = returns_series.iloc[-lb:].std()
        if lb_vol > 0:
            z = ret / (lb_vol * np.sqrt(lb))
            zscores.append(np.clip(z, -3, 3))

    return float(np.mean(zscores)) if zscores else 0.0


def compute_ewmac(prices: pd.Series) -> float:
    """EWMAC forecast: (fast_ema - slow_ema) / volatility."""
    if len(prices) < EWMAC_SLOW + VOL_WINDOW:
        return 0.0

    fast = prices.ewm(span=EWMAC_FAST, min_periods=EWMAC_FAST).mean()
    slow = prices.ewm(span=EWMAC_SLOW, min_periods=EWMAC_SLOW).mean()
    diff = fast.iloc[-1] - slow.iloc[-1]

    returns = prices.pct_change()
    vol = returns.rolling(VOL_WINDOW).std().iloc[-1]

    if vol > 0 and prices.iloc[-1] > 0:
        forecast = diff / (prices.iloc[-1] * vol)
        return float(np.clip(forecast, -3, 3))
    return 0.0


def compute_52w_proximity(prices: pd.Series) -> float:
    """How close price is to 52-week high. 0 = at high, -1 = 50% below."""
    if len(prices) < 252:
        window = prices
    else:
        window = prices.iloc[-252:]

    high_252 = window.max()
    if high_252 <= 0:
        return 0.0

    proximity = (prices.iloc[-1] / high_252) - 1  # 0 at high, negative below
    return float(np.clip(proximity, -1, 0))


def compute_breakout(prices: pd.Series, highs: pd.Series, lows: pd.Series) -> bool:
    """Detect breakout: ATR compressed then expanding + price at range high."""
    if len(prices) < 60:
        return False

    # ATR calculation
    tr = pd.concat([
        highs - lows,
        (highs - prices.shift(1)).abs(),
        (lows - prices.shift(1)).abs(),
    ], axis=1).max(axis=1)

    atr_current = tr.iloc[-ATR_WINDOW:].mean()
    atr_60d = tr.iloc[-60:].mean()

    if atr_60d <= 0:
        return False

    # Compression: current ATR much less than 60d ATR
    was_compressed = (atr_current / atr_60d) < ATR_COMPRESSION_RATIO

    # Expansion: price near 20d high
    high_20 = highs.iloc[-20:].max()
    at_range_high = prices.iloc[-1] >= high_20 * 0.98

    return was_compressed and at_range_high


def compute_volume_confirmation(
    prices: pd.Series, volumes: pd.Series
) -> bool:
    """Volume above 20d average on a positive day."""
    if len(volumes) < VOL_WINDOW + 1 or len(prices) < 2:
        return False

    avg_vol = volumes.iloc[-VOL_WINDOW - 1:-1].mean()
    if avg_vol <= 0:
        return False

    today_up = prices.iloc[-1] > prices.iloc[-2]
    vol_above = volumes.iloc[-1] > avg_vol * VOLUME_CONFIRM_RATIO

    return today_up and vol_above


def compute_quality_rank(z_mom: float, f_ewmac: float, z_52: float,
                         breakout: bool, vol_confirm: bool) -> int:
    """Composite rank 0-100 from component signals.

    Weights: momentum 30, EWMAC 25, 52w-high 20, breakout 15, volume 10.
    Continuous signals dominate; binary signals are confirmatory.
    """
    # z_mom: [-3, 3] → [0, 30]
    mom_score = ((z_mom + 3) / 6) * 30

    # f_ewmac: [-3, 3] → [0, 25]
    ewmac_score = ((f_ewmac + 3) / 6) * 25

    # z_52: [-1, 0] → [0, 20]  (0 = at high = best)
    high_score = (z_52 + 1) * 20

    # breakout: bool → 0 or 15
    brk_score = 15.0 if breakout else 0.0

    # volume: bool → 0 or 10
    vol_score = 10.0 if vol_confirm else 0.0

    raw = mom_score + ewmac_score + high_score + brk_score + vol_score
    return int(np.clip(round(raw), 0, 100))


def determine_state(z_mom: float, f_ewmac: float, z_52: float,
                    quality_rank: int) -> int:
    """Determine state: 1=GREEN, 0=GREY, -1=RED."""
    # Count positive signals
    positives = sum([
        z_mom > 0,
        f_ewmac > 0,
        z_52 > -0.10,  # within 10% of 52w high
    ])

    if quality_rank >= BULL_THRESHOLD and positives >= 2:
        return 1   # GREEN
    elif quality_rank <= BEAR_THRESHOLD and positives <= 1:
        return -1  # RED
    else:
        return 0   # GREY


def process_ticker(df: pd.DataFrame) -> dict | None:
    """Compute all signals for one ticker. df has columns: date, open, high, low, close, volume."""
    if len(df) < MIN_HISTORY_DAYS:
        return None

    df = df.sort_values("date").reset_index(drop=True)
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    volume = df["volume"].astype(float)

    z_mom = compute_momentum_z(close)
    f_ewmac = compute_ewmac(close)
    z_52 = compute_52w_proximity(close)
    breakout = compute_breakout(close, high, low)
    vol_confirm = compute_volume_confirmation(close, volume)

    rank = compute_quality_rank(z_mom, f_ewmac, z_52, breakout, vol_confirm)
    state = determine_state(z_mom, f_ewmac, z_52, rank)

    # Convergence: how many of 5 components are bullish-aligned
    # For GREY, this enables "almost-GREEN" detection in the screener
    bullish_count = sum([z_mom > 0, f_ewmac > 0, z_52 > -0.10, breakout, vol_confirm])
    if state == 1:
        convergence = bullish_count
    elif state == -1:
        convergence = sum([z_mom < 0, f_ewmac < 0, z_52 < -0.20, not breakout, not vol_confirm])
    else:
        convergence = bullish_count  # for GREY: shows how close to GREEN

    return {
        "state": state,
        "quality_rank": rank,
        "z_mom": round(z_mom, 4),
        "f_ewmac": round(f_ewmac, 4),
        "z_52": round(z_52, 4),
        "breakout_active": breakout,
        "volume_confirmed": vol_confirm,
        "convergence_count": convergence,
        "daily_state": state,
        "weekly_state": None,  # TODO: compute from weekly prices
    }


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    # Get active universe
    universe = sb.table("universe_members").select("symbol").eq("is_active", True).execute()
    symbols = [r["symbol"] for r in universe.data]
    logger.info(f"Computing Trend Radar for {len(symbols)} tickers")

    # Pre-fetch existing states to preserve state_changed_at
    existing_radar = sb.table("trend_radar").select("symbol,state,state_changed_at").execute()
    prev_state_map = {r["symbol"]: r for r in (existing_radar.data or [])}

    # Fetch prices — last 260 trading days (~1 year)
    cutoff = (date.today() - timedelta(days=400)).isoformat()
    results = []
    errors = 0

    for i, symbol in enumerate(symbols):
        try:
            resp = sb.table("prices_daily") \
                .select("date,open,high,low,close,volume") \
                .eq("symbol", symbol) \
                .gte("date", cutoff) \
                .order("date") \
                .execute()

            if not resp.data or len(resp.data) < MIN_HISTORY_DAYS:
                continue

            df = pd.DataFrame(resp.data)
            signals = process_ticker(df)
            if signals is None:
                continue

            signals["symbol"] = symbol
            # Only update state_changed_at when state actually changes
            prev = prev_state_map.get(symbol)
            if prev and prev.get("state") == signals["state"]:
                signals["state_changed_at"] = prev.get("state_changed_at", date.today().isoformat())
            else:
                signals["state_changed_at"] = date.today().isoformat()
            results.append(signals)

            if (i + 1) % 100 == 0:
                logger.info(f"  Processed {i + 1}/{len(symbols)}")

        except Exception as e:
            logger.warning(f"Error computing {symbol}: {e}")
            errors += 1

    # Batch upsert to trend_radar
    if results:
        batch_size = 200
        for j in range(0, len(results), batch_size):
            batch = results[j:j + batch_size]
            sb.table("trend_radar").upsert(batch, on_conflict="symbol").execute()

        logger.info(
            f"Trend Radar complete: {len(results)} computed, "
            f"{errors} errors, {len(symbols) - len(results) - errors} skipped (insufficient data)"
        )

    # Log summary stats
    greens = sum(1 for r in results if r["state"] == 1)
    reds = sum(1 for r in results if r["state"] == -1)
    greys = sum(1 for r in results if r["state"] == 0)
    logger.info(f"Distribution: GREEN={greens} RED={reds} GREY={greys}")

    if results:
        avg_rank = np.mean([r["quality_rank"] for r in results])
        logger.info(f"Average quality rank: {avg_rank:.1f}")


if __name__ == "__main__":
    main()
