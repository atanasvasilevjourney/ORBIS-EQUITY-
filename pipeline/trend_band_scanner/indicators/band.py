"""Two-EMA trend band: 20/50 cloud with rising vs falling state and recent flips."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.ema200_scanner.indicators.ema import ema_series


def band_edges(ema_fast: pd.Series, ema_slow: pd.Series) -> tuple[pd.Series, pd.Series]:
    lo = np.minimum(ema_fast.astype(float), ema_slow.astype(float))
    hi = np.maximum(ema_fast.astype(float), ema_slow.astype(float))
    return pd.Series(lo, index=ema_fast.index), pd.Series(hi, index=ema_fast.index)


def mid_band(lo: pd.Series, hi: pd.Series) -> pd.Series:
    return (lo.astype(float) + hi.astype(float)) / 2.0


def band_rising(mid: pd.Series, lookback: int, min_slope_pct: float) -> pd.Series:
    """True when mid-band rose at least ``min_slope_pct`` over ``lookback`` bars."""
    lag = mid.shift(lookback)
    pct = (mid - lag) / lag.replace(0, np.nan) * 100.0
    return pct >= min_slope_pct


def band_color(rising: pd.Series, fast: pd.Series, slow: pd.Series) -> pd.Series:
    """``green`` rising support stack; ``red`` falling / bearish stack."""
    stack = fast >= slow
    color = np.where(rising & stack, "green", np.where(~rising, "red", "amber"))
    return pd.Series(color, index=rising.index)


def days_since_flip(rising: pd.Series) -> pd.Series:
    """Sessions since the band last flipped from not-rising to rising (NaN if never)."""
    was = rising.shift(1).fillna(False).astype(bool)
    flip = rising.astype(bool) & ~was
    out = pd.Series(np.nan, index=rising.index, dtype=float)
    last_flip_idx: int | None = None
    for i in range(len(rising)):
        if flip.iloc[i]:
            last_flip_idx = i
        if last_flip_idx is not None and rising.iloc[i]:
            out.iloc[i] = float(i - last_flip_idx)
        elif not rising.iloc[i]:
            out.iloc[i] = np.nan
    return out


def compute_band_frame(
    close: pd.Series,
    *,
    ema_fast: int = 20,
    ema_slow: int = 50,
    slope_lookback: int = 5,
    min_band_slope_pct: float = 0.02,
) -> pd.DataFrame:
    fast = ema_series(close, ema_fast)
    slow = ema_series(close, ema_slow)
    lo, hi = band_edges(fast, slow)
    mid = mid_band(lo, hi)
    rising = band_rising(mid, slope_lookback, min_band_slope_pct)
    color = band_color(rising, fast, slow)
    flip_age = days_since_flip(rising)
    return pd.DataFrame(
        {
            "ema_fast": fast,
            "ema_slow": slow,
            "band_lo": lo,
            "band_hi": hi,
            "band_mid": mid,
            "band_rising": rising,
            "band_color": color,
            "days_since_flip": flip_age,
        },
        index=close.index,
    )