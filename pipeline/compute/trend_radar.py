"""Trend Radar compute engine — core signal layer for Orbis Equity.

Reads prices_daily, computes component signals per ticker, produces
a composite quality_rank (0-100) and state (GREEN/GREY/RED). Writes to
trend_radar table.

Components:
  1. z_mom   — multi-lookback momentum z-score (20/60/120d returns, z-scored)
  2. f_ewmac — EWMAC forecast (fast EMA - slow EMA, normalized by volatility)
  3. z_52    — 52-week-high proximity (0 = at high, negative = far below)
  4. breakout — compression detection (ATR contraction) + expansion trigger
  5. volume  — volume confirmation (above 20d average on up-days)
  6. kama_regime — dual-KAMA trend regime (stability-promoted global params)
  7. adx     — Wilder ADX / DI+ trend-strength gate (swing-screener)

Entry timing vetoes (too_late / wait_pullback) demote extended GREEN names.

Parameter changes (EWMAC spans, KAMA defaults, thresholds) must pass
pipeline.compute.param_stability before promotion to production constants.

Usage:
    python -m pipeline.compute.trend_radar
"""
import logging
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from pipeline.compute.adx import (
    ADX_TREND_MIN,
    adx_ok,
    adx_score,
    latest_adx,
)
from pipeline.compute.entry_timing import evaluate_entry_timing
from pipeline.compute.kama_regime import compute_kama_regime

logger = logging.getLogger(__name__)

# ── Signal parameters ────────────────────────────────────────────
# Promote changes only after param_stability.score_candidates clears them.

MOM_LOOKBACKS = [20, 60, 120]       # days for momentum returns
EWMAC_FAST = 32                      # fast EMA span (equity-calibrated)
EWMAC_SLOW = 128                     # slow EMA span (equity-calibrated)
VOL_WINDOW = 20                      # rolling volatility window
ATR_WINDOW = 14                      # ATR for breakout detection
ATR_COMPRESSION_RATIO = 0.6          # current ATR / 60d ATR < this = compressed
VOLUME_CONFIRM_RATIO = 1.2           # volume / 20d avg > this = confirmed
HIGH_252_PROXIMITY_THRESHOLD = 0.95  # within 5% of 52w high = strong
MIN_HISTORY_DAYS = 148               # EWMAC_SLOW(128) + VOL_WINDOW(20) = 148
CONVERGENCE_MAX = 7                  # mom, ewmac, 52w, breakout, vol, kama, adx

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


def compute_quality_rank(
    z_mom: float,
    f_ewmac: float,
    z_52: float,
    breakout: bool,
    vol_confirm: bool,
    kama_regime: int = 0,
    adx: float = 0.0,
    plus_di: float = 0.0,
    minus_di: float = 0.0,
) -> int:
    """Composite rank 0-100 from component signals.

    Weights: momentum 24, EWMAC 20, 52w-high 16, breakout 12, volume 8,
    dual-KAMA regime 12, ADX 8. Continuous signals dominate; regime/ADX confirm.
    """
    # z_mom: [-3, 3] → [0, 24]
    mom_score = ((z_mom + 3) / 6) * 24

    # f_ewmac: [-3, 3] → [0, 20]
    ewmac_score = ((f_ewmac + 3) / 6) * 20

    # z_52: [-1, 0] → [0, 16]  (0 = at high = best)
    high_score = (z_52 + 1) * 16

    # breakout: bool → 0 or 12
    brk_score = 12.0 if breakout else 0.0

    # volume: bool → 0 or 8
    vol_score = 8.0 if vol_confirm else 0.0

    # dual-KAMA regime: bullish 12, unknown 6, bearish 0
    if kama_regime > 0:
        kama_score = 12.0
    elif kama_regime < 0:
        kama_score = 0.0
    else:
        kama_score = 6.0

    a_score = adx_score(adx, plus_di, minus_di)

    raw = (
        mom_score + ewmac_score + high_score + brk_score
        + vol_score + kama_score + a_score
    )
    return int(np.clip(round(raw), 0, 100))


def determine_state(
    z_mom: float,
    f_ewmac: float,
    z_52: float,
    quality_rank: int,
    kama_regime: int = 0,
    *,
    adx_trend_ok: bool = True,
    too_late: bool = False,
) -> int:
    """Determine state: 1=GREEN, 0=GREY, -1=RED.

    Dual-KAMA is a soft regime gate: GREEN requires non-bearish KAMA.
    ADX must show bullish trend strength; too_late demotes GREEN → GREY.
    """
    positives = sum([
        z_mom > 0,
        f_ewmac > 0,
        z_52 > -0.10,  # within 10% of 52w high
    ])

    if (
        quality_rank >= BULL_THRESHOLD
        and positives >= 2
        and kama_regime >= 0
        and adx_trend_ok
        and not too_late
    ):
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
    breakout = bool(compute_breakout(close, high, low))
    vol_confirm = bool(compute_volume_confirmation(close, volume))
    kama_regime = int(compute_kama_regime(close))
    adx_val, plus_di, minus_di = latest_adx(high, low, close)
    trend_ok = adx_ok(adx_val, plus_di, minus_di, ADX_TREND_MIN)
    timing = evaluate_entry_timing(close, high, low)

    rank = compute_quality_rank(
        z_mom, f_ewmac, z_52, breakout, vol_confirm, kama_regime,
        adx_val, plus_di, minus_di,
    )
    state = determine_state(
        z_mom, f_ewmac, z_52, rank, kama_regime,
        adx_trend_ok=trend_ok,
        too_late=timing.is_too_late,
    )

    # Convergence: how many components are directionally aligned
    bullish_flags = [
        z_mom > 0,
        f_ewmac > 0,
        z_52 > -0.10,
        breakout,
        vol_confirm,
        kama_regime > 0,
        trend_ok,
    ]
    bullish_count = sum(bullish_flags)
    if state == 1:
        convergence = bullish_count
    elif state == -1:
        convergence = sum([
            z_mom < 0,
            f_ewmac < 0,
            z_52 < -0.20,
            not breakout,
            not vol_confirm,
            kama_regime < 0,
            not trend_ok,
        ])
    else:
        convergence = bullish_count  # for GREY: shows how close to GREEN

    return {
        "state": state,
        "quality_rank": rank,
        "z_mom": round(z_mom, 4),
        "f_ewmac": round(f_ewmac, 4),
        "z_52": round(z_52, 4),
        "breakout_active": bool(breakout),
        "volume_confirmed": bool(vol_confirm),
        "kama_regime": kama_regime,
        "adx": round(adx_val, 2),
        "entry_timing": timing.label,
        "convergence_count": int(convergence),
        "daily_state": state,
        "weekly_state": None,  # TODO: compute from weekly prices
    }


def main() -> None:
    from dotenv import load_dotenv

    from pipeline.utils.client import get_supabase
    from pipeline.utils.supabase import fetch_all

    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    sb = get_supabase()

    # Get active universe

    universe_rows = fetch_all(
        sb,
        "universe_members",
        "symbol",
        filters=lambda q: q.eq("is_active", True),
    )
    symbols = [r["symbol"] for r in universe_rows]
    active_symbols = set(symbols)
    logger.info("Computing Trend Radar for %d tickers", len(symbols))

    # Pre-fetch existing states to preserve state_changed_at
    existing_rows = fetch_all(sb, "trend_radar", "symbol,state,state_changed_at")
    prev_state_map = {r["symbol"]: r for r in existing_rows}

    # Bulk fetch ALL prices since cutoff with pagination (instead of N+1 per-symbol queries)
    cutoff = (date.today() - timedelta(days=400)).isoformat()
    all_prices: list[dict] = []
    page_size = 5000
    offset = 0
    logger.info("Fetching all prices since %s...", cutoff)

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
    # Filter to active universe symbols only
    prices_df = prices_df[prices_df["symbol"].isin(active_symbols)]

    results = []
    errors = 0
    grouped = prices_df.groupby("symbol")
    total_groups = len(grouped)

    for i, (symbol, df) in enumerate(grouped):
        try:
            if len(df) < MIN_HISTORY_DAYS:
                continue

            signals = process_ticker(df)
            if signals is None:
                continue

            signals["symbol"] = symbol
            signals["computed_at"] = datetime.now(timezone.utc).isoformat()
            # Only update state_changed_at when state actually changes
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

    # Batch upsert to trend_radar
    if results:
        batch_size = 200
        for j in range(0, len(results), batch_size):
            batch = results[j:j + batch_size]
            try:
                sb.table("trend_radar").upsert(batch, on_conflict="symbol").execute()
            except Exception:
                logger.exception("Failed to upsert trend_radar batch %d-%d", j, j + len(batch))

        logger.info(
            "Trend Radar complete: %d computed, %d errors, %d skipped (insufficient data)",
            len(results), errors, len(symbols) - len(results) - errors,
        )

    # Log summary stats
    greens = sum(1 for r in results if r["state"] == 1)
    reds = sum(1 for r in results if r["state"] == -1)
    greys = sum(1 for r in results if r["state"] == 0)
    logger.info("Distribution: GREEN=%d RED=%d GREY=%d", greens, reds, greys)

    if results:
        avg_rank = np.mean([r["quality_rank"] for r in results])
        logger.info("Average quality rank: %.1f", avg_rank)


if __name__ == "__main__":
    main()
