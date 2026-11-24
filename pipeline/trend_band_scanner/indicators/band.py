"""pb_ema band: EMA200(high) upper, EMA200(low) lower — shares ema200_scanner seeding."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.ema200_scanner.indicators.ema import apply_trust_window, ema_series


def compute_pb_ema_band_frame(
    ohlcv: pd.DataFrame,
    *,
    ema_period: int = 200,
    history_min_bars: int = 200,
    slope_lookback: int = 20,
    min_band_slope_pct: float = 0.0,
) -> pd.DataFrame:
    """Band edges from EMA200 of high/low on the bar series (daily or weekly)."""
    df = ohlcv.sort_index().copy() if isinstance(ohlcv.index, pd.DatetimeIndex) else ohlcv.copy()
    if "close" not in df.columns:
        raise ValueError("ohlcv needs OHLC columns")
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    close = df["close"].astype(float)

    ema_hi_raw = ema_series(high, ema_period)
    ema_lo_raw = ema_series(low, ema_period)
    ema_hi = apply_trust_window(ema_hi_raw, history_min_bars=history_min_bars)
    ema_lo = apply_trust_window(ema_lo_raw, history_min_bars=history_min_bars)
    mid = (ema_hi.astype(float) + ema_lo.astype(float)) / 2.0

    lag = mid.shift(slope_lookback)
    slope_pct = (mid - lag) / lag.replace(0, np.nan) * 100.0
    rising = slope_pct >= min_band_slope_pct
    color = np.where(rising, "green", "red")

    flip_age = _days_since_rising_flip(rising)

    return pd.DataFrame(
        {
            "close": close,
            "ema200_high": ema_hi,
            "ema200_low": ema_lo,
            "band_hi": ema_hi,
            "band_lo": ema_lo,
            "band_mid": mid,
            "band_rising": rising,
            "band_color": pd.Series(color, index=df.index),
            "band_slope_pct": slope_pct,
            "days_since_flip": flip_age,
        },
        index=df.index,
    )


def _days_since_rising_flip(rising: pd.Series) -> pd.Series:
    out = pd.Series(np.nan, index=rising.index, dtype=float)
    last_flip: int | None = None
    for i in range(len(rising)):
        if i > 0 and bool(rising.iloc[i]) and not bool(rising.iloc[i - 1]):
            last_flip = i
        if bool(rising.iloc[i]) and last_flip is not None:
            out.iloc[i] = float(i - last_flip)
    return out


def resample_to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Friday week-end OHLCV from daily (or any dense series)."""
    if "date" in df.columns:
        idx = pd.to_datetime(df["date"])
        work = df.set_index(idx)
    else:
        work = df.copy()
    weekly = work.resample("W-FRI").agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    )
    weekly = weekly.dropna(subset=["close"]).reset_index()
    if weekly.columns[0] != "date":
        weekly = weekly.rename(columns={weekly.columns[0]: "date"})
    return weekly