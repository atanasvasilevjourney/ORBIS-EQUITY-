"""Cross-sectional relative strength for the equity book.

Trailing total return over ``lookback`` sessions, ranked as a percentile in
``[0, 100]`` versus the peer set passed in. Higher is stronger. The unique
leader is 100 and the unique laggard is 0. Ties share an average rank.

No look-ahead: pass bars already limited to the decision date, or set
``as_of`` and rows with ``date`` after that session are dropped.
Names with fewer than ``lookback + 1`` finite prices are omitted.
A one-name universe has no peers and scores 50.
"""
from __future__ import annotations

from datetime import date
from typing import Mapping

import pandas as pd

RS_LOOKBACK = 63


def trailing_total_return(close: pd.Series, lookback: int = RS_LOOKBACK) -> float | None:
    """Simple total return from ``lookback`` sessions ago to the last bar."""
    series = pd.to_numeric(close, errors="coerce").dropna()
    if lookback < 1 or len(series) < lookback + 1:
        return None
    start = float(series.iloc[-(lookback + 1)])
    end = float(series.iloc[-1])
    if start <= 0 or not pd.notna(start) or not pd.notna(end):
        return None
    return end / start - 1.0


def percentile_ranks(values: Mapping[str, float]) -> dict[str, float]:
    """Average-rank percentile in ``[0, 100]``. A single name scores 50."""
    clean = {sym: float(val) for sym, val in values.items() if pd.notna(val)}
    if not clean:
        return {}
    if len(clean) == 1:
        sym = next(iter(clean))
        return {sym: 50.0}
    ranks = pd.Series(clean, dtype=float).rank(method="average")
    span = float(len(clean) - 1)
    pct = (ranks - 1.0) / span * 100.0
    return {sym: round(float(score), 2) for sym, score in pct.items()}


def _close_through(frame: pd.DataFrame, as_of: date | None) -> pd.Series:
    if frame is None or frame.empty or "close" not in frame.columns:
        return pd.Series(dtype=float)
    view = frame
    if as_of is not None and "date" in view.columns:
        dates = pd.to_datetime(view["date"], errors="coerce")
        cutoff = pd.Timestamp(as_of)
        view = view.loc[dates <= cutoff]
    return view["close"]


def rs_percentiles_from_frames(
    frames: Mapping[str, pd.DataFrame],
    *,
    lookback: int = RS_LOOKBACK,
    as_of: date | None = None,
) -> dict[str, float]:
    """Percentile of trailing return for each symbol that has enough history."""
    returns: dict[str, float] = {}
    for sym, frame in frames.items():
        ret = trailing_total_return(_close_through(frame, as_of), lookback)
        if ret is not None:
            returns[str(sym)] = ret
    return percentile_ranks(returns)
