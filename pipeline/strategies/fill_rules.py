"""Documented fill rules for LOOP / Donchian+VWAP backtests and paper book.

Rules (long-only, US equities)
------------------------------
**Signals** use data through the **prior session close** (no same-bar lookahead on entries).

**Entries** (new BUY): signal at close *t* → fill at **open *t+1*** (return leg: prior close → open on
fill day, then open → close for remainder of fill day when simulating full-day P&L).

**Held overnight**: mark from **close *t-1* → close *t***.

**ATR / Donchian exits decided on close *t***: still held at day open → P&L leg is
**close *t-1* → close *t*** (EOD stop). If **open *t* < prior stop** (gap through), exit at
**open *t*** with leg **close *t-1* → open *t***.

**Rebalance rotate-out** (dropped from basket, decided prior close): exit at **open *t***,
leg **close *t-1* → open *t***.

**Sizing**: each position uses a fixed slot weight ``1 / top_n`` of portfolio equity; unfilled slots
stay in **cash** (0% return) — no re-leverage across remaining names after an exit.

**Costs**: charged on turnover (entries + exits) via ``CostModel`` (default 10 bps/side).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable

import pandas as pd

from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS
from pipeline.strategies.execution import _loc_on, symbol_day_return, turnover_cost_fraction


def gap_stop_return(ohlcv: pd.DataFrame, d: date) -> float | None:
    """Overnight leg close(t-1) → open(t) for a gap exit at the open."""
    loc = _loc_on(ohlcv, d)
    if loc is None or loc == 0:
        return None
    prev_c = float(ohlcv.iloc[loc - 1]["close"])
    op = float(ohlcv.iloc[loc]["open"])
    if prev_c <= 0:
        return None
    return op / prev_c - 1.0


def rotate_out_return(ohlcv: pd.DataFrame, d: date) -> float:
    """Rotate-out at open(t): close(t-1) → open(t)."""
    r = gap_stop_return(ohlcv, d)
    return r if r is not None else 0.0


@dataclass(frozen=True)
class DayReturnLeg:
    symbol: str
    weight: float
    return_: float
    leg_type: str


def slot_weight(top_n: int) -> float:
    return 1.0 / max(top_n, 1)


def portfolio_pnl_day(
    panels: dict[str, pd.DataFrame],
    d: date,
    *,
    start_symbols: Iterable[str],
    end_symbols: Iterable[str],
    stop_close_exits: Iterable[str],
    stop_gap_exits: Iterable[str],
    rotated_out: Iterable[str],
    new_entries: Iterable[str],
    top_n: int,
    cost: CostModel | None = DEFAULT_LOOP_COSTS,
) -> tuple[float, list[DayReturnLeg]]:
    """
  Compose the day's portfolio return with fixed slot weights (no re-leverage).

  ``stop_gap_exits``: symbols stopped at open(t) because open < prior stop.
  ``stop_close_exits``: symbols stopped on close(t) (EOD trail / Donchian).
  """
    w = slot_weight(top_n)
    start = set(start_symbols)
    end = set(end_symbols)
    gap_set = set(stop_gap_exits)
    close_stop_set = set(stop_close_exits)
    rot_set = set(rotated_out)
    new_set = set(new_entries)

    legs: list[DayReturnLeg] = []
    invested = 0.0

    for sym in start:
        ohlcv = panels.get(sym)
        if ohlcv is None:
            continue
        if sym in gap_set:
            r = gap_stop_return(ohlcv, d) or 0.0
            legs.append(DayReturnLeg(sym, w, r, "stop_gap_open"))
            invested += w
        elif sym in close_stop_set:
            r = symbol_day_return(ohlcv, d, entry_mode="close") or 0.0
            legs.append(DayReturnLeg(sym, w, r, "stop_close"))
            invested += w
        elif sym in rot_set:
            r = rotate_out_return(ohlcv, d)
            legs.append(DayReturnLeg(sym, w, r, "rotate_open"))
            invested += w
        elif sym in end and sym not in new_set:
            r = symbol_day_return(ohlcv, d, entry_mode="close") or 0.0
            legs.append(DayReturnLeg(sym, w, r, "hold"))
            invested += w

    for sym in new_set:
        ohlcv = panels.get(sym)
        if ohlcv is None:
            continue
        loc = _loc_on(ohlcv, d)
        if loc is None or loc == 0:
            continue
        op = float(ohlcv.iloc[loc]["open"])
        cl = float(ohlcv.iloc[loc]["close"])
        if op <= 0:
            continue
        r = cl / op - 1.0
        legs.append(DayReturnLeg(sym, w, r, "entry_open_to_close"))
        invested += w

    if not legs:
        day_ret = 0.0
    else:
        day_ret = sum(leg.weight * leg.return_ for leg in legs)
    if cost is not None:
        day_ret -= turnover_cost_fraction(start, end, cost)
    return day_ret, legs