"""S&P 500 ∪ Nasdaq-100 constituent list for the EMA200 scanner."""
from __future__ import annotations

from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.universe_filters import is_pharma_stock


def sp500_nasdaq100_stocks(*, exclude_pharma: bool = False) -> tuple[list[dict], dict[str, int]]:
    """Return merged index rows with tier/exchange metadata."""
    stocks, stats = build_merged_universe()
    if exclude_pharma:
        kept = []
        excluded = 0
        for s in stocks:
            if is_pharma_stock(s):
                excluded += 1
                continue
            kept.append(s)
        stats = {**stats, "pharma_excluded": excluded, "merged": len(kept)}
        stocks = kept
    return stocks, stats
