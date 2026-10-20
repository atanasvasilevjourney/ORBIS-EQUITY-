from __future__ import annotations

from datetime import date
from typing import Any, Mapping, Sequence

import pandas as pd

from pipeline.compute.donchian_vwap import prior_bar_snapshot
from pipeline.strategies.bars import bars_as_of
from pipeline.strategies.types import Signal


def signals(
    universe: Sequence[str],
    bars: Mapping[str, pd.DataFrame],
    as_of: date,
    params: Mapping[str, Any] | None = None,
) -> list[Signal]:
    """Donchian 55 + 20d VWAP eligibility on the prior session (no same-bar lookahead)."""
    out: list[Signal] = []
    params = params or {}
    min_price = float(params.get("min_price", 10.0))
    for sym in universe:
        raw = bars.get(sym)
        if raw is None or raw.empty:
            continue
        hist = bars_as_of(raw, as_of)
        if len(hist) < 58:
            continue
        snap = prior_bar_snapshot(hist)
        if snap is None:
            continue
        close = float(snap["close"])
        if close < min_price:
            continue
        if snap["eligible"]:
            out.append(
                Signal(
                    symbol=sym,
                    side="BUY",
                    score=float(snap.get("strength") or 0.0),
                    stop=None,
                    size_hint=None,
                    reason="donchian55_vwap_eligible",
                )
            )
        elif snap.get("exit_signal"):
            out.append(
                Signal(
                    symbol=sym,
                    side="SELL",
                    score=0.0,
                    stop=None,
                    size_hint=None,
                    reason="donchian20_exit",
                )
            )
    out.sort(key=lambda s: (-s.score, s.symbol))
    return out
