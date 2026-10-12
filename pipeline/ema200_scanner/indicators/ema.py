"""EMA with TradingView/Pine-compatible seeding (SMA seed, then recursive EMA)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema_pine(close: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average matching Pine ``ta.ema`` seeding.

    First value is SMA over the first ``period`` bars at index ``period - 1``.
    Earlier indices are NaN.
    """
    x = np.asarray(close, dtype=float).ravel()
    n = x.size
    out = np.full(n, np.nan, dtype=float)
    if period <= 0 or n < period:
        return out

    alpha = 2.0 / (period + 1.0)
    out[period - 1] = float(np.nanmean(x[:period]))
    for i in range(period, n):
        prev = out[i - 1]
        out[i] = alpha * float(x[i]) + (1.0 - alpha) * prev
    return out


def ema_series(close: pd.Series | np.ndarray, period: int) -> pd.Series:
    """Vectorized EMA as a Series aligned to ``close`` index."""
    if isinstance(close, pd.Series):
        idx = close.index
        arr = close.to_numpy(dtype=float)
    else:
        arr = np.asarray(close, dtype=float)
        idx = pd.RangeIndex(len(arr))
    vals = ema_pine(arr, period)
    return pd.Series(vals, index=idx, name=f"ema{period}")


def apply_trust_window(
    ema: pd.Series,
    *,
    history_min_bars: int,
) -> pd.Series:
    """Mask EMA values until ``history_min_bars`` completed bars exist."""
    trusted = ema.copy()
    if history_min_bars <= 0:
        return trusted
    # Require bar index >= history_min_bars - 1 (0-based)
    trusted.iloc[: max(0, history_min_bars - 1)] = np.nan
    return trusted
