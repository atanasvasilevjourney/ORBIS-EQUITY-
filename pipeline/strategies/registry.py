from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any, Mapping, Sequence

import pandas as pd

from pipeline.strategies import donchian_vwap, watchlist_momentum
from pipeline.strategies.types import Signal

StrategyFn = Callable[
    [Sequence[str], Mapping[str, pd.DataFrame], date, Mapping[str, Any]],
    list[Signal],
]

_REGISTRY: dict[str, StrategyFn] = {
    "donchian_vwap": donchian_vwap.signals,
    "watchlist_momentum": watchlist_momentum.signals,
}


def get(strategy_id: str) -> StrategyFn:
    if strategy_id not in _REGISTRY:
        raise KeyError(f"unknown strategy_id: {strategy_id}")
    return _REGISTRY[strategy_id]


def list_strategies() -> list[str]:
    return sorted(_REGISTRY.keys())
