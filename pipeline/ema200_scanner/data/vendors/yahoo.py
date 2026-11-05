"""Yahoo/Stooq cash EOD vendor (reuses pipeline.clients.cash_eod)."""
from __future__ import annotations

import logging

from pipeline.clients.cash_eod import DailyBar, fetch_daily_bars
from pipeline.ema200_scanner.data.vendors.base import VendorBar

logger = logging.getLogger(__name__)


class YahooCashEodVendor:
    """Public REST EOD backfill with timeout/retry handled in cash_eod."""

    def fetch_history(
        self,
        symbol: str,
        *,
        min_bars: int,
        country: str | None = None,
    ) -> list[VendorBar]:
        bars, src = fetch_daily_bars(symbol, country=country, bars=max(min_bars, 300))
        logger.debug("yahoo vendor %s via %s (%d bars)", symbol, src, len(bars))
        return [_to_vendor(b, src) for b in bars]


def _scale(value: float | None, factor: float) -> float | None:
    if value is None:
        return None
    return float(value) * factor


def _to_vendor(bar: DailyBar, src: str) -> VendorBar:
    """Return OHLC on the adjusted-close scale (raw high/low warp the ribbon)."""
    close = bar.close
    adj = bar.adj_close if bar.adj_close is not None else close
    factor = 1.0
    if close not in (None, 0) and adj is not None:
        factor = float(adj) / float(close)
    adj_f = float(adj) if adj is not None else (float(close) if close is not None else None)
    return VendorBar(
        date=bar.date,
        open=_scale(bar.open, factor),
        high=_scale(bar.high, factor),
        low=_scale(bar.low, factor),
        close=adj_f,
        adj_close=adj_f,
        volume=bar.volume,
        source=src,
    )
