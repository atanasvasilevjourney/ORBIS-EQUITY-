from __future__ import annotations

from datetime import date
from typing import Any, Mapping, Sequence

import pandas as pd

from pipeline.compute.trend_radar import process_ticker
from pipeline.strategies.bars import bars_as_of
from pipeline.strategies.types import Signal


def signals(
    universe: Sequence[str],
    bars: Mapping[str, pd.DataFrame],
    as_of: date,
    params: Mapping[str, Any] | None = None,
) -> list[Signal]:
    """Momentum watchlist — on-list names as BUY, down days as SELL."""
    out: list[Signal] = []
    for sym in universe:
        raw = bars.get(sym)
        if raw is None or raw.empty:
            continue
        hist = bars_as_of(raw, as_of)
        row = process_ticker(hist)
        if row is None:
            continue
        state = int(row["state"])
        rank = int(row["quality_rank"])
        if state == 1:
            side = "BUY"
            reason = str(row.get("entry_timing") or "watchlist_on")
        elif state == -1:
            side = "SELL"
            reason = "watchlist_off"
        else:
            continue
        out.append(
            Signal(
                symbol=sym,
                side=side,
                score=float(rank),
                stop=None,
                size_hint=None,
                reason=reason,
            )
        )
    out.sort(key=lambda s: (-s.score, s.symbol))
    return out
