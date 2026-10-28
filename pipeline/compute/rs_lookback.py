"""Research grid for the XS residual lookback.

Production constants stay at ``RS_LOOKBACK`` / ``RS_SKIP_RECENT`` until
``evaluate_rs_lookbacks`` returns a winner whose neighbors agree. This module
does not write those constants. Donchian LOOP is a separate book.
"""
from __future__ import annotations

from typing import Mapping

import numpy as np
import pandas as pd

from pipeline.compute.param_stability import StabilitySelection, annualized_sharpe, evaluate_param_grid
from pipeline.compute.relative_strength import RS_LOOKBACK, RS_SKIP_RECENT, rs_percentiles_from_frames

LOOKBACKS = (42, 63, 126)
SKIPS = (0, 21)


def production_params() -> dict[str, float]:
    return {"lookback": float(RS_LOOKBACK), "skip_recent": float(RS_SKIP_RECENT)}


def lookback_grid() -> list[dict[str, float]]:
    return [
        {"lookback": float(lookback), "skip_recent": float(skip)}
        for lookback in LOOKBACKS
        for skip in SKIPS
    ]


def _frames(closes: pd.DataFrame) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for symbol in closes.columns:
        series = closes[symbol]
        frames[str(symbol)] = pd.DataFrame({"date": series.index, "close": series.to_numpy()})
    return frames


def score_panel(
    closes: pd.DataFrame,
    sectors: Mapping[str, str],
    *,
    lookback: int,
    skip_recent: int,
) -> dict[str, float]:
    """Sector-residual percentiles using only rows already on ``closes``."""
    return rs_percentiles_from_frames(
        _frames(closes),
        lookback=lookback,
        skip_recent=skip_recent,
        sectors=sectors,
    )


def sleeve_returns(
    closes: pd.DataFrame,
    sectors: Mapping[str, str],
    *,
    lookback: int,
    skip_recent: int,
    top_n: int = 4,
    rebalance_every: int = 5,
) -> np.ndarray:
    """Close-to-close returns of an equal-weight residual book.

    The basket at the close of day ``t`` earns the return from ``t`` to
    ``t+1``. Formation uses rows through ``t`` only.
    """
    if closes.empty or len(closes) < 2:
        return np.array([])
    held: list[str] = []
    last_i = -10**9
    out: list[float] = []
    for i in range(len(closes) - 1):
        if i - last_i >= rebalance_every and i + 1 >= lookback + skip_recent + 1:
            scores = score_panel(
                closes.iloc[: i + 1],
                sectors,
                lookback=lookback,
                skip_recent=skip_recent,
            )
            ranked = sorted(scores, key=lambda sym: (-scores[sym], sym))
            held = ranked[:top_n]
            last_i = i
        if not held:
            out.append(0.0)
            continue
        day: list[float] = []
        for sym in held:
            prev = float(closes[sym].iloc[i])
            nxt = float(closes[sym].iloc[i + 1])
            if prev > 0 and np.isfinite(prev) and np.isfinite(nxt):
                day.append(nxt / prev - 1.0)
        out.append(float(np.mean(day)) if day else 0.0)
    return np.asarray(out, dtype=float)


def evaluate_rs_lookbacks(
    closes: pd.DataFrame,
    sectors: Mapping[str, str],
    *,
    split: float = 0.6,
    top_n: int = 4,
) -> StabilitySelection:
    """Score the global lookback grid. A missing winner means keep production."""
    full_cache: dict[tuple[int, int], np.ndarray] = {}

    def _returns(lookback: int, skip_recent: int) -> np.ndarray:
        key = (lookback, skip_recent)
        if key not in full_cache:
            full_cache[key] = sleeve_returns(
                closes,
                sectors,
                lookback=lookback,
                skip_recent=skip_recent,
                top_n=top_n,
            )
        return full_cache[key]

    cut = int(len(closes) * split)

    def eval_fn(params: Mapping[str, float]) -> tuple[float, float]:
        series = _returns(int(params["lookback"]), int(params["skip_recent"]))
        # ``series`` has one entry per gap between closes, so it is shorter
        # than the price index by one. Split on that return index.
        pivot = max(1, min(len(series) - 1, cut))
        return annualized_sharpe(series[:pivot]), annualized_sharpe(series[pivot:])

    return evaluate_param_grid(lookback_grid(), eval_fn, n_neighbors=2)
