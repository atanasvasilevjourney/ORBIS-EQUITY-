"""ATR chandelier trailing stop for LOOP (production defaults from IS/OOS grid)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from pipeline.compute.atr_risk import compute_atr

LOOP_ATR_PERIOD = 14
LOOP_ATR_MULT = 2.0


@dataclass(frozen=True)
class AtrTrailSnapshot:
    peak_price: float
    stop_price: float
    atr: float
    close: float


def _as_date_index(df: pd.DataFrame) -> pd.DataFrame:
    d = df.sort_values("date").copy() if "date" in df.columns else df.sort_index().copy()
    if "date" in d.columns:
        d = d.set_index("date")
    d.index = pd.to_datetime(d.index)
    return d


def chandelier_trail_snapshot(
    ohlcv: pd.DataFrame,
    *,
    entry_price: float,
    opened: date,
    asof: date | None = None,
    atr_period: int = LOOP_ATR_PERIOD,
    atr_mult: float = LOOP_ATR_MULT,
) -> AtrTrailSnapshot | None:
    """
    Ratchet chandelier stop from ``opened`` through latest bar (or ``asof``).
    stop = max(prior_stop, peak - atr_mult * ATR(atr_period)).
    """
    if entry_price <= 0 or ohlcv is None or ohlcv.empty:
        return None
    d = _as_date_index(ohlcv)
    if d.empty:
        return None
    idx = d.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
        d = d.copy()
        d.index = idx
    opened_ts = pd.Timestamp(opened)
    end_ts = pd.Timestamp(asof) if asof else idx[-1]
    window = d[(idx >= opened_ts) & (idx <= end_ts)]
    if window.empty:
        window = d[d.index >= opened_ts]
    if window.empty:
        return None

    peak = float(entry_price)
    stop = float(entry_price)
    atr_val = float("nan")
    close = float(window.iloc[-1]["close"])
    for i in range(len(d)):
        if d.index[i] < opened_ts:
            continue
        if d.index[i] > end_ts:
            break
        row = d.iloc[i]
        hi = float(row["high"])
        close = float(row["close"])
        peak = max(peak, hi)
        sub = d.iloc[: i + 1].reset_index(drop=True)
        atr_s = compute_atr(sub, period=atr_period)
        atr_val = float(atr_s.iloc[-1])
        if not np.isfinite(atr_val) or atr_val <= 0:
            continue
        stop = max(stop, peak - atr_mult * atr_val)

    if not np.isfinite(stop):
        stop = entry_price - atr_mult * (atr_val if np.isfinite(atr_val) else 0)
    return AtrTrailSnapshot(
        peak_price=round(peak, 4),
        stop_price=round(stop, 2),
        atr=round(atr_val, 4) if np.isfinite(atr_val) else 0.0,
        close=round(close, 2),
    )


def atr_trail_exit_signal(
    ohlcv: pd.DataFrame,
    *,
    entry_price: float,
    opened: date,
    asof: date,
    atr_period: int = LOOP_ATR_PERIOD,
    atr_mult: float = LOOP_ATR_MULT,
) -> tuple[bool, str | None, AtrTrailSnapshot | None]:
    snap = chandelier_trail_snapshot(
        ohlcv,
        entry_price=entry_price,
        opened=opened,
        asof=asof,
        atr_period=atr_period,
        atr_mult=atr_mult,
    )
    if snap is None:
        return False, None, None
    if snap.close < snap.stop_price:
        reason = (
            f"ATR({atr_period})×{atr_mult:g} trail · close {snap.close:.2f} < stop {snap.stop_price:.2f}"
        )
        return True, reason, snap
    return False, None, snap
