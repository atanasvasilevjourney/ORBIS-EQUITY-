"""Session-anchored VWAP from a fixed calendar date (LOOP v2 entry / stop)."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd


def typical_price_row(row: pd.Series) -> float:
    return (float(row["high"]) + float(row["low"]) + float(row["close"])) / 3.0


def anchored_vwap_series(ohlcv: pd.DataFrame, anchor_day: date) -> pd.Series:
    """Cumulative TP×volume / volume from ``anchor_day`` through each later bar."""
    if ohlcv.empty:
        return pd.Series(dtype=float)
    idx = ohlcv.index
    if not isinstance(idx, pd.DatetimeIndex):
        ohlcv = ohlcv.copy()
        ohlcv.index = pd.to_datetime(ohlcv.index)
        idx = ohlcv.index
    anchor_ts = pd.Timestamp(anchor_day)
    out = np.full(len(ohlcv), np.nan)
    cum_pv = 0.0
    cum_vol = 0.0
    started = False
    for i in range(len(ohlcv)):
        if idx[i].normalize() < anchor_ts:
            continue
        started = True
        row = ohlcv.iloc[i]
        vol = float(row.get("volume") or 0)
        if vol > 0:
            cum_pv += typical_price_row(row) * vol
            cum_vol += vol
            out[i] = cum_pv / cum_vol if cum_vol > 0 else np.nan
        elif cum_vol > 0:
            out[i] = cum_pv / cum_vol
    if not started:
        return pd.Series(out, index=ohlcv.index)
    return pd.Series(out, index=ohlcv.index)


def anchored_vwap_on_day(ohlcv: pd.DataFrame, anchor_day: date, as_of: date) -> float | None:
    """VWAP from anchor through ``as_of`` inclusive (uses that session's bar)."""
    s = anchored_vwap_series(ohlcv, anchor_day)
    ts = pd.Timestamp(as_of)
    hits = s.index.normalize() == ts
    if not hits.any():
        return None
    val = float(s.iloc[int(np.where(hits)[0][0])])
    return val if np.isfinite(val) and val > 0 else None


def lowest_low_anchor_day(ohlcv: pd.DataFrame, window_end: date, lookback: int = 55) -> date | None:
    """Calendar date of the lowest low in the ``lookback`` sessions ending on ``window_end``."""
    ts = pd.Timestamp(window_end)
    hits = ohlcv.index.normalize() <= ts
    if not hits.any():
        return None
    loc = int(np.where(hits)[0][-1])
    start = max(0, loc - lookback + 1)
    window = ohlcv.iloc[start : loc + 1]
    if window.empty:
        return None
    lows = window["low"].astype(float)
    min_loc = int(lows.values.argmin())
    row_i = start + min_loc
    return ohlcv.index[row_i].date()