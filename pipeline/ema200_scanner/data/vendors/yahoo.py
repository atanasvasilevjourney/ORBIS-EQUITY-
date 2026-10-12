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


def _to_vendor(bar: DailyBar, src: str) -> VendorBar:
    adj = bar.adj_close if bar.adj_close is not None else bar.close
    return VendorBar(
        date=bar.date,
        open=bar.open,
        high=bar.high,
        low=bar.low,
        close=adj,
        adj_close=adj,
        volume=bar.volume,
        source=src,
    )
