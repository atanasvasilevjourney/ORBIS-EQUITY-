"""PB-EMA style double 200 EMA: close line + high line (TradingView ribbon)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def ribbon_bounds(ema_close: pd.Series, ema_high: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Lower / upper edges of the stacked ribbon (min/max of close & high EMA200)."""
    lo = np.minimum(ema_close.astype(float), ema_high.astype(float))
    hi = np.maximum(ema_close.astype(float), ema_high.astype(float))
    return lo, hi


def ribbon_distance(close: pd.Series, ema_close: pd.Series, ema_high: pd.Series) -> pd.Series:
    """Dollars from close to nearest point inside [ribbon_lo, ribbon_hi]."""
    lo, hi = ribbon_bounds(ema_close, ema_high)
    c = close.astype(float)
    below = (c < lo) * (lo - c)
    above = (c > hi) * (c - hi)
    inside = ((c >= lo) & (c <= hi)) * 0.0
    return below + above + inside


def ribbon_dist_atr(
    close: pd.Series,
    ema_close: pd.Series,
    ema_high: pd.Series,
    atr: pd.Series,
) -> pd.Series:
    """Distance to the double EMA ribbon, in ATR14 units (watchlist proximity)."""
    dist = ribbon_distance(close, ema_close, ema_high)
    return dist / atr.replace(0, np.nan)
