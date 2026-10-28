"""Cross-sectional relative strength for the equity book.

The production score is a sector residual: trailing total return minus the
equal-weight return of the other names in the same sector, over ``lookback``
sessions. A shared market benchmark does not change rank when every name is
measured on the same dates, so SPY is used only to force a common calendar.

Percentiles sit in ``[0, 100]``. The unique leader is 100 and the unique
laggard is 0. Ties share an average rank.

No look-ahead: pass bars already limited to the decision date, or set
``as_of`` and rows with ``date`` after that session are dropped.
``skip_recent`` drops the last N sessions (the 12-minus-1 research grid).
Names with fewer than ``lookback + skip_recent + 1`` finite prices are omitted.
A one-name sector has no residual and is omitted. A one-name percentile
universe scores 50.
"""
from __future__ import annotations

from datetime import date
from typing import Mapping

import numpy as np
import pandas as pd

RS_LOOKBACK = 63
RS_SKIP_RECENT = 0


def window_return(
    close: pd.Series,
    lookback: int = RS_LOOKBACK,
    skip_recent: int = RS_SKIP_RECENT,
) -> float | None:
    """Total return ending ``skip_recent`` sessions before the last bar."""
    series = pd.to_numeric(close, errors="coerce").dropna()
    if lookback < 1 or skip_recent < 0 or len(series) < lookback + skip_recent + 1:
        return None
    end = float(series.iloc[-1 - skip_recent])
    start = float(series.iloc[-1 - skip_recent - lookback])
    if start <= 0 or not pd.notna(start) or not pd.notna(end):
        return None
    return end / start - 1.0


def trailing_total_return(close: pd.Series, lookback: int = RS_LOOKBACK) -> float | None:
    """Simple total return from ``lookback`` sessions ago to the last bar."""
    return window_return(close, lookback, 0)


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


def sector_residual_returns(
    returns: Mapping[str, float],
    sectors: Mapping[str, str],
) -> dict[str, float]:
    """Name return minus the equal-weight return of its sector.

    Sectors with a single scored name are omitted. There is no peer to be
    relative to.
    """
    grouped: dict[str, list[tuple[str, float]]] = {}
    for sym, ret in returns.items():
        if ret is None or not pd.notna(ret):
            continue
        sec = sectors.get(sym) or "Unknown"
        grouped.setdefault(sec, []).append((str(sym), float(ret)))
    out: dict[str, float] = {}
    for members in grouped.values():
        if len(members) < 2:
            continue
        baseline = float(np.mean([ret for _, ret in members]))
        for sym, ret in members:
            out[sym] = ret - baseline
    return out


def _close_series(frame: pd.DataFrame | None, as_of: date | None) -> pd.Series:
    if frame is None or frame.empty or "close" not in frame.columns:
        return pd.Series(dtype=float)
    view = frame
    if as_of is not None and "date" in view.columns:
        dates = pd.to_datetime(view["date"], errors="coerce")
        view = view.loc[dates <= pd.Timestamp(as_of)]
    close = pd.to_numeric(view["close"], errors="coerce")
    if "date" not in view.columns:
        return close.dropna()
    idx = pd.to_datetime(view["date"], errors="coerce")
    out = pd.Series(close.to_numpy(), index=idx)
    out = out[out.index.notna()].sort_index()
    return out[~out.index.duplicated(keep="last")].dropna()


def _name_return(
    series: pd.Series,
    benchmark: pd.Series | None,
    lookback: int,
    skip_recent: int,
) -> float | None:
    if benchmark is None or benchmark.empty:
        return window_return(series, lookback, skip_recent)
    aligned = pd.concat(
        [series.rename("asset"), benchmark.rename("bench")],
        axis=1,
        join="inner",
    ).dropna()
    if aligned.empty:
        return None
    asset_ret = window_return(aligned["asset"], lookback, skip_recent)
    bench_ret = window_return(aligned["bench"], lookback, skip_recent)
    if asset_ret is None or bench_ret is None:
        return None
    return asset_ret - bench_ret


def rs_percentiles_from_frames(
    frames: Mapping[str, pd.DataFrame],
    *,
    lookback: int = RS_LOOKBACK,
    skip_recent: int = RS_SKIP_RECENT,
    as_of: date | None = None,
    benchmark: pd.DataFrame | None = None,
    sectors: Mapping[str, str] | None = None,
) -> dict[str, float]:
    """Percentile rank of residual strength.

    With ``sectors``, the ranked value is the sector residual. A benchmark
    frame (SPY) aligns calendars and subtracts the market before that residual,
    which does not by itself reorder names that share the same dates.
    """
    bench_series = _close_series(benchmark, as_of) if benchmark is not None else None
    returns: dict[str, float] = {}
    for sym, frame in frames.items():
        ret = _name_return(_close_series(frame, as_of), bench_series, lookback, skip_recent)
        if ret is not None:
            returns[str(sym)] = ret
    if sectors:
        returns = sector_residual_returns(returns, sectors)
    return percentile_ranks(returns)
