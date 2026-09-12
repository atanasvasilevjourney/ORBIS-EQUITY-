"""ATR-based stop distance and risk-percent position sizing (River-style).

Pure helpers for swing risk governance:
  stop_distance = ATR * multiplier
  stop_price    = entry - stop_distance  (long)
  shares        = floor(equity * risk_pct / stop_distance), capped by buying power
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

ATR_PERIOD = 14
ATR_STOP_MULTIPLIER = 2.5
RISK_PER_TRADE_PCT = 0.0125  # 1.25% of equity risked to stop


@dataclass(frozen=True)
class PositionPlan:
    shares: int
    position_value: float
    stop_price: float
    stop_distance: float
    dollar_risk: float
    rejected_reason: str | None = None


def compute_atr(df: pd.DataFrame, period: int = ATR_PERIOD) -> pd.Series:
    """Wilder-style rolling mean true range (SMA of TR, River-compatible)."""
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    close = df["close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(window=period).mean()


def stop_distance(atr: float, multiplier: float = ATR_STOP_MULTIPLIER) -> float:
    if atr is None or not math.isfinite(atr) or atr <= 0:
        return float("nan")
    return float(atr * multiplier)


def long_stop_price(entry_price: float, atr: float,
                    multiplier: float = ATR_STOP_MULTIPLIER) -> float:
    dist = stop_distance(atr, multiplier)
    if not math.isfinite(dist):
        return float("nan")
    return float(entry_price - dist)


def size_long_position(
    *,
    equity: float,
    buying_power: float,
    entry_price: float,
    atr: float,
    risk_pct: float = RISK_PER_TRADE_PCT,
    atr_mult: float = ATR_STOP_MULTIPLIER,
) -> PositionPlan:
    """ATR risk sizing for a long. Rejects invalid / zero-share plans."""
    if (
        entry_price is None
        or atr is None
        or not math.isfinite(entry_price)
        or not math.isfinite(atr)
        or entry_price <= 0
        or atr <= 0
        or equity <= 0
    ):
        return PositionPlan(0, 0.0, float("nan"), float("nan"), 0.0, "invalid candidate data")

    dist = stop_distance(atr, atr_mult)
    dollar_risk = equity * risk_pct
    shares = int(math.floor(dollar_risk / dist))
    if shares <= 0:
        return PositionPlan(0, 0.0, entry_price - dist, dist, dollar_risk, "shares rounds to zero")

    position_value = shares * entry_price
    if position_value > buying_power:
        shares = int(math.floor(buying_power / entry_price))
        if shares <= 0:
            return PositionPlan(
                0, 0.0, entry_price - dist, dist, dollar_risk, "insufficient buying power"
            )
        position_value = shares * entry_price

    return PositionPlan(
        shares=shares,
        position_value=float(position_value),
        stop_price=float(entry_price - dist),
        stop_distance=float(dist),
        dollar_risk=float(dollar_risk),
        rejected_reason=None,
    )
