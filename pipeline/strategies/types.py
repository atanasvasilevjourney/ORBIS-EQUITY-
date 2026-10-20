from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal, Mapping, Sequence

Side = Literal["BUY", "SELL", "FLAT"]


@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Side
    score: float
    stop: float | None
    size_hint: float | None
    reason: str


@dataclass(frozen=True)
class StrategyContext:
    """Bars indexed by session date (DatetimeIndex), columns lower-case OHLCV."""

    universe: Sequence[str]
    bars: Mapping[str, Any]
    as_of: date
    params: Mapping[str, Any]
