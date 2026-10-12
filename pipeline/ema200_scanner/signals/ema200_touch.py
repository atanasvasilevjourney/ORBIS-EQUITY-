"""Pure touch / breakdown detection from OHLCV + config params (no I/O)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

from pipeline.ema200_scanner.indicators.features import compute_features_frame

EventType = Literal["TOUCH_BOUNCE", "BREAKDOWN"]


@dataclass(frozen=True)
class TouchParams:
    ema_period: int = 200
    atr_period: int = 14
    history_min_bars: int = 500
    slope_lookback: int = 20
    min_days_above: int = 20
    min_slope: float = 0.0
    touch_tolerance_atr: float = 0.25


def detect_events(
    ohlcv: pd.DataFrame,
    params: TouchParams,
    *,
    regime_series: pd.Series | None = None,
) -> pd.DataFrame:
    """Return one row per bar with flags and ``event_type`` when set."""
    ohlcv = ohlcv.sort_index()
    regime_val = None
    if regime_series is not None and not regime_series.empty:
        regime_val = regime_series.reindex(ohlcv.index).ffill()

    feat = compute_features_frame(
        ohlcv,
        ema_period=params.ema_period,
        atr_period=params.atr_period,
        history_min_bars=params.history_min_bars,
        slope_lookback=params.slope_lookback,
        regime=None,
    )
    if regime_val is not None:
        feat["regime"] = regime_val.astype(object)

    low = ohlcv["low"].astype(float)
    close = ohlcv["close"].astype(float)
    ema = feat["ema200"]
    atr = feat["atr14"]

    touch_band = ema + params.touch_tolerance_atr * atr
    touched = low <= touch_band
    held = close >= ema
    broke = close < ema

    trend_ok = (feat["days_above"] >= params.min_days_above) & (
        feat["ema200_slope"] > params.min_slope
    )
    valid = ema.notna() & atr.notna() & (atr > 0)

    bounce = valid & trend_ok & touched & held
    breakdown = valid & trend_ok & touched & broke

    event_type = pd.Series(None, index=ohlcv.index, dtype=object)
    event_type.loc[bounce] = "TOUCH_BOUNCE"
    event_type.loc[breakdown & ~bounce] = "BREAKDOWN"

    out = feat.copy()
    out["low"] = low
    out["touch_band"] = touch_band
    out["event_type"] = event_type
    out["is_touch_bounce"] = bounce
    out["is_breakdown"] = breakdown & ~bounce
    return out


def events_only(events: pd.DataFrame, event_type: EventType = "TOUCH_BOUNCE") -> pd.DataFrame:
    mask = events["event_type"] == event_type
    return events.loc[mask].copy()
