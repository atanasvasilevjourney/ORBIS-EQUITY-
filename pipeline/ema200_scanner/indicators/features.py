"""Nightly feature columns for the EMA200 scanner (vectorized, no lookahead)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.compute.atr_risk import compute_atr
from pipeline.ema200_scanner.indicators.ema import apply_trust_window, ema_series


def _days_above(close: pd.Series, ema: pd.Series) -> pd.Series:
    """Consecutive prior closes strictly above EMA (excludes current bar)."""
    above = (close.shift(1) > ema.shift(1)).astype(float)
    groups = (~above.astype(bool)).cumsum()
    streak = above.groupby(groups).cumsum()
    return streak.fillna(0).astype(int)


def compute_regime(benchmark_close: pd.Series, ema_period: int, history_min_bars: int) -> pd.Series:
    """``bull`` when benchmark close >= its EMA200; else ``bear``."""
    ema = apply_trust_window(
        ema_series(benchmark_close, ema_period),
        history_min_bars=history_min_bars,
    )
    regime = np.where(
        benchmark_close >= ema,
        "bull",
        "bear",
    )
    out = pd.Series(regime, index=benchmark_close.index, name="regime")
    out[ema.isna()] = None
    return out


def compute_features_frame(
    ohlcv: pd.DataFrame,
    *,
    ema_period: int,
    atr_period: int,
    history_min_bars: int,
    slope_lookback: int,
    regime: str | None = None,
) -> pd.DataFrame:
    """Build feature columns for one symbol. Uses only data through each bar close."""
    df = ohlcv.sort_index().copy()
    close = df["close"].astype(float)
    ema_raw = ema_series(close, ema_period)
    ema = apply_trust_window(ema_raw, history_min_bars=history_min_bars)

    atr = compute_atr(df, period=atr_period)
    vol_sma = df["volume"].astype(float).rolling(20, min_periods=20).mean()
    rvol = df["volume"].astype(float) / vol_sma.replace(0, np.nan)

    ema_lag = ema.shift(slope_lookback)
    slope = (ema - ema_lag) / ema_lag.replace(0, np.nan)

    dist_atr = (close - ema) / atr.replace(0, np.nan)
    days_above = _days_above(close, ema)

    out = pd.DataFrame(
        {
            "close": close,
            "ema200": ema,
            "ema200_slope": slope,
            "atr14": atr,
            "dist_atr": dist_atr,
            "rvol": rvol,
            "days_above": days_above,
            "regime": regime,
        },
        index=df.index,
    )
    return out
