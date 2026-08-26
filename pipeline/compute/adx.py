"""Wilder ADX / DI helpers for trend-strength gating.

Used as a soft quality_rank component and a GREEN gate (ADX must show
directional trend, not chop). Defaults match common swing thresholds
(ADX ≥ 20 trending, ≥ 25 strong).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

ADX_PERIOD = 14
ADX_TREND_MIN = 20.0
ADX_STRONG = 25.0


def _rma(series: pd.Series, period: int) -> pd.Series:
    """Wilder / RMA smoothing (EMA with alpha = 1/period)."""
    return series.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()


def compute_adx_frame(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = ADX_PERIOD,
) -> pd.DataFrame:
    """Return DataFrame with plus_di, minus_di, adx columns."""
    high = high.astype(float)
    low = low.astype(float)
    close = close.astype(float)

    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(
        np.where((up > down) & (up > 0), up, 0.0), index=high.index, dtype=float
    )
    minus_dm = pd.Series(
        np.where((down > up) & (down > 0), down, 0.0), index=high.index, dtype=float
    )

    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)

    atr = _rma(tr, period)
    plus_di = 100.0 * _rma(plus_dm, period) / atr.replace(0, np.nan)
    minus_di = 100.0 * _rma(minus_dm, period) / atr.replace(0, np.nan)
    dx = (100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    adx = _rma(dx, period)

    return pd.DataFrame(
        {
            "plus_di": plus_di.fillna(0.0),
            "minus_di": minus_di.fillna(0.0),
            "adx": adx.fillna(0.0),
        },
        index=high.index,
    )


def latest_adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = ADX_PERIOD,
) -> tuple[float, float, float]:
    """Return (adx, plus_di, minus_di) for the last bar."""
    frame = compute_adx_frame(high, low, close, period)
    if frame.empty:
        return 0.0, 0.0, 0.0
    last = frame.iloc[-1]
    return float(last["adx"]), float(last["plus_di"]), float(last["minus_di"])


def adx_score(adx: float, plus_di: float, minus_di: float) -> float:
    """Map ADX / DI into 0–8 quality points (bullish DI required for full credit)."""
    if not np.isfinite(adx):
        return 0.0
    bullish_di = plus_di > minus_di
    if adx >= ADX_STRONG and bullish_di:
        return 8.0
    if adx >= ADX_TREND_MIN and bullish_di:
        return 5.0
    if adx >= ADX_TREND_MIN:
        return 2.0
    return 0.0


def adx_ok(adx: float, plus_di: float, minus_di: float,
           min_adx: float = ADX_TREND_MIN) -> bool:
    """True when trend strength is present and DI+ leads DI-."""
    return (
        np.isfinite(adx)
        and adx >= min_adx
        and plus_di > minus_di
    )
