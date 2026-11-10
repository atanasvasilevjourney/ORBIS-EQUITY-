"""Fully funded equal-weight hold.

This is the book that made money on the 2010–2026 nine-name panel. The TEMA
swing and the TEMA-MACD ensemble lost money on the same locked window. These
rules are that hold, written so a cash account can follow them. The past
return describes that history. It is not a promise that the next window repeats.

Rules, applied in this order:

1. Long only. The book never shorts. A name that leaves the universe is sold
   down to zero. It is not replaced with a short.
2. At least eight listed names. Fewer than that, the sleeve is cash. One name
   is how an unstopped position went to zero in the earlier single-name test.
3. Equal weight. One name is capped at 15% of the sleeve. Gross exposure is
   capped at 100% of sleeve cash. No leverage and no borrow.
4. Hold between rebalances. Rebalance on the first session of January, April,
   July, and October, and also when any name has drifted more than 5 percentage
   points from its target weight.
5. The TEMA ribbon, the MACD close, and the Carver forecast do not change
   these weights.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from pipeline.strategies.bars import bars_as_of
from pipeline.strategies.types import Signal

MIN_NAMES = 8
MAX_NAME_WEIGHT = 0.15
GROSS_CAP = 1.0
DRIFT_BAND = 0.05
REBALANCE_MONTHS = (1, 4, 7, 10)
MIN_HISTORY = 20

RULES: tuple[str, ...] = (
    "Long only. Sell a name down to zero when it leaves the universe. Never open a short.",
    "Stay in cash unless at least eight listed names have a usable price history.",
    "Equal-weight the names. Cap each name at 15% of sleeve cash. Cap gross exposure at 100%.",
    "Hold. Rebalance on the first session of January, April, July, and October, or when any weight drifts more than 5 percentage points from target.",
    "Ignore TEMA, MACD, and Carver when setting these weights. No leverage and no borrow.",
)


def target_weights(symbols: Sequence[str]) -> dict[str, float]:
    """Equal weights under the name cap and the gross cap. Empty if too few names."""
    names = tuple(dict.fromkeys(symbols))
    n = len(names)
    if n < MIN_NAMES:
        return {}
    weight = min(1.0 / n, MAX_NAME_WEIGHT)
    raw = {sym: weight for sym in names}
    gross = sum(raw.values())
    if gross > GROSS_CAP:
        scale = GROSS_CAP / gross
        raw = {sym: w * scale for sym, w in raw.items()}
    return raw


def is_rebalance_session(as_of: date, previous: date | None) -> bool:
    """True on the first observed session of a rebalance month, and on the first session."""
    if previous is None:
        return True
    return as_of.month in REBALANCE_MONTHS and (
        previous.year != as_of.year or previous.month != as_of.month
    )


def weights_drifted(current: Mapping[str, float], targets: Mapping[str, float]) -> bool:
    names = set(current) | set(targets)
    for sym in names:
        if abs(float(current.get(sym, 0.0)) - float(targets.get(sym, 0.0))) > DRIFT_BAND + 1e-12:
            return True
    return False


def should_rebalance(
    as_of: date,
    previous: date | None,
    current: Mapping[str, float],
    targets: Mapping[str, float],
) -> bool:
    return is_rebalance_session(as_of, previous) or weights_drifted(current, targets)


def _eligible(universe: Sequence[str], bars: Mapping[str, pd.DataFrame], as_of: date) -> list[str]:
    kept: list[str] = []
    for sym in universe:
        raw = bars.get(sym)
        if raw is None or getattr(raw, "empty", True):
            continue
        hist = bars_as_of(raw, as_of)
        if "close" not in hist.columns or len(hist) < MIN_HISTORY:
            continue
        close = float(hist["close"].iloc[-1])
        if not np.isfinite(close) or close <= 0:
            continue
        kept.append(sym)
    return kept


def signals(
    universe: Sequence[str],
    bars: Mapping[str, pd.DataFrame],
    as_of: date,
    params: Mapping[str, Any] | None = None,
) -> list[Signal]:
    """BUY each eligible name at its target weight. Empty means the sleeve is cash.

    `size_hint` is the fraction of sleeve equity, not a share count.
    """
    del params
    names = _eligible(universe, bars, as_of)
    weights = target_weights(names)
    out = [
        Signal(
            symbol=sym,
            side="BUY",
            score=weight,
            stop=None,
            size_hint=weight,
            reason="cash_hold",
        )
        for sym, weight in weights.items()
    ]
    out.sort(key=lambda s: s.symbol)
    return out
