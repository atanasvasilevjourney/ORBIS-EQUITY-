"""Transparent entry / stop / target from daily bars."""
from __future__ import annotations

import numpy as np


def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> float:
    if len(close) < period + 1:
        tr = high - low
        return float(np.nanmean(tr[-period:])) if len(tr) else 0.0
    prev = close[:-1]
    h, l, c = high[1:], low[1:], close[1:]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    atr = float(np.mean(tr[:period]))
    for x in tr[period:]:
        atr = (atr * (period - 1) + float(x)) / period
    return float(atr)


def round_px(v: float) -> float:
    av = abs(v)
    if av >= 1000:
        return round(v, 1)
    if av >= 100:
        return round(v, 2)
    if av >= 10:
        return round(v, 2)
    return round(v, 4)


def long_setup_from_bars(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    *,
    entry_mode: str = "breakout_prior_high",
    stop_atr_mult: float = 1.5,
    target_atr_mult: float = 2.0,
    atr_period: int = 14,
) -> dict[str, float] | None:
    if len(closes) < atr_period + 2:
        return None
    last = float(closes[-1])
    prior_h = float(highs[-2])
    atr = wilder_atr(highs, lows, closes, atr_period)
    if atr <= 0:
        return None
    entry = prior_h if entry_mode == "breakout_prior_high" else last
    stop = entry - stop_atr_mult * atr
    target = entry + target_atr_mult * atr
    if stop <= 0 or target <= entry:
        return None
    risk = entry - stop
    reward = target - entry
    rr = reward / risk if risk > 0 else 0.0
    return {
        "last_px": round_px(last),
        "entry_px": round_px(entry),
        "stop_px": round_px(stop),
        "target_px": round_px(target),
        "atr": round_px(atr),
        "rr": round(rr, 2),
    }
