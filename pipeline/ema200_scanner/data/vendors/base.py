"""Vendor adapter interface for EOD OHLCV history."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class VendorBar:
    date: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    adj_close: float | None
    volume: int | None
    source: str


class EodVendor(Protocol):
    """Fetch adjusted daily history for backfill."""

    def fetch_history(
        self,
        symbol: str,
        *,
        min_bars: int,
        country: str | None = None,
    ) -> list[VendorBar]:
        ...
