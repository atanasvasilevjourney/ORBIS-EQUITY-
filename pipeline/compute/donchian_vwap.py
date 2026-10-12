"""Donchian channel + rolling VWAP — LOOP production signal layer."""
from __future__ import annotations

import numpy as np
import pandas as pd

ENTRY_CHANNEL = 55
EXIT_CHANNEL = 20
VWAP_WINDOW = 20
TOP_N = 8
MAX_PER_SECTOR = 2
REBALANCE_DAYS = 5
EQUITY = 100_000.0
MAX_NAME_PCT = 1.0 / TOP_N  # equal weight
MIN_PRICE = 10.0
MIN_NOTIONAL = 500.0


def rolling_vwap(df: pd.DataFrame, window: int = VWAP_WINDOW) -> pd.Series:
    tp = (df["high"].astype(float) + df["low"].astype(float) + df["close"].astype(float)) / 3.0
    vol = df["volume"].astype(float).replace(0, np.nan)
    num = (tp * vol).rolling(window, min_periods=window).sum()
    den = vol.rolling(window, min_periods=window).sum()
    return num / den


def donchian_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Daily Donchian + VWAP columns indexed like input (date index or sorted by date)."""
    d = df.sort_values("date").copy() if "date" in df.columns else df.copy()
    if "date" in d.columns:
        d = d.set_index("date")
    high = d["high"].astype(float)
    low = d["low"].astype(float)
    close = d["close"].astype(float)
    upper = high.rolling(ENTRY_CHANNEL, min_periods=ENTRY_CHANNEL).max().shift(1)
    lower = low.rolling(EXIT_CHANNEL, min_periods=EXIT_CHANNEL).min().shift(1)
    vwap = rolling_vwap(d)
    eligible = (close > upper) & (close > vwap) & (close >= MIN_PRICE)
    exit_signal = close < lower
    strength = (close / upper.replace(0, np.nan) - 1.0).clip(lower=0).fillna(0)
    return pd.DataFrame(
        {
            "close": close,
            "upper": upper,
            "lower": lower,
            "vwap": vwap,
            "eligible": eligible,
            "exit_signal": exit_signal,
            "strength": strength,
        },
        index=d.index,
    )


def latest_snapshot(df: pd.DataFrame) -> dict | None:
    """Most recent bar signals from OHLCV rows (Supabase-style with date column)."""
    if df.empty or len(df) < ENTRY_CHANNEL + 2:
        return None
    frame = donchian_frame(df)
    row = frame.iloc[-1]
    if pd.isna(row["upper"]):
        return None
    return {
        "close": float(row["close"]),
        "upper": float(row["upper"]) if np.isfinite(row["upper"]) else None,
        "lower": float(row["lower"]) if np.isfinite(row["lower"]) else None,
        "vwap": float(row["vwap"]) if np.isfinite(row["vwap"]) else None,
        "eligible": bool(row["eligible"]),
        "exit_signal": bool(row["exit_signal"]),
        "strength": float(row["strength"]),
        "above_vwap": float(row["close"]) > float(row["vwap"]) if np.isfinite(row["vwap"]) else False,
    }


def prior_bar_snapshot(df: pd.DataFrame) -> dict | None:
    """Prior session (t−1) for rebalance eligibility without same-bar lookahead."""
    if df.empty or len(df) < ENTRY_CHANNEL + 3:
        return None
    frame = donchian_frame(df)
    row = frame.iloc[-2]
    if pd.isna(row["upper"]):
        return None
    return {
        "close": float(row["close"]),
        "upper": float(row["upper"]) if np.isfinite(row["upper"]) else None,
        "lower": float(row["lower"]) if np.isfinite(row["lower"]) else None,
        "vwap": float(row["vwap"]) if np.isfinite(row["vwap"]) else None,
        "eligible": bool(row["eligible"]),
        "exit_signal": bool(row["exit_signal"]),
        "strength": float(row["strength"]),
        "above_vwap": float(row["close"]) > float(row["vwap"]) if np.isfinite(row["vwap"]) else False,
    }
