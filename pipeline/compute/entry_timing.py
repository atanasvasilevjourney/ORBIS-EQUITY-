"""Entry timing vetoes — too-late / wait-pullback (from swing-screener).

Blocks chasing extended names after radar has already gone GREEN.
Pure OHLC helpers; no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

TimingLabel = Literal["ok", "wait_pullback", "too_late"]

# Hard block (too late)
MAX_RUNUP_BLOCK = 0.50          # >50% off 50d low
MAX_PRICE_TO_MA20_BLOCK = 0.12  # >12% above MA20
RSI_EXHAUST = 75.0
STOCH_EXHAUST = 85.0

# Soft wait (prefer pullback)
MAX_RUNUP_WAIT = 0.30           # >30% off 50d low
MAX_PRICE_TO_MA20_WAIT = 0.06   # >6% above MA20
RSI_OVERBOUGHT = 70.0
STOCH_OVERBOUGHT = 80.0

RUNUP_LOOKBACK = 50
MA20 = 20
RSI_PERIOD = 14
STOCH_PERIOD = 14


@dataclass(frozen=True)
class TimingResult:
    label: TimingLabel
    reason: str
    runup_50d: float
    price_to_ma20_pct: float
    rsi: float
    stoch_k: float

    @property
    def is_too_late(self) -> bool:
        return self.label == "too_late"

    @property
    def should_wait(self) -> bool:
        return self.label == "wait_pullback"


def _rsi(close: pd.Series, period: int = RSI_PERIOD) -> float:
    if len(close) < period + 1:
        return 50.0
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain.iloc[-1] / avg_loss.iloc[-1] if avg_loss.iloc[-1] > 0 else np.inf
    if not np.isfinite(rs):
        return 100.0
    return float(100.0 - (100.0 / (1.0 + rs)))


def _stoch_k(high: pd.Series, low: pd.Series, close: pd.Series,
             period: int = STOCH_PERIOD) -> float:
    if len(close) < period:
        return 50.0
    hh = high.iloc[-period:].max()
    ll = low.iloc[-period:].min()
    if hh <= ll:
        return 50.0
    return float(100.0 * (close.iloc[-1] - ll) / (hh - ll))


def _runup_from_low(close: pd.Series, lookback: int = RUNUP_LOOKBACK) -> float:
    window = close.iloc[-lookback:] if len(close) >= lookback else close
    low = float(window.min())
    if low <= 0:
        return 0.0
    return float(close.iloc[-1] / low - 1.0)


def _price_to_ma20_pct(close: pd.Series) -> float:
    if len(close) < MA20:
        return 0.0
    ma = float(close.iloc[-MA20:].mean())
    if ma <= 0:
        return 0.0
    return float(close.iloc[-1] / ma - 1.0)


def evaluate_entry_timing(
    close: pd.Series,
    high: pd.Series,
    low: pd.Series,
) -> TimingResult:
    """Classify entry timing: ok / wait_pullback / too_late."""
    runup = _runup_from_low(close)
    ext = _price_to_ma20_pct(close)
    rsi = _rsi(close)
    stoch = _stoch_k(high, low, close)

    # Hard blocks first
    if runup > MAX_RUNUP_BLOCK:
        return TimingResult(
            "too_late",
            f"runup {runup:.0%} from 50d low",
            runup, ext, rsi, stoch,
        )
    if ext > MAX_PRICE_TO_MA20_BLOCK:
        return TimingResult(
            "too_late",
            f"price {ext:.0%} above MA20",
            runup, ext, rsi, stoch,
        )
    if rsi >= RSI_EXHAUST and stoch >= STOCH_EXHAUST:
        return TimingResult(
            "too_late",
            f"momentum exhaustion RSI {rsi:.0f} / Stoch {stoch:.0f}",
            runup, ext, rsi, stoch,
        )

    # Soft wait
    reasons: list[str] = []
    if runup > MAX_RUNUP_WAIT:
        reasons.append(f"runup {runup:.0%}")
    if ext > MAX_PRICE_TO_MA20_WAIT:
        reasons.append(f"{ext:.0%} above MA20")
    if rsi >= RSI_OVERBOUGHT:
        reasons.append(f"RSI {rsi:.0f}")
    if stoch >= STOCH_OVERBOUGHT:
        reasons.append(f"Stoch {stoch:.0f}")

    if reasons:
        return TimingResult(
            "wait_pullback",
            "; ".join(reasons),
            runup, ext, rsi, stoch,
        )

    return TimingResult("ok", "", runup, ext, rsi, stoch)
