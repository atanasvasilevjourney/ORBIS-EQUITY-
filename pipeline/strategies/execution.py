from __future__ import annotations

from datetime import date
from typing import Iterable

import pandas as pd

from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS


def _loc_on(ohlcv: pd.DataFrame, d: date) -> int | None:
    import numpy as np

    ts = pd.Timestamp(d)
    hits = ohlcv.index.normalize() == ts
    if not hits.any():
        return None
    return int(np.where(hits)[0][0])


def symbol_day_return(
    ohlcv: pd.DataFrame,
    d: date,
    *,
    entry_mode: str,
) -> float | None:
    """``entry_mode``: ``open`` (new position) or ``close`` (held overnight)."""
    loc = _loc_on(ohlcv, d)
    if loc is None or loc == 0:
        return None
    row = ohlcv.iloc[loc]
    prev = ohlcv.iloc[loc - 1]
    if entry_mode == "open":
        base = float(row["open"])
    else:
        base = float(prev["close"])
    close = float(row["close"])
    if base <= 0:
        return None
    return close / base - 1.0


def turnover_cost_fraction(
    prev_symbols: Iterable[str],
    new_symbols: Iterable[str],
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> float:
    prev = set(prev_symbols)
    new = set(new_symbols)
    if not prev and not new:
        return 0.0
    entered = new - prev
    exited = prev - new
    n_new = max(len(new), 1)
    n_prev = max(len(prev), 1)
    traded = len(entered) / n_new + len(exited) / n_prev
    return traded * cost.bps_per_side / 10_000.0


def equal_weight_portfolio_return(
    panels: dict[str, pd.DataFrame],
    d: date,
    holdings: list[str],
    *,
    prev_holdings: list[str] | None = None,
    cost: CostModel | None = DEFAULT_LOOP_COSTS,
) -> float:
    """Daily return for an equal-weight book with next-open entry for new names."""
    if not holdings:
        return 0.0
    prev = set(prev_holdings or [])
    entered = set(holdings) - prev
    parts: list[float] = []
    for sym in holdings:
        ohlcv = panels.get(sym)
        if ohlcv is None:
            continue
        mode = "open" if sym in entered else "close"
        r = symbol_day_return(ohlcv, d, entry_mode=mode)
        if r is not None:
            parts.append(r)
    if not parts:
        return 0.0
    gross = float(sum(parts) / len(parts))
    if cost is None:
        return gross
    return gross - turnover_cost_fraction(prev, holdings, cost)
